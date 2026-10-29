(() => {
  'use strict';
  const dataUrl = new URL('../data/probes/slot_usage.json?v=token-events-20261016', document.currentScript.src);
  window.RamnetAnimations ??= {};
  window.RamnetAnimations.slot_usage = function mount(scope) {
    const {document, requestAnimationFrame, translateText: t} = scope;
    const palette = window.RamnetPalette;
    const runtime = window.RamnetRuntime;
    const $ = id => document.getElementById(id);
    const clamp = value => Math.max(0, Math.min(1, value));
    const lerp = (a, b, u) => a + (b - a) * u;
    const ease = u => u * u * (3 - 2 * u);
    const introMs = 800, countMs = 10000, totalMs = 14000;
    const canvas = $('field'), ctx = canvas.getContext('2d');
    const tokenRadius = 12, tokenTrack = document.createElement('div');
    tokenTrack.className = 'usage-token-track';
    const chips = Array.from({length: tokenRadius * 2 + 1}, () => {
      const chip = document.createElement('div');
      chip.className = 'token near'; tokenTrack.append(chip);
      return chip;
    });
    $('tokenRow').append(tokenTrack);
    const slotCount = 1024, mono = '"SFMono-Regular", Consolas, "Microsoft YaHei", monospace';
    const topSlotCount = Math.ceil(slotCount * .1);
    const quantiles = Float64Array.from({length: slotCount}, (_, rank) => normalQuantile(1 - (rank + .5) / slotCount));
    const barColors = Array.from({length: 32}, (_, i) => palette.mix(palette.color('paper'), palette.tone('sky'), .18 + .72 * i / 31));
    let data, corpus, visits, tokenIds, fit, totalTokens, width = 0, height = 0;
    let elapsed = 0, playing = true, hovered = false, lastFrame = 0, lastUi = 0, hit = null;
    const counts = new Uint32Array(slotCount), order = new Uint16Array(slotCount), slotRanks = new Uint16Array(slotCount);
    const ranks = new Float64Array(slotCount), previousRanks = new Uint16Array(slotCount);
    const activity = new Float64Array(slotCount), lastVisit = new Float64Array(slotCount);
    let processed = 0, activeSlots = 0, lastCountTime = 0, loading = false, selectionSerial = 0;
    let rows = 1, ceiling = 1, plot, lastToken = -1, tokenPitch = 0;
    scope.setCycleDuration(totalMs / 1000);

    async function inflate(encoded, length) {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const buffer = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if (buffer.byteLength !== length * Uint16Array.BYTES_PER_ELEMENT) throw new Error('Unexpected slot usage dimensions.');
      return new Uint16Array(buffer);
    }

    function resetCounts() {
      counts.fill(0); lastVisit.fill(-Infinity);
      processed = activeSlots = lastCountTime = 0;
      lastToken = -1;
      for (let slot = 0; slot < slotCount; slot++) order[slot] = slotRanks[slot] = ranks[slot] = previousRanks[slot] = slot;
    }

    function normalQuantile(probability) {
      let low = -8, high = 8;
      for (let i = 0; i < 28; i++) {
        const x = (low + high) / 2, scale = 1 / (1 + .2316419 * Math.abs(x));
        // Abramowitz–Stegun approximation to the standard normal CDF.
        const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * scale *
          (.319381530 + scale * (-.356563782 + scale * (1.781477937 + scale * (-1.821255978 + scale * 1.330274429))));
        const cumulative = x >= 0 ? 1 - tail : tail;
        if (cumulative < probability) low = x; else high = x;
      }
      return (low + high) / 2;
    }

    function fitLogNormal(values) {
      const sorted = [...values].sort((a, b) => b - a), total = sorted.reduce((a, b) => a + b, 0);
      if (!total) return {sigma: 0, counts: sorted};
      const target = sorted.reduce((sum, n, i) => sum + n / total * quantiles[i], 0);
      let low = 0, high = 8;
      for (let i = 0; i < 40; i++) {
        const sigma = (low + high) / 2;
        let mass = 0, moment = 0;
        for (const z of quantiles) { const p = Math.exp(sigma * (z - quantiles[0])); mass += p; moment += p * z; }
        if (moment / mass < target) low = sigma; else high = sigma;
      }
      const sigma = (low + high) / 2, weights = Array.from(quantiles, z => Math.exp(sigma * (z - quantiles[0])));
      const mass = weights.reduce((a, b) => a + b, 0);
      return {sigma, counts: weights.map(p => p / mass * total)};
    }

    async function choose() {
      const ticket = ++selectionSerial;
      const nextHead = data.heads.find(item => item.id === $('head').value);
      const nextCorpus = data.corpora.find(item => item.id === $('corpus').value);
      const context = nextHead.contexts.find(item => item.corpus === nextCorpus.id);
      loading = true;
      const [nextVisits, nextIds] = await Promise.all([
        inflate(context.events_u16, nextCorpus.token_count * 16),
        inflate(nextCorpus.token_ids_u16, nextCorpus.token_count)
      ]);
      if (ticket !== selectionSerial) return;
      corpus = nextCorpus; visits = nextVisits; tokenIds = nextIds;
      const values = new Uint32Array(slotCount);
      for (const slot of visits) values[slot]++;
      totalTokens = tokenIds.length;
      fit = fitLogNormal(values);
      resetCounts();
      elapsed = runtime.reducedMotion.matches ? countMs + 700 : 0;
      playing = true;
      lastFrame = 0; loading = false;
      clearHover();
      render();
    }

    function tokenClock() {
      return elapsed < introMs ? 12 * elapsed / introMs :
        12 + (totalTokens - 12) * clamp((elapsed - introMs) / (countMs - introMs)) ** 1.35;
    }

    function timeForToken(n) {
      return n <= 12 ? n * introMs / 12 : introMs + (countMs - introMs) * ((n - 12) / (totalTokens - 12)) ** (1 / 1.35);
    }

    function increment(slot) {
      const firstVisit = counts[slot]++ === 0;
      if (firstVisit) activeSlots++;
      let rank = slotRanks[slot];
      while (rank > 0) {
        const other = order[rank - 1];
        if (counts[other] > counts[slot] || counts[other] === counts[slot] && other < slot) break;
        order[rank] = other; slotRanks[other] = rank; rank--;
      }
      order[rank] = slot; slotRanks[slot] = rank;
      if (firstVisit) previousRanks[slot] = rank;
    }

    function updateCounts() {
      const clock = tokenClock(), target = Math.min(totalTokens, Math.floor(clock + 1e-8));
      if (target < processed) resetCounts();
      // Process every token and every visit, including those between display refreshes.
      while (processed < target) {
        if (processed < 12) previousRanks.set(slotRanks);
        lastCountTime = timeForToken(processed + 1);
        for (let k = 0; k < 16; k++) {
          const slot = visits[processed * 16 + k];
          increment(slot); lastVisit[slot] = lastCountTime;
        }
        processed++;
      }
      const movement = ease(clamp((elapsed - lastCountTime) / 40));
      const peak = Math.max(1, counts[order[0]]), settled = ease(clamp((elapsed - countMs) / 700));
      for (let slot = 0; slot < slotCount; slot++) {
        ranks[slot] = !hovered && elapsed < introMs && counts[slot] ? lerp(previousRanks[slot], slotRanks[slot], movement) : slotRanks[slot];
        const recent = 1 - ease(clamp((elapsed - lastVisit[slot]) / 260));
        activity[slot] = lerp(recent, counts[slot] / peak, settled);
      }
      rows = Math.max(1, activeSlots);
      ceiling = Math.max(peak, fit.counts[0] * processed / totalTokens) * 1.12;
      const index = hovered ? Math.max(0, processed - 1) : Math.min(totalTokens - 1, processed);
      return {index, hits: visits.subarray(index * 16, (index + 1) * 16), u: hovered ? 0 : clamp(clock - processed)};
    }

    function text(value, x, y, size = 11, color = palette.neutral(5), align = 'center') {
      ctx.font = `500 ${size}px ${mono}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(t(value), x, y);
    }

    const countX = n => plot.x + plot.w * Math.log1p(n) / Math.log1p(ceiling);
    const rowY = rank => plot.y + (rank + .5) * plot.h / rows;

    function pendingRank(slot, additions) {
      const value = counts[slot] + additions.get(slot);
      let rank = 0;
      for (let other = 0; other < slotCount; other++) {
        const count = counts[other] + (additions.get(other) || 0);
        if (count > value || count === value && other < slot) rank++;
      }
      return rank;
    }

    function drawTokens(index, part) {
      if (index !== lastToken) {
        chips.forEach((chip, n) => {
          const position = index - tokenRadius + n;
          const piece = position >= 0 && position < totalTokens ? data.vocabulary[String(tokenIds[position])] : '';
          chip.textContent = piece ? piece.replace(/^▁/, '').replace(/▁/g, '·').replace(/\n/g, '↵').trim() || '▁' : '';
          chip.title = piece;
          chip.className = 'token ' + (n === tokenRadius ? 'active' : 'near');
        });
        lastToken = index;
      }
      const offset = part * tokenPitch;
      tokenTrack.style.transform = `translate(calc(-50% - ${offset}px), -50%)`;
      return width / 2 - offset;
    }

    function draw() {
      if (!visits || !width) return;
      const frame = updateCounts(), sky = palette.tone('sky'), purple = palette.tone('purple');
      ctx.clearRect(0, 0, width, height);
      plot = {x: width < 500 ? 38 : 52, y: 61, w: width - (width < 500 ? 50 : 74), h: height - 112};
      text('Slot rank', plot.x, 46, 10, palette.neutral(5), 'left');
      text('Access count · log scale', plot.x + plot.w, height - 7, 10, palette.neutral(5), 'right');
      const ticks = [{n: 0, major: true}];
      for (let decade = 1; decade <= ceiling; decade *= 10) {
        for (let digit = 1; digit < 10 && digit * decade <= ceiling; digit++) {
          ticks.push({n: digit * decade, major: digit === 1});
        }
      }
      let lastTick = -Infinity;
      for (const {n, major} of ticks) {
        const x = countX(n);
        if (major && x - lastTick > 30) {
          text(n >= 1000 ? `${n / 1000}k` : String(n), x, plot.y + plot.h + 18, 10);
          lastTick = x;
        }
      }
      for (const rank of new Set([0, Math.floor((rows - 1) / 2), Math.ceil(rows) - 1])) {
        text(String(rank + 1), plot.x - 9, rowY(rank) + 3, 10, palette.neutral(5), 'right');
      }
      ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
      const uniformX = countX(processed * 16 / slotCount);
      ctx.fillStyle = palette.withAlpha(palette.neutral(5), .12);
      ctx.fillRect(plot.x, plot.y, uniformX - plot.x, plot.h);
      const pitch = plot.h / rows, dense = pitch * (devicePixelRatio || 1) < 2;
      const cutoff = hit === null ? -1 : slotRanks[hit];
      if (cutoff >= 0) {
        const rowHeight = Math.max(4, pitch);
        ctx.fillStyle = palette.withAlpha(sky, .18);
        ctx.fillRect(plot.x, rowY(ranks[hit]) - rowHeight / 2, plot.w, rowHeight);
      }
      ctx.fillStyle = barColors[0];
      ctx.beginPath();
      for (const slot of order) {
        if (counts[slot] <= .01) continue;
        const barHeight = dense ? pitch : pitch * .75;
        ctx.rect(plot.x, rowY(ranks[slot]) - barHeight / 2, countX(counts[slot]) - plot.x, barHeight);
      }
      ctx.fill();
      for (const slot of order) {
        if (counts[slot] <= .01) continue;
        const strength = hovered ? (slotRanks[slot] <= cutoff ? 1 : 0) : palette.weight(activity[slot], sky);
        if (strength <= 0) continue;
        const barHeight = dense ? pitch : pitch * .75;
        ctx.fillStyle = barColors[Math.round(strength * (barColors.length - 1))];
        ctx.fillRect(plot.x, rowY(ranks[slot]) - barHeight / 2, countX(counts[slot]) - plot.x, barHeight);
      }
      for (const {n, major} of ticks) {
        const x = countX(n);
        ctx.strokeStyle = palette.withAlpha(palette.neutral(8), major ? .4 : .18);
        ctx.lineWidth = major ? .7 : .5;
        ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
      }
      ctx.lineWidth = 1.6; ctx.strokeStyle = purple; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      fit.counts.forEach((n, rank) => { if (rank < rows) { const x = countX(n * processed / totalTokens), y = rowY(rank); if (!rank) ctx.moveTo(x, y); else ctx.lineTo(x, y); } });
      ctx.stroke();
      ctx.setLineDash([]);
      if (cutoff >= 0) {
        const y = rowY(ranks[hit]) + pitch / 2;
        ctx.strokeStyle = sky; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      }
      ctx.restore();
      const tokenX = drawTokens(frame.index, frame.u);
      if (elapsed < countMs && !hovered) {
        const additions = new Map();
        for (const slot of frame.hits) additions.set(slot, (additions.get(slot) || 0) + 1);
        const slow = elapsed < introMs, pendingRows = Math.max(1, activeSlots + (slow ? [...additions.keys()].filter(slot => !counts[slot]).length : 0));
        ctx.fillStyle = sky;
        for (const slot of frame.hits) {
          const rank = slow ? pendingRank(slot, additions) : ranks[slot];
          const endY = plot.y + (rank + .5) * plot.h / pendingRows;
          const endX = countX(counts[slot] + (slow ? additions.get(slot) : 0));
          const u = ease(frame.u), x = lerp(tokenX, endX, u), y = lerp(38, endY, u);
          ctx.globalAlpha = Math.min(1, frame.u * 8, (1 - frame.u) * 8);
          ctx.fillRect(x - 2, y - 1.5, 4, 3);
        }
        ctx.globalAlpha = 1;
      }
    }

    function ui() {
      if (!visits) return;
      const total = processed * 16;
      $('topShare').textContent = total ? (order.subarray(0, topSlotCount).reduce((sum, slot) => sum + counts[slot], 0) / total * 100).toFixed(1) + '%' : '—';
      let entropy = 0;
      if (total) for (const count of counts) if (count > 0) { const p = count / total; entropy -= p * Math.log(p); }
      $('effective').textContent = total ? Math.exp(entropy).toFixed(1) : '—';
      $('sigma').textContent = fit.sigma.toFixed(2);
      $('sampleInfo').textContent = `${corpus.sample_count} ${t('samples')} · ${t('Read + write, Top-8 each')} · ${t('Canonical addresses')}`;
      runtime.setPlaybackIcon($('play'), playing);
    }

    function render() { draw(); ui(); }
    function resize() {
      const box = canvas.getBoundingClientRect();
      width = canvas.clientWidth; height = canvas.clientHeight;
      if (!width || !height || !box.width) return;
      tokenPitch = chips[0].offsetWidth + parseFloat(getComputedStyle(tokenTrack).columnGap);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
      if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;
      canvas.width = pixelWidth; canvas.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }
    function clearHover() { hovered = false; hit = null; $('tip').classList.add('hidden'); }
    canvas.onpointermove = event => {
      if (!visits || runtime.compactInteractions.matches || event.pointerType === 'touch') return;
      const box = canvas.getBoundingClientRect(), x = (event.clientX - box.left) * width / box.width, y = (event.clientY - box.top) * height / box.height;
      const inside = x >= plot.x && x <= plot.x + plot.w && y >= plot.y && y <= plot.y + plot.h;
      const entering = inside && !hovered;
      hovered = inside;
      if (entering) {
        if (elapsed < countMs) elapsed = timeForToken(Math.min(totalTokens, Math.floor(tokenClock() + 1e-8) + 1));
        updateCounts();
        previousRanks.set(slotRanks);
      }
      hit = hovered ? order.reduce((best, slot) => counts[slot] > .01 && (best === null || Math.abs(rowY(ranks[slot]) - y) < Math.abs(rowY(ranks[best]) - y)) ? slot : best, null) : null;
      const tip = $('tip'); tip.classList.toggle('hidden', hit === null);
      if (hit !== null) {
        const rank = slotRanks[hit] + 1;
        const accessShare = order.subarray(0, rank).reduce((sum, slot) => sum + counts[slot], 0) / (processed * 16) * 100;
        const slotShare = rank / slotCount * 100;
        tip.textContent = `${t('Slot')} ${String(hit).padStart(4, '0')} · ${t('Rank')} ${rank}\n${counts[hit].toLocaleString('en-US')} ${t('accesses')}\n${t('Cumulative slots')}: ${rank.toLocaleString('en-US')} / ${slotCount.toLocaleString('en-US')} (${slotShare.toFixed(1)}%)\n${t('Cumulative access share')}: ${accessShare.toFixed(1)}%`;
        tip.style.left = Math.max(0, Math.min(width - tip.offsetWidth, x + 12)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
      }
      render();
    };
    canvas.onpointerleave = () => { clearHover(); render(); };
    runtime.compactInteractions.addEventListener('change', () => { clearHover(); resize(); });
    $('restart').onclick = () => { elapsed = 0; playing = true; clearHover(); lastFrame = 0; render(); };
    $('play').onclick = () => { playing = !playing; render(); };
    $('head').onchange = $('corpus').onchange = () => choose().catch(showError);
    scope.onAutoplayStart(event => {
      if (!event.detail?.resumeCurrent || elapsed >= totalMs) elapsed = 0;
      if (event.detail) event.detail.remainingMs = totalMs - elapsed;
      clearHover(); playing = true; lastFrame = 0; render();
    });
    new ResizeObserver(resize).observe(canvas);
    document.addEventListener('visibilitychange', () => { lastFrame = 0; });

    function animate(now) {
      const dt = lastFrame ? Math.min(now - lastFrame, 80) : 0;
      lastFrame = now;
      if (playing && !hovered && !loading) elapsed = (elapsed + dt) % totalMs;
      draw();
      if (now - lastUi > 80) { ui(); lastUi = now; }
      requestAnimationFrame(animate);
    }
    function showError(error) {
      console.error(error);
      loading = false; playing = false;
      let status = $('status');
      if (!status) {
        status = document.createElement('p'); status.id = 'status'; status.className = 'usage-status';
        $('chart').append(status);
      }
      status.textContent = t('Unable to load access counts. Please reload the page.');
      status.setAttribute('role', 'alert');
    }

    fetch(dataUrl).then(response => {
      if (!response.ok) throw new Error(`Slot usage request failed: ${response.status}`);
      return response.json();
    }).then(async value => {
      if (value.schema !== 'slot-usage.tokens.v1' || value.slot_count !== slotCount) throw new Error('Unsupported slot usage data.');
      data = value;
      $('head').replaceChildren(...[false, true].map(cape => {
        const group = document.createElement('optgroup');
        group.label = cape ? 'CAPE' : t('Content-only');
        group.append(...data.heads.filter(item => item.uses_cape === cape).map(item => new Option(`L${item.layer} · H${item.head}`, item.id)));
        return group;
      }));
      $('corpus').replaceChildren(...data.corpora.map(item => new Option(t(item.label), item.id)));
      $('head').value = data.heads[0].id; $('corpus').value = data.corpora[0].id;
      await choose(); resize(); $('status').remove();
      $('head').disabled = $('corpus').disabled = false;
      requestAnimationFrame(animate);
    }).catch(showError);
  };
  if (document.body.classList.contains('probe-usage')) window.RamnetRuntime.mountStandalone('slot_usage');
})();
