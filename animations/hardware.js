(() => {
  'use strict';
  window.RamnetAnimations ??= {};
  window.RamnetAnimations.hardware = function mount(scope) {
    const {document, requestAnimationFrame, translateText: t} = scope;
    const palette = window.RamnetPalette;
    const $ = id => document.getElementById(id), scene = $('scene');
    const tone = name => palette.tone(name), ink = name => palette.tone(name, 'ink');
    const clamp = value => Math.max(0, Math.min(1, value));
    const ease = value => { const u = clamp(value); return u * u * (3 - 2 * u); };
    const schedules = Array.from({length: 4}, () => []), caches = schedules.map(() => new Map());
    const queuesPerEU = 2, queueCapacity = 9;
    const ticketWidth = 36;
    const latency = {reg: .3, sram: 1.8, dram: 7.2};
    const requestInterval = .24;
    const lastCompleted = schedules.map(() => null);
    const accessHeat = new Map();
    const heat = slot => accessHeat.get(slot) ?? 0;
    const chainHeat = slot => Math.max(0, heat(slot) - 2);
    const retention = entry => heat(entry.slot) + (Number.isFinite(entry.dirtyAt) ? 1 : 0);
    // Maps reserve future ownership; histories retain the visible data until release.
    const cacheLines = schedules.map(() => []), previousSlot = new Map(), backingReady = new Map(), events = [], transfers = [];
    let time = 0, nextRequest = 0, nextRequestAt = -24 * requestInterval, lastFrame = 0;
    let layout, backpressure, lanes = [];
    // The page autoplay has a viewing interval; the request stream has no endpoint.
    scope.setCycleDuration(16.8);

    function transfer(lane, slot, kind, start, finish) {
      const movement = {lane, slot, kind, start, finish};
      if (layout) movement.element = transferPacket(movement);
      transfers.push(movement);
    }

    function releaseEntry(lane, entry, earliest) {
      const start = Math.max(earliest, entry.ready, entry.busyUntil);
      const dirty = Number.isFinite(entry.dirtyAt), finish = start + (dirty ? latency.dram : 0);
      if (dirty) {
        transfer(lane, entry.slot, 'writeback', start, finish);
        backingReady.set(entry.slot, Math.max(backingReady.get(entry.slot) ?? -Infinity, finish));
        entry.drainedAt = finish;
      }
      caches[lane].delete(entry.slot);
      const line = cacheLines[lane][entry.cell];
      line.available = finish;
      line.history.push({time: finish, entry: null});
    }

    function queueEvents(lane, queue, at) {
      // In-flight requests reserve a queue cell before leaving the front end.
      return events.filter(event => event.lane === lane && event.queue === queue && event.launch <= at && event.start > at);
    }

    function prioritizeRegisterContinuation(lane, entry, readyAt) {
      const schedule = schedules[lane];
      const index = schedule.findLastIndex(event => event.entry === entry);
      const predecessor = schedule[index];
      if (!predecessor || predecessor.finish < Math.max(readyAt, time)) return null;
      let finish = predecessor.finish + latency.reg;
      const delayed = [];
      for (let i = index + 1; i < schedule.length; i++) {
        const event = schedule[i], start = Math.max(event.start, finish);
        if (start === event.start) break;
        // Keep existing eviction and migration deadlines unchanged.
        if (caches[lane].get(event.slot) !== event.entry) return null;
        finish = start + latency[event.access];
        delayed.push({event, start, finish, firstWrite: event.kind === 'write' && event.entry.dirtyAt === event.finish});
      }
      for (const {event, start, finish, firstWrite} of delayed) {
        event.start = start;
        event.finish = finish;
        event.entry.busyUntil = Math.max(event.entry.busyUntil, finish);
        if (firstWrite) event.entry.dirtyAt = finish;
        previousSlot.set(event.slot, event.entry.busyUntil);
      }
      return predecessor;
    }

    function generateRequests() {
      // Warm up the pipeline before its first visible frame, then keep emitting.
      while (nextRequestAt <= time) {
        const created = nextRequestAt, firstQueue = nextRequest++ % (schedules.length * queuesPerEU);
        const choice = Math.random();
        const slot = 100 + Math.floor(Math.random() * 4) + (choice < .6 ? 0 : choice < .8 ? 4 : choice < .9 ? 8 : 12);
        accessHeat.forEach((value, address) => accessHeat.set(address, value * .97));
        accessHeat.set(slot, heat(slot) + 1);
        // An outstanding slot stays in its specific queue, not just its EU.
        const pending = events.find(event => event.slot === slot && event.finish > created);
        const resident = caches.map(cache => cache.get(slot)).find(Boolean);
        const slotQueues = schedules.map((schedule, lane) => {
          const bindings = new Map([...caches[lane].values()].map(entry => [entry.slot, {queue: entry.queue, depth: 0}]));
          for (const event of schedule) {
            if (event.finish <= created) continue;
            const depth = (bindings.get(event.slot)?.depth ?? 0) + 1;
            bindings.set(event.slot, {queue: event.queue, depth});
          }
          return bindings;
        });
        const hotLoads = slotQueues.map(bindings => [...bindings.keys()].reduce((sum, address) => sum + (address === slot ? 0 : heat(address)), 0));
        const queueLoads = slotQueues.map(bindings => Array.from({length: queuesPerEU}, (_, queue) =>
          [...bindings].reduce((load, [address, binding]) => load + (address !== slot && binding.queue === queue ? Math.max(chainHeat(address), binding.depth - 1) : 0), 0)));
        const targets = pending ? [{lane: pending.lane, queue: pending.queue}] : Array.from({length: schedules.length * queuesPerEU}, (_, i) => {
          const index = (firstQueue + i) % (schedules.length * queuesPerEU);
          return {lane: Math.floor(index / queuesPerEU), queue: index % queuesPerEU};
        });
        const candidates = targets.map(({lane, queue}) => {
          const occupied = queueEvents(lane, queue, created);
          const launch = occupied.length < queueCapacity ? created : Math.min(...occupied.map(event => event.start));
          // Keep stable chains apart and steer sporadic requests toward shared queues.
          const local = caches[lane].get(slot);
          const moveCost = local ? 0 : .75 + heat(slot) * .5 + (resident && Number.isFinite(resident.dirtyAt) ? 2 : 0);
          const affinityCost = local?.queue !== undefined && local.queue !== queue ? chainHeat(slot) : 0;
          const queueCost = queueLoads[lane][queue] * (heat(slot) + 1);
          const score = occupied.length + schedules[lane].filter(event => event.finish > created).length * .2 + hotLoads[lane] * heat(slot) * .5 + moveCost + affinityCost + queueCost;
          return {lane, queue, launch, score};
        });
        const earliest = Math.min(...candidates.map(candidate => candidate.launch));
        const available = candidates.filter(candidate => candidate.launch === earliest);
        const {lane, queue, launch} = available.reduce((best, value) => value.score < best.score ? value : best);
        const arrival = launch + 2 * requestInterval;
        // A full target queue stalls this request at the outlet and stops production.
        nextRequestAt = launch + requestInterval;
        // A new owner reads backing memory only after the previous dirty copy drains.
        caches.forEach((cache, other) => {
          if (other !== lane && cache.has(slot)) releaseEntry(other, cache.get(slot), arrival);
        });
        const cache = caches[lane];
        let entry = cache.get(slot);
        if (!entry) {
          if (cache.size === 3) {
            const entries = [...cache.values()];
            // Cold entries go first; an idle hot dirty slot is still worth retaining.
            const victim = entries.reduce((best, value) => retention(value) < retention(best) ? value : best);
            releaseEntry(lane, victim, arrival);
          }
          const cell = cacheLines[lane].findIndex((_, index) => ![...cache.values()].some(value => value.cell === index));
          const line = cacheLines[lane][cell], visibleAt = Math.max(arrival, line.available);
          const fillAt = Math.max(visibleAt, backingReady.get(slot) ?? -Infinity);
          entry = {slot, cell, ready: fillAt + latency.dram, busyUntil: fillAt + latency.dram, dirtyAt: Infinity, drainedAt: Infinity};
          line.history.push({time: visibleAt, entry});
          transfer(lane, slot, 'fill', fillAt, entry.ready);
        }
        cache.delete(slot);
        cache.set(slot, entry);
        entry.queue = queue;
        let start = Math.max(arrival + .1, entry.ready, previousSlot.get(slot) ?? -Infinity);
        // Backpressured admissions keep their reserved queue-release time.
        const continuation = launch === created ? prioritizeRegisterContinuation(lane, entry, start) : null;
        let predecessor = continuation ?? lastCompleted[lane];
        if (continuation) {
          start = continuation.finish;
        } else {
          for (const reserved of schedules[lane]) {
            if (reserved.finish <= start) { predecessor = reserved; continue; }
            const duration = predecessor?.entry === entry ? latency.reg : latency.sram;
            if (start + duration <= reserved.start) break;
            start = reserved.finish;
            predecessor = reserved;
          }
        }
        // Reuse the register only for consecutive executions of the same resident entry.
        const access = predecessor?.entry === entry ? 'reg' : 'sram';
        const event = {lane, queue, slot, entry, access, kind: Math.random() < .45 ? 'write' : 'read', created, launch, arrival, ready: entry.ready, start, finish: start + latency[access]};
        entry.busyUntil = Math.max(entry.busyUntil, event.finish);
        if (event.kind === 'write') entry.dirtyAt = Math.min(entry.dirtyAt, event.finish);
        previousSlot.set(slot, event.finish);
        schedules[lane].push(event);
        schedules[lane].sort((a, b) => a.start - b.start);
        if (layout) event.view = ticket(event);
        events.push(event);
      }
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].finish > time) continue;
        events[i].view?.element.remove();
        events.splice(i, 1);
      }
      for (let i = transfers.length - 1; i >= 0; i--) {
        if (transfers[i].finish > time) continue;
        transfers[i].element?.remove();
        transfers.splice(i, 1);
      }
      schedules.forEach((queue, lane) => {
        while (queue[0]?.finish <= time) {
          const finished = queue.shift();
          lastCompleted[lane] = {slot: finished.slot, entry: finished.entry, finish: finished.finish};
        }
      });
      cacheLines.flat().forEach(({history}) => { while (history.length > 1 && history[1].time <= time) history.shift(); });
    }

    function restart() {
      time = 0; nextRequest = 0; nextRequestAt = -24 * requestInterval; lastFrame = 0; layout = null;
      events.length = 0; transfers.length = 0; previousSlot.clear(); backingReady.clear(); accessHeat.clear();
      schedules.forEach((queue, lane) => {
        queue.length = 0;
        lastCompleted[lane] = null;
        const cache = caches[lane];
        cache.clear();
        cacheLines[lane] = [];
        for (let cell = 0; cell < 3; cell++) {
          const slot = 100 + lane + cell * 4;
          const entry = {slot, cell, ready: -Infinity, busyUntil: -Infinity, dirtyAt: Infinity, drainedAt: Infinity};
          cache.set(slot, entry);
          cacheLines[lane].push({available: -Infinity, history: [{time: -Infinity, entry}]});
        }
      });
      generateRequests();
      build();
    }

    function node(tag, attrs, parent = scene) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
      parent.append(element);
      return element;
    }
    function text(value, x, y, size = 14, color = palette.neutral(3), anchor = 'middle', parent = scene) {
      const element = node('text', {x, y, fill: color, 'font-size': size, 'font-weight': 600, 'text-anchor': anchor, 'dominant-baseline': 'middle'}, parent);
      element.textContent = t(value);
      return element;
    }
    function box(x, y, width, height, color, parent = scene) {
      return node('rect', {x, y, width, height, rx: 6, fill: palette.withAlpha(color, .055), stroke: palette.withAlpha(color, .5), 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke'}, parent);
    }
    function arrowhead([x, y], [px, py], color, parent = scene) {
      node('path', {d: 'M0 0L-6 -3.1L-6 3.1Z', fill: palette.withAlpha(color, .8), stroke: 'none', transform: `translate(${x} ${y}) rotate(${Math.atan2(y - py, x - px) * 180 / Math.PI})`}, parent);
    }
    function wire(points, color = palette.neutral(8), mode = 'forward', parent = scene) {
      const path = node('path', {d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '), fill: 'none', stroke: palette.withAlpha(color, .65), 'stroke-width': 1.3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke'}, parent);
      if (mode !== 'none') arrowhead(points.at(-1), points.at(-2), color, parent);
      if (mode === 'both') arrowhead(points[0], points[1], color, parent);
      return path;
    }
    function ticket(event, parent = scene) {
      const group = node('g', {}, parent), color = tone(event.kind === 'write' ? 'red' : 'green');
      const rect = box(-ticketWidth / 2, -14, ticketWidth, 28, color, group);
      rect.setAttribute('rx', '3');
      rect.setAttribute('fill', palette.mix(palette.color('paper'), color, .12));
      text(event.kind, -3, -8, 8, ink(event.kind === 'write' ? 'red' : 'green'), 'middle', group);
      const label = text(String(event.slot), 0, 5, 14, ink(event.kind === 'write' ? 'red' : 'green'), 'middle', group);
      label.setAttribute('class', 'hardware-address');
      label.setAttribute('font-weight', '700');
      const wait = node('g', {opacity: 0}, group);
      node('circle', {cx: 12, cy: -8, r: 3.5, fill: 'none', stroke: ink('gold'), 'stroke-width': 1.1}, wait);
      node('path', {d: 'M12 -10.5V-8L13.5 -6.5', fill: 'none', stroke: ink('gold'), 'stroke-width': 1.1}, wait);
      const title = node('title', {}, group);
      return {element: group, wait, title};
    }
    function transferPacket(movement) {
      const element = node('circle', {r: 4, fill: tone(movement.kind === 'writeback' ? 'red' : 'sky'), opacity: 0});
      node('title', {}, element).textContent = `${t(movement.kind === 'writeback' ? 'Write back' : 'Fill')} · ${movement.slot}`;
      return element;
    }
    function build() {
      scene.replaceChildren();
      $('caption').textContent = t('Consecutive operations on one slot reuse EU registers and bypass SRAM.');
      layout = {w: 1000, h: 520, front: {x: 24, y: 145, w: 190, h: 166}, out: [214, 228], bus: 250, q: 470, queueWidth: 392, eu: 738, ram: 890, memoryBus: 990, start: 61, pitch: 96, cold: [890, 485]};
      layout.head = layout.q + (layout.queueWidth - ticketWidth) / 2 - 4;
      layout.queueStep = (layout.queueWidth - ticketWidth - 8) / (queueCapacity - 1);
      scene.setAttribute('viewBox', `0 0 ${layout.w} ${layout.h}`);
      const f = layout.front;
      text('Address front end', f.x + f.w / 2, f.y - 20, 16, ink('sky'));
      box(f.x, f.y, f.w, f.h, tone('gold'));
      text('Project + decode', f.x + f.w / 2, f.y + 36, 15, ink('gold'));
      for (let factor = 0; factor < 4; factor++) {
        for (let i = 0; i < 4; i++) node('rect', {x: f.x + 26 + factor * 40 + i * 7, y: f.y + 69 + (3 - i) * 3, width: 5, height: 9 + i * 3, rx: 1, fill: palette.withAlpha(tone('gold'), .25 + .12 * i)});
      }
      text('Product Softmax → Top-K', f.x + f.w / 2, f.y + 122, 12, ink('gold'));
      const headerY = 27;
      text('Slot queues', layout.q, headerY, 14, ink('purple'));
      text('Slot engines', layout.eu, headerY, 14, ink('cyan'));
      text('On-chip SRAM', layout.ram, headerY, 14, ink('sky'));
      backpressure = text('Backpressure', f.x + f.w / 2, f.y + f.h + 20, 10, ink('gold'));
      const [cx, cy] = layout.cold;
      lanes = schedules.map((_, index) => {
        const y = layout.start + index * layout.pitch, queueX = layout.q;
        const queueStatus = text('', queueX, y + 86, 9, ink('gold'));
        const queueViews = Array.from({length: queuesPerEU}, (_, queue) => {
          const center = y + 23 + queue * 36;
          const rect = box(queueX - layout.queueWidth / 2, center - 15, layout.queueWidth, 30, tone('purple'));
          rect.setAttribute('rx', '4');
          for (let cell = 0; cell < queueCapacity; cell++) {
            const x = layout.head - cell * layout.queueStep;
            node('path', {d: `M${x - ticketWidth / 2 + 1} ${center + 10}H${x + ticketWidth / 2 - 1}`, stroke: palette.withAlpha(tone('purple'), .22), 'stroke-width': 1});
          }
          wire([[queueX + layout.queueWidth / 2 + 3, center], [queueX + layout.queueWidth / 2 + 10, center], [layout.eu - 48, y + 41]], palette.neutral(8), 'none');
          return rect;
        });
        wire([[layout.eu - 48, y + 41], [layout.eu - 32, y + 41]]);
        const sramLink = node('g', {});
        wire([[layout.eu + 32, y + 41], [layout.ram - 73, y + 41]], tone('sky'), 'both', sramLink);
        const payload = node('rect', {width: 5, height: 5, rx: 1, fill: tone('sky'), opacity: 0});
        const engine = box(layout.eu - 30, y + 9, 60, 64, tone('cyan'));
        text(`EU ${index + 1}`, layout.eu, y + 21, 11, ink('cyan'));
        const slotLabel = text('', layout.eu, y + 33, 8, ink('cyan'));
        const address = text('', layout.eu, y + 46, 14, ink('cyan'));
        address.setAttribute('class', 'hardware-address');
        address.setAttribute('font-weight', '700');
        const status = text('ready', layout.eu, y + 61, 9, palette.neutral(5));
        const progress = node('rect', {x: layout.eu - 24, y: y + 68, width: 0, height: 3, rx: 1, fill: tone('cyan')});
        const bypass = node('g', {opacity: 0});
        wire([[layout.eu - 19, y + 51], [layout.eu - 25, y + 51], [layout.eu - 25, y + 32], [layout.eu - 18, y + 32]], tone('cyan'), 'forward', bypass);
        const bank = box(layout.ram - 71, y, 142, 82, tone('sky'));
        const cells = Array.from({length: 3}, (_, cell) => {
          const rect = box(layout.ram - 61, y + 8 + cell * 23, 122, 20, tone('sky'));
          rect.setAttribute('rx', '2');
          const label = text('', layout.ram, y + 18 + cell * 23, 12, ink('sky'));
          label.setAttribute('class', 'hardware-address');
          const dirty = node('circle', {cx: layout.ram - 54, cy: y + 18 + cell * 23, r: 2.5, fill: tone('red'), opacity: 0});
          return {rect, label, dirty};
        });
        const coldPath = wire([[layout.ram + 73, y + 41], [layout.memoryBus, y + 41], [layout.memoryBus, cy], [cx + 73, cy]], palette.neutral(8), 'both');
        const routeEnd = queueX - layout.queueWidth / 2 - 6;
        const routes = queueViews.map((_, queue) => {
          const center = y + 23 + queue * 36;
          const path = wire([[layout.out[0], layout.out[1]], [layout.bus, layout.out[1]], [layout.bus, center], [routeEnd, center]]);
          return {path, length: path.getTotalLength()};
        });
        return {y, engine, slotLabel, address, status, progress, bypass, sramLink, payload, bank, cells, queueStatus, queueViews, coldPath, coldLength: coldPath.getTotalLength(), routes, routeEnd};
      });
      box(cx - 71, cy - 18, 142, 36, palette.neutral(7));
      text('DRAM', cx, cy + 1, 13, palette.neutral(4));
      transfers.forEach(event => { event.element = transferPacket(event); });
      events.forEach(event => { event.view = ticket(event); });
      draw();
    }

    function draw() {
      if (!layout) return;
      const admitted = lanes.map((_, index) => Array.from({length: queuesPerEU}, (_, queue) => queueEvents(index, queue, time)));
      const waiting = admitted.map(lane => lane.map(queue => queue.filter(event => event.arrival <= time)));
      backpressure.setAttribute('opacity', events.some(event => event.created <= time && time < event.launch) ? '1' : '0');
      lanes.forEach((lane, index) => {
        const running = events.find(event => event.lane === index && time >= event.start && time < event.finish);
        const fetching = transfers.some(event => event.lane === index && time >= event.start && time < event.finish);
        const writingBack = transfers.some(event => event.lane === index && event.kind === 'writeback' && time >= event.start && time < event.finish);
        const registerHit = running?.access === 'reg', sramAccess = running && !registerHit;
        const blocked = waiting[index].flat().filter(event => event.ready > time).length;
        const opColor = running ? tone(running.kind === 'write' ? 'red' : 'green') : tone('cyan');
        lane.engine.setAttribute('fill', palette.withAlpha(tone('cyan'), registerHit ? .28 : running ? .2 : .045));
        lane.engine.setAttribute('stroke', palette.withAlpha(tone('cyan'), running ? .9 : .4));
        lane.slotLabel.textContent = running ? registerHit ? 'reg' : t('slot') : '';
        lane.address.textContent = running ? String(running.slot) : '';
        lane.status.textContent = t(running ? running.kind : 'ready');
        lane.status.setAttribute('fill', running ? ink(running.kind === 'write' ? 'red' : 'green') : palette.neutral(5));
        lane.queueStatus.textContent = blocked ? `${blocked} · ${t('waiting for DRAM')}` : '';
        lane.queueViews.forEach((rect, queue) => {
          const full = admitted[index][queue].length === queueCapacity;
          rect.setAttribute('fill', palette.withAlpha(tone('purple'), full ? .15 : .06));
          rect.setAttribute('stroke', palette.withAlpha(tone('purple'), full ? .9 : .5));
        });
        const progress = running ? clamp((time - running.start) / (running.finish - running.start)) : 0;
        lane.progress.setAttribute('width', String(48 * progress));
        lane.bypass.setAttribute('opacity', registerHit ? '1' : '0');
        lane.sramLink.setAttribute('opacity', registerHit ? '0' : '1');
        lane.payload.setAttribute('opacity', sramAccess ? '1' : '0');
        if (sramAccess) {
          const from = layout.eu + 32, to = layout.ram - 73, travel = running.kind === 'write' ? progress : 1 - progress;
          lane.payload.setAttribute('x', from + (to - from) * travel - 2.5);
          lane.payload.setAttribute('y', lane.y + 38.5);
          lane.payload.setAttribute('fill', opColor);
        }
        lane.cells.forEach(({rect, label, dirty}, cell) => {
          const entry = cacheLines[index][cell].history.findLast(change => change.time <= time).entry;
          const resident = entry && entry.ready <= time, active = entry && sramAccess && running.slot === entry.slot;
          const needsWriteback = entry && entry.dirtyAt <= time && time < entry.drainedAt;
          rect.setAttribute('fill', palette.withAlpha(tone('sky'), active ? .4 : resident ? .16 : .025));
          rect.setAttribute('stroke', active ? opColor : palette.withAlpha(needsWriteback ? tone('red') : tone('sky'), resident ? .5 : .25));
          rect.setAttribute('stroke-dasharray', resident ? 'none' : '3 3');
          label.textContent = entry ? String(entry.slot) : '';
          label.setAttribute('fill', resident ? ink('sky') : palette.neutral(5));
          dirty.setAttribute('opacity', needsWriteback ? '1' : '0');
        });
        lane.bank.setAttribute('stroke', palette.withAlpha(sramAccess ? opColor : writingBack ? tone('red') : tone('sky'), sramAccess || writingBack ? .85 : .4));
        lane.coldPath.setAttribute('stroke', palette.withAlpha(fetching ? tone(writingBack ? 'red' : 'sky') : palette.neutral(8), fetching ? .8 : .35));
      });
      events.forEach(event => {
        const {element, wait, title} = event.view;
        const lane = lanes[event.lane];
        const route = lane.routes[event.queue];
        const issueDuration = Math.min(.28, (event.finish - event.start) * .65);
        let x = layout.head, y = lane.y + 23 + event.queue * 36, opacity = 0;
        const queueIndex = waiting[event.lane][event.queue].indexOf(event);
        const held = time >= event.created && time < event.launch;
        if (held) {
          x = layout.out[0] + 32; y = layout.out[1]; opacity = 1;
        } else if (time >= event.launch && time < event.arrival) {
          const ahead = events.filter(other => other.lane === event.lane && other.queue === event.queue && other.arrival < event.arrival && other.start > event.arrival).length;
          const entryX = layout.head - ahead * layout.queueStep;
          const distance = 32 + (route.length + entryX - lane.routeEnd - 32) * (time - event.launch) / (event.arrival - event.launch);
          const point = route.path.getPointAtLength(Math.min(route.length, distance));
          x = point.x + Math.max(0, distance - route.length); y = point.y;
          opacity = event.launch > event.created ? 1 : Math.min(1, (time - event.launch) * 10);
        } else if (queueIndex >= 0) {
          x -= queueIndex * layout.queueStep; opacity = 1;
        } else if (time >= event.start && time < event.start + issueDuration) {
          const u = ease((time - event.start) / issueDuration);
          const ahead = events.filter(other => other.lane === event.lane && other.queue === event.queue && other.arrival < event.arrival && other.start > event.start).length;
          x -= ahead * layout.queueStep;
          x += (layout.eu - x) * u; y += (lane.y + 41 - y) * u; opacity = 1 - u;
        }
        element.setAttribute('transform', `translate(${x} ${y})`);
        element.setAttribute('opacity', String(opacity));
        wait.setAttribute('opacity', held || (queueIndex >= 0 && event.ready > time) ? '1' : '0');
        title.textContent = `${event.slot} · ${t(held ? 'Backpressure' : queueIndex >= 0 && event.ready > time ? 'waiting for DRAM' : event.kind)}`;
      });
      transfers.forEach(event => {
        const {element} = event;
        const fetching = time >= event.start && time < event.finish, lane = lanes[event.lane];
        element.setAttribute('opacity', fetching ? '1' : '0');
        if (!fetching) return;
        const progress = (time - event.start) / (event.finish - event.start);
        const point = lane.coldPath.getPointAtLength(lane.coldLength * (event.kind === 'writeback' ? progress : 1 - progress));
        element.setAttribute('cx', point.x); element.setAttribute('cy', point.y);
      });
    }

    scope.onAutoplayStart(event => {
      if (event.detail) event.detail.remainingMs = 16800;
      lastFrame = 0; draw();
    });
    document.addEventListener('visibilitychange', () => { lastFrame = 0; });
    function animate(now) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .08) : 0;
      lastFrame = now;
      time += dt; generateRequests(); draw();
      requestAnimationFrame(animate);
    }
    restart();
    requestAnimationFrame(animate);
  };
  if (document.body.classList.contains('probe-hardware')) window.RamnetRuntime.mountStandalone('hardware');
})();
