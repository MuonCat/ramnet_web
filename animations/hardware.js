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
    const engines = Array.from({length: 4}, () => ({running: null, lastEntry: null, chainIssued: 0}));
    const queuesPerEU = 2, queueCapacity = 9, ticketWidth = 36;
    const queues = engines.map(() => Array.from({length: queuesPerEU}, () => []));
    const caches = engines.map(() => new Map()), cacheLines = engines.map(() => []);
    const slotOwners = new Map(), accessHeat = new Map(), events = [], transfers = [];
    const latency = {reg: .3, sram: 1.8, dram: 7.2}, requestInterval = .24, inputInterval = .12;
    const heat = slot => accessHeat.get(slot) ?? 0;
    const chainHeat = slot => Math.max(0, heat(slot) - 2);
    const retention = entry => heat(entry.slot) + (Number.isFinite(entry.dirtyAt) ? 1 : 0);
    let time = 0, nextRequest = 0, nextRequestAt = 0, held = null, lastFrame = 0;
    let layout, backpressure, lanes = [];
    // The page autoplay has a viewing interval; the request stream has no endpoint.
    scope.setCycleDuration(16.8);

    function transfer(lane, slot, kind, done) {
      const movement = {lane, slot, kind, start: time, finish: time + latency.dram, done};
      if (layout) movement.element = transferPacket(movement);
      transfers.push(movement);
    }

    function releaseEntry(lane, entry) {
      if (entry.state !== 'resident' || engines[lane].running?.entry === entry) return;
      const remove = () => {
        caches[lane].delete(entry.slot);
        slotOwners.delete(entry.slot);
        cacheLines[lane][entry.cell].entry = null;
        entry.state = 'released';
      };
      if (Number.isFinite(entry.dirtyAt)) {
        entry.state = 'writeback';
        entry.drainedAt = time + latency.dram;
        transfer(lane, entry.slot, 'writeback', remove);
      } else {
        remove();
      }
    }

    function queueEvents(lane, queue) {
      // In-flight requests reserve real queue cells before leaving the front end.
      return queues[lane][queue];
    }

    function generateRequests() {
      if (held || nextRequestAt > time) return;
      const firstQueue = nextRequest++ % (engines.length * queuesPerEU);
      accessHeat.forEach((value, address) => accessHeat.set(address, value * .97));
      const bindings = queues.map((laneQueues, lane) => {
        const slots = new Map([...caches[lane].values()].map(entry => [entry.slot, {queue: entry.queue, depth: 0}]));
        for (const event of [...laneQueues.flat(), engines[lane].running].filter(Boolean)) {
          const depth = (slots.get(event.slot)?.depth ?? 0) + 1;
          slots.set(event.slot, {queue: event.queue, depth});
        }
        return slots;
      });
      // Shape demonstration traffic around queue room and cache readiness.
      const options = Array.from({length: 16}, (_, i) => {
        const slot = 100 + i, owner = slotOwners.get(slot);
        const pending = events.find(event => event.slot === slot && event.finish > time);
        const bound = pending ?? (owner && owner.entry.state !== 'writeback' && chainHeat(slot) > 0 && owner.entry.queue !== undefined
          ? {lane: owner.lane, queue: owner.entry.queue} : null);
        const targets = bound ? [{lane: bound.lane, queue: bound.queue}] : Array.from({length: engines.length * queuesPerEU}, (_, j) => {
          const index = (firstQueue + j) % (engines.length * queuesPerEU);
          return {lane: Math.floor(index / queuesPerEU), queue: index % queuesPerEU};
        });
        const candidates = targets.map(({lane, queue}) => {
          const otherSlots = [...bindings[lane]].filter(([address]) => address !== slot);
          const conflicts = otherSlots.filter(([address, binding]) =>
            binding.queue === queue && (chainHeat(address) > 0 || binding.depth > 1)).length;
          const hotLoad = otherSlots.reduce((sum, [address]) => sum + heat(address), 0);
          const moveCost = owner?.lane === lane ? 0 : latency.dram + (owner && Number.isFinite(owner.entry.dirtyAt) ? latency.dram : 0);
          const score = queues[lane][queue].length + queues[lane].flat().length * .2 + hotLoad * heat(slot) * .5 + moveCost;
          return {lane, queue, conflicts, full: queues[lane][queue].length === queueCapacity, score};
        });
        candidates.sort((a, b) => Number(a.full) - Number(b.full) || a.conflicts - b.conflicts || a.score - b.score);
        const target = candidates[0], engine = engines[target.lane];
        const room = 1 - queues[target.lane][target.queue].length / queueCapacity;
        const resident = owner?.lane === target.lane && owner.entry.state === 'resident';
        const locality = resident ? 4 : owner?.entry.state === 'writeback' ? .05 : .4 / (1 + transfers.length);
        const continuation = resident && (engine.running?.entry === owner.entry || !engine.running && engine.lastEntry === owner.entry);
        // Let long register runs drain instead of continually replenishing them.
        const refillWeight = continuation ? 1.5 * Math.max(0, 1 - engine.chainIssued / (2 * queueCapacity)) : 1;
        const weight = (i < 4 ? 32 : i < 8 ? 2 : .75) * room * locality * refillWeight
          / (1 + queues[target.lane].flat().length * .25);
        return {slot, ...target, weight};
      });
      const available = options.filter(option => option.weight > 0);
      let selected = available.at(-1) ?? options.reduce((best, option) => option.score < best.score ? option : best);
      let choice = Math.random() * available.reduce((sum, option) => sum + option.weight, 0);
      for (const option of available) {
        choice -= option.weight;
        if (choice < 0) { selected = option; break; }
      }
      const {slot, lane, queue} = selected;
      accessHeat.set(slot, heat(slot) + 1);
      const event = {lane, queue, slot, kind: Math.random() < .45 ? 'write' : 'read', created: time,
        launch: Infinity, arrival: Infinity, ready: Infinity, start: Infinity, finish: Infinity};
      if (layout) event.view = ticket(event);
      events.push(event);
      held = event;
    }

    function admitRequest() {
      if (!held) return;
      const queue = queues[held.lane][held.queue], engine = engines[held.lane];
      if (queue.length === queueCapacity) return;
      held.launch = time;
      held.arrival = time + 2 * requestInterval;
      const index = queue.findLastIndex(event => event.slot === held.slot);
      if (index >= 0) {
        queue.splice(index + 1, 0, held);
      } else if (engine.running?.slot === held.slot && held.arrival <= engine.running.finish) {
        queue.unshift(held);
      } else {
        queue.push(held);
      }
      // Resume the fixed cadence after backpressure, without catch-up bursts.
      nextRequestAt = time + inputInterval;
      held = null;
    }

    function startLoad(lane, line) {
      if (!line.pending || line.entry || slotOwners.has(line.pending.slot)) return;
      const {slot, queue} = line.pending, cell = cacheLines[lane].indexOf(line);
      const entry = {slot, cell, queue, state: 'loading', ready: time + latency.dram,
        busyUntil: time + latency.dram, dirtyAt: Infinity, drainedAt: Infinity};
      line.entry = entry;
      line.pending = null;
      caches[lane].set(slot, entry);
      slotOwners.set(slot, {lane, entry});
      transfer(lane, slot, 'fill', () => { entry.state = 'resident'; });
    }

    function prepareMemory() {
      queues.forEach((laneQueues, lane) => {
        const engine = engines[lane];
        cacheLines[lane].forEach(line => startLoad(lane, line));
        const heads = laneQueues.map(queue => queue[0]).filter(event => event && event.arrival <= time);
        for (const event of heads) {
          let owner = slotOwners.get(event.slot);
          if (owner?.lane === lane) continue;
          if (owner) {
            releaseEntry(owner.lane, owner.entry);
            owner = slotOwners.get(event.slot);
            if (owner) continue;
          }
          let line = cacheLines[lane].find(value => value.pending?.slot === event.slot);
          if (!line) {
            line = cacheLines[lane].find(value => !value.entry && !value.pending);
            if (!line) {
              const needed = new Set(laneQueues.map(queue => queue[0]?.slot));
              if (!engine.running && laneQueues.some(queue => queue.some(value =>
                value.slot === engine.lastEntry?.slot && value.arrival <= time))) needed.add(engine.lastEntry.slot);
              const replaceable = cacheLines[lane].filter(value => !value.pending && value.entry?.state === 'resident'
                && value.entry !== engine.running?.entry && !needed.has(value.entry.slot));
              if (!replaceable.length) continue;
              line = replaceable.reduce((best, value) => retention(value.entry) < retention(best.entry) ? value : best);
            }
            line.pending = {slot: event.slot, queue: event.queue};
            if (line.entry) releaseEntry(lane, line.entry);
          }
          startLoad(lane, line);
        }
      });
    }

    function dispatchRequests() {
      engines.forEach((engine, lane) => {
        if (engine.running) return;
        const ready = queues[lane].flatMap(queue => queue.filter((event, index) => {
          if (index && queue[index - 1].slot === event.slot) return false;
          const owner = slotOwners.get(event.slot);
          return event.arrival <= time && owner?.lane === lane && owner.entry.state === 'resident';
        }));
        if (!ready.length) return;
        const continuation = ready.find(event => slotOwners.get(event.slot).entry === engine.lastEntry);
        const event = continuation ?? ready.reduce((oldest, event) => event.created < oldest.created ? event : oldest);
        const queue = queues[lane][event.queue], entry = slotOwners.get(event.slot).entry;
        event.issueIndex = queue.indexOf(event);
        queue.splice(event.issueIndex, 1);
        event.entry = entry;
        event.ready = entry.ready;
        event.start = time;
        event.access = engine.lastEntry === entry ? 'reg' : 'sram';
        event.finish = time + latency[event.access];
        engine.chainIssued = event.access === 'reg' ? engine.chainIssued + 1 : 1;
        engine.running = event;
        entry.queue = event.queue;
        entry.busyUntil = event.finish;
      });
    }

    function completeOperations() {
      engines.forEach(engine => {
        const event = engine.running;
        if (!event || event.finish > time) return;
        if (event.kind === 'write') event.entry.dirtyAt = Math.min(event.entry.dirtyAt, event.finish);
        engine.lastEntry = event.entry;
        engine.running = null;
      });
      for (let i = transfers.length - 1; i >= 0; i--) {
        if (transfers[i].finish > time) continue;
        transfers[i].done();
        transfers[i].element?.remove();
        transfers.splice(i, 1);
      }
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].finish > time) continue;
        events[i].view?.element.remove();
        events.splice(i, 1);
      }
    }

    function advance(end) {
      while (true) {
        completeOperations();
        generateRequests();
        admitRequest();
        prepareMemory();
        dispatchRequests();
        admitRequest();
        prepareMemory();
        if (time >= end) break;
        // Advance to the next real transition, independent of the display frame rate.
        time = Math.min(end, held ? Infinity : nextRequestAt,
          ...events.filter(event => event.arrival > time).map(event => event.arrival),
          ...engines.filter(engine => engine.running).map(engine => engine.running.finish),
          ...transfers.map(movement => movement.finish));
      }
    }

    function restart() {
      time = -24 * requestInterval; nextRequest = 0; nextRequestAt = time; held = null; lastFrame = 0; layout = null;
      events.length = 0; transfers.length = 0; slotOwners.clear(); accessHeat.clear();
      engines.forEach((engine, lane) => {
        engine.running = null; engine.lastEntry = null; engine.chainIssued = 0;
        queues[lane].forEach(queue => { queue.length = 0; });
        caches[lane].clear();
        cacheLines[lane] = [];
        for (let cell = 0; cell < 3; cell++) {
          const slot = 100 + lane + cell * 4;
          const entry = {slot, cell, state: 'resident', ready: -Infinity, busyUntil: -Infinity, dirtyAt: Infinity, drainedAt: Infinity};
          caches[lane].set(slot, entry);
          cacheLines[lane].push({entry, pending: null});
          slotOwners.set(slot, {lane, entry});
        }
      });
      advance(0);
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
      lanes = engines.map((_, index) => {
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
        const running = engines[index].running;
        const fetching = transfers.some(event => event.lane === index && time >= event.start && time < event.finish);
        const writingBack = transfers.some(event => event.lane === index && event.kind === 'writeback' && time >= event.start && time < event.finish);
        const registerHit = running?.access === 'reg', sramAccess = running && !registerHit;
        const blocked = waiting[index].flat().filter(event => {
          const owner = slotOwners.get(event.slot);
          return owner?.lane !== index || owner.entry.state !== 'resident';
        }).length;
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
          const entry = cacheLines[index][cell].entry;
          const resident = entry && entry.ready <= time, active = entry && sramAccess && running.entry === entry;
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
        const queueIndex = admitted[event.lane][event.queue].indexOf(event);
        const held = time >= event.created && time < event.launch;
        if (held) {
          x = layout.out[0] + 32; y = layout.out[1]; opacity = 1;
        } else if (time >= event.launch && time < event.arrival) {
          const ahead = queueIndex;
          const entryX = layout.head - ahead * layout.queueStep;
          const distance = 32 + (route.length + entryX - lane.routeEnd - 32) * (time - event.launch) / (event.arrival - event.launch);
          const point = route.path.getPointAtLength(Math.min(route.length, distance));
          x = point.x + Math.max(0, distance - route.length); y = point.y;
          opacity = event.launch > event.created ? 1 : Math.min(1, (time - event.launch) * 10);
        } else if (queueIndex >= 0) {
          x -= queueIndex * layout.queueStep; opacity = 1;
        } else if (time >= event.start && time < event.start + issueDuration) {
          const u = ease((time - event.start) / issueDuration);
          x -= event.issueIndex * layout.queueStep;
          x += (layout.eu - x) * u; y += (lane.y + 41 - y) * u; opacity = 1 - u;
        }
        element.setAttribute('transform', `translate(${x} ${y})`);
        element.setAttribute('opacity', String(opacity));
        const owner = slotOwners.get(event.slot);
        const waitingForMemory = queueIndex >= 0 && (owner?.lane !== event.lane || owner.entry.state !== 'resident');
        wait.setAttribute('opacity', held || waitingForMemory ? '1' : '0');
        title.textContent = `${event.slot} · ${t(held ? 'Backpressure' : waitingForMemory ? 'waiting for DRAM' : event.kind)}`;
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
      advance(time + dt); draw();
      requestAnimationFrame(animate);
    }
    restart();
    requestAnimationFrame(animate);
  };
  if (document.body.classList.contains('probe-hardware')) window.RamnetRuntime.mountStandalone('hardware');
})();
