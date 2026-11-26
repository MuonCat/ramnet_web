(async () => {
  'use strict';
  const t = window.RamnetRuntime.translateText;
  let data = window.ramnetExperiments;
  if (location.protocol !== 'file:') {
    try {
      const response = await fetch('data/experiments.json?v=results-fit-20261125');
      if (!response.ok) throw Error(`Experiment data: ${response.status}`);
      data = await response.json();
    } catch (error) { console.warn('Using bundled experiment data.', error); }
  }
  const list = document.querySelector('.experiment-tabs');
  const results = document.getElementById('results');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  let current = 0, timer, hovering = false, visible = false, manuallySelected = false;
  let autoplayResults = document.documentElement.dataset.autoplaySection === 'results';
  const mobileResults = window.RamnetRuntime.narrowLayout;
  function schedule() {
    clearTimeout(timer);
    const autoplaying = document.documentElement.classList.contains('is-autoplaying');
    const focused = results.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (!manuallySelected && (autoplaying ? autoplayResults : visible) && !mobileResults.matches && (autoplaying || !hovering && !focused) && !document.hidden) timer = setTimeout(() => select((current + 1) % tabs.length), autoplaying ? 4000 : 10000);
  }
  function select(index) {
    panels[index].style.setProperty('--panel-enter-x', index > current ? '12px' : index < current ? '-12px' : '0px');
    current = index;
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[i].hidden = !active;
    });
    schedule();
  }
  tabs.forEach((tab, index) => {
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', tab.id);
    panels[index].tabIndex = 0;
    tab.addEventListener('click', () => { manuallySelected = true; select(index); });
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      manuallySelected = true;
      select(next);
      tabs[next].focus();
    });
  });
  results.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    hovering = true;
    schedule();
  });
  results.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  results.addEventListener('focusin', schedule);
  results.addEventListener('focusout', () => requestAnimationFrame(schedule));
  results.addEventListener('pointerdown', () => clearTimeout(timer));
  results.addEventListener('pointerup', schedule);
  results.addEventListener('pointercancel', schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('ramnet:autoplay-change', schedule);
  window.addEventListener('ramnet:autoplay-section', event => {
    autoplayResults = event.detail.id === 'results';
    if (autoplayResults) {
      manuallySelected = false;
      if (event.detail.resumeCurrent) {
        event.detail.remainingMs = (tabs.length - current) * 4000;
        schedule();
      } else select(0);
    }
    else schedule();
  });
  mobileResults.addEventListener('change', schedule);
  const visiblePanels = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visiblePanels.add(entry.target);
      else visiblePanels.delete(entry.target);
    }
    const next = visiblePanels.size > 0;
    if (next !== visible) { visible = next; schedule(); }
  });
  [list, ...panels].forEach(panel => observer.observe(panel));

  document.querySelectorAll('.experiment-table').forEach(table => {
    const scroll = table.closest('.experiment-scroll');
    const fitTable = scroll.classList.contains('experiment-fit');
    const columns = data.columns[table.dataset.benchmark];
    const grouped = columns.some(column => column.group);
    const top = table.tHead.insertRow();
    const lower = grouped ? table.tHead.insertRow() : top;
    function addHeader(row, label, scope) {
      const cell = document.createElement('th');
      cell.scope = scope;
      cell.textContent = t(label);
      row.append(cell);
      return cell;
    }
    const modelHeader = addHeader(top, 'Model', 'col');
    if (grouped) modelHeader.rowSpan = 2;
    columns.forEach((column, index) => {
      if (column.group && (!index || column.group !== columns[index - 1].group)) {
        const group = addHeader(top, column.group, 'colgroup');
        group.colSpan = columns.filter(item => item.group === column.group).length;
      }
      const header = addHeader(column.group ? lower : top,
        `${t(column.label)} ${column.better === 'lower' ? '↓' : '↑'}`, 'col');
      if (grouped && !column.group) header.rowSpan = 2;
      header.dataset.columnIndex = index;
    });
    const headerGrid = [], headerColumns = new Map(), headers = [];
    // Resolve both ordinary headers and the two-level S-NIAH headers.
    [...table.tHead.rows].forEach((row, y) => {
      headerGrid[y] ??= [];
      let x = 0;
      for (const cell of row.cells) {
        while (headerGrid[y][x]) x++;
        const columns = Array.from({length: cell.colSpan}, (_, i) => x + i);
        headerColumns.set(cell, columns);
        for (let yy = y; yy < y + cell.rowSpan; yy++) {
          headerGrid[yy] ??= [];
          for (const column of columns) headerGrid[yy][column] = cell;
        }
        if (cell.colSpan === 1) headers[x] = cell;
        x += cell.colSpan;
      }
    });
    for (const groupData of data.tables[table.dataset.benchmark]) {
      const group = table.createTBody();
      group.dataset.scale = groupData.scale;
      const divider = group.insertRow();
      divider.className = 'experiment-scale';
      const heading = document.createElement('th');
      heading.scope = 'rowgroup';
      heading.colSpan = headers.length;
      const label = document.createElement('div');
      label.className = 'experiment-scale-label';
      const text = document.createElement('span');
      text.className = 'experiment-scale-text';
      const size = document.createElement('b');
      size.textContent = groupData.scale;
      const unit = document.createElement('span');
      unit.textContent = t('parameters');
      text.append(size, unit);
      label.append(text);
      heading.append(label);
      divider.append(heading);
      for (const item of groupData.rows) {
        const row = group.insertRow();
        if (item.model.startsWith('RAM-Net')) row.className = 'ramnet-row';
        const model = document.createElement('th');
        model.scope = 'row';
        model.textContent = item.model;
        row.append(model);
        for (const value of item.values) row.insertCell().textContent = value;
      }
    }
    const rows = [];
    for (const group of table.tBodies) {
      const groupRows = [...group.rows].filter(row => !row.classList.contains('experiment-scale'));
      rows.push(...groupRows);
      for (let column = 1; column < headers.length; column++) {
        const direction = columns[column - 1].better === 'lower' ? -1 : 1;
        const values = groupRows.map(row => Number.parseFloat(row.cells[column].textContent));
        const ranked = [...new Set(values.filter(Number.isFinite))].sort((a, b) => direction * (b - a));
        groupRows.forEach((row, index) => {
          const cell = row.cells[column], value = document.createElement('span');
          value.className = 'experiment-value';
          value.append(...cell.childNodes);
          if (values[index] === ranked[0]) { const best = document.createElement('strong'); best.append(...value.childNodes); value.append(best); }
          else if (values[index] === ranked[1]) { const second = document.createElement('span'); second.className = 'runner-up'; second.append(...value.childNodes); value.append(second); }
          cell.append(value);
          if (fitTable) {
            const label = document.createElement('span');
            label.className = 'experiment-cell-label';
            label.setAttribute('aria-hidden', 'true');
            label.textContent = t(columns[column - 1].label);
            cell.append(label);
          }
          if (!Number.isFinite(values[index])) return;
          const better = values.filter(other => direction * other > direction * values[index]).length;
          const worse = values.filter(other => direction * other < direction * values[index]).length;
          // Midranks give ties the same indicator and keep an all-tied column neutral.
          const standing = values.length > 1 ? .5 + (worse - better) / (2 * (values.length - 1)) : .5;
          const level = Math.round(standing * 4);
          cell.style.setProperty('--relative-position', `${standing * 100}%`);
          cell.title = `${t(['Lower', 'Lower-middle', 'Middle', 'Upper-middle', 'Upper'][level])} ${t('relative standing')} · ${group.dataset.scale} ${t('models')} · ${t(direction > 0 ? 'Higher values are better' : 'Lower values are better')} · ${t('Red to green indicates weaker to stronger relative performance')}`;
        });
      }
    }
    for (const cell of table.tHead.querySelectorAll('th[data-column-index]')) {
      const column = columns[Number(cell.dataset.columnIndex)];
      const heading = cell.textContent.trim();
      const label = document.createElement('span');
      label.className = 'experiment-heading-label';
      if (column.lines) {
        cell.classList.add('stacked-heading');
        for (const [index, text] of column.lines.entries()) {
          const line = document.createElement('span');
          line.textContent = index ? t(text) : t(text) + ' ';
          label.append(line);
        }
      } else label.textContent = t(column.label);
      const arrow = document.createElement('span');
      arrow.className = 'experiment-heading-arrow';
      arrow.textContent = column.better === 'lower' ? '↓' : '↑';
      arrow.setAttribute('aria-hidden', 'true');
      const wrapper = document.createElement('span');
      wrapper.className = 'experiment-heading';
      wrapper.append(label, arrow);
      cell.setAttribute('aria-label', heading);
      cell.replaceChildren(wrapper);
    }
    if (fitTable) {
      // Keep table semantics in browsers that infer roles from CSS display.
      const roles = {thead: 'rowgroup', tbody: 'rowgroup', tr: 'row', td: 'cell'};
      table.querySelectorAll('thead, tbody, tr, th, td').forEach(element => {
        element.setAttribute('role', roles[element.localName] ||
          (element.scope === 'col' ? 'columnheader' : 'rowheader'));
      });
    }
    let activeCell = null, highlighted = [];
    function clear() {
      for (const node of highlighted) node.classList.remove('is-row', 'is-column', 'is-cell');
      highlighted = [];
      activeCell = null;
    }
    if (!fitTable) {
      scroll.classList.add('is-scrollable');
      let fullTableWidth = 0;
      function updateTableMode() {
        if (!scroll.clientWidth) return;
        if (!fullTableWidth) {
          table.style.minWidth = '0';
          fullTableWidth = table.getBoundingClientRect().width;
          table.style.removeProperty('min-width');
        }
        scroll.classList.toggle('is-wide', scroll.parentElement.clientWidth + 1 < fullTableWidth);
        const scrolling = scroll.clientWidth + 1 < fullTableWidth;
        if (scroll.classList.contains('is-scrollable') === scrolling) return;
        scroll.classList.toggle('is-scrollable', scrolling);
        if (scrolling) clear();
      }
      const tableObserver = new ResizeObserver(updateTableMode);
      tableObserver.observe(scroll);
      tableObserver.observe(scroll.parentElement);
      updateTableMode();
    }
    function mark(node, name) { node.classList.add(name); highlighted.push(node); }
    table.addEventListener('pointerover', event => {
      if (scroll.classList.contains('is-scrollable') || event.pointerType === 'touch') return;
      const cell = event.target.closest('td, th');
      if (cell === activeCell) return;
      clear();
      if (!cell || cell.closest('.experiment-scale')) return;
      activeCell = cell;
      const columns = headerColumns.get(cell) || [cell.cellIndex];
      if (cell.parentElement.parentElement.tagName === 'TBODY') mark(cell.parentElement, 'is-row');
      if (columns[0] === 0) return;
      for (const row of rows) for (const column of columns) mark(row.cells[column], 'is-column');
      for (const [header, covered] of headerColumns) {
        if (covered.some(column => columns.includes(column))) mark(header, 'is-column');
      }
      mark(cell, 'is-cell');
    });
    table.addEventListener('pointerleave', clear);
  });
  const decodingChart = document.querySelector('.decoding-chart');
  if (decodingChart && data.decoding) drawDecoding(decodingChart, data.decoding);
  select(0);
  list.hidden = false;
  window.dispatchEvent(new Event('ramnet:results-layout'));

  function drawDecoding(container, decoding) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const styles = {
      'RAM-Net Top-8': {color: 'var(--color-chartTop8)', ramnet: true},
      'RAM-Net Top-16': {color: 'var(--color-chartTop16)', ramnet: true},
      'RAM-Net Top-32': {color: 'var(--color-chartTop32)', ramnet: true},
      GSA: {marker: 'circle', dash: '9 4'},
      GLA: {marker: 'square', dash: '2 3'},
      DeltaNet: {marker: 'triangle', dash: '6 3'},
      'Gated DeltaNet': {marker: 'triangle-down', dash: '12 3'},
      Mamba2: {marker: 'diamond', dash: '8 3 2 3'}
    };
    const series = decoding.series.map(item => ({...item, ...styles[item.model]}));
    const legend = document.createElement('ul');
    legend.className = 'decoding-legend';
    legend.setAttribute('aria-hidden', 'true');
    for (const item of series) {
      const entry = document.createElement('li');
      const key = document.createElementNS(svgNS, 'svg');
      key.setAttribute('viewBox', '0 0 26 12');
      key.append(node('line', {x1: 1, y1: 6, x2: 25, y2: 6, class: item.ramnet ? 'decoding-line is-ramnet' : 'decoding-line', style: lineStyle(item)}),
        marker(item, 13, 6));
      entry.append(key, item.model);
      legend.append(entry);
    }
    container.before(legend);
    let width = 0;
    new ResizeObserver(() => {
      const next = Math.round(container.clientWidth);
      if (!next || next === width) return;
      width = next;
      render();
    }).observe(container);

    function node(name, attributes = {}, text) {
      const element = document.createElementNS(svgNS, name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function lineStyle(item) {
      return `stroke:${item.color || 'var(--color-chartBaseline)'}` + (item.dash ? `;stroke-dasharray:${item.dash}` : '');
    }
    function marker(item, x, y) {
      const fill = item.color || 'var(--color-chartBaseline)', r = 4.2;
      const shapes = {
        square: `M${x - r * .85} ${y - r * .85}h${r * 1.7}v${r * 1.7}h${-r * 1.7}z`,
        triangle: `M${x} ${y - r * 1.1}L${x + r} ${y + r * .75}H${x - r}z`,
        'triangle-down': `M${x} ${y + r * 1.1}L${x + r} ${y - r * .75}H${x - r}z`,
        diamond: `M${x} ${y - r * 1.2}L${x + r * 1.05} ${y}L${x} ${y + r * 1.2}L${x - r * 1.05} ${y}z`
      };
      return item.marker && shapes[item.marker] ?
        node('path', {d: shapes[item.marker], class: 'decoding-marker', style: `fill:${fill}`}) :
        node('circle', {cx: x, cy: y, r, class: 'decoding-marker', style: `fill:${fill}`});
    }
    function render() {
      const compact = width < 560;
      const margin = {top: 30, right: compact ? 116 : 156, bottom: 46, left: compact ? 38 : 48};
      const height = compact ? 300 : 360;
      const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
      const batches = decoding.batches, yMax = 12000;
      const x = batch => margin.left + (batch - batches[0]) / (batches.at(-1) - batches[0]) * plotWidth;
      const y = value => margin.top + (1 - value / yMax) * plotHeight;
      const svg = node('svg', {width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true'});
      const grid = node('g', {class: 'decoding-grid'});
      for (let value = 0; value <= yMax; value += 2000) {
        grid.append(node('line', {x1: margin.left, x2: margin.left + plotWidth, y1: y(value), y2: y(value), class: value ? '' : 'is-baseline'}));
        grid.append(node('text', {x: margin.left - 8, y: y(value), class: 'decoding-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle'}, value ? `${value / 1000}K` : '0'));
      }
      for (const batch of batches) {
        grid.append(node('text', {x: x(batch), y: margin.top + plotHeight + 18, class: 'decoding-tick', 'text-anchor': 'middle'}, batch));
      }
      grid.append(node('text', {x: margin.left + plotWidth / 2, y: height - 6, class: 'decoding-axis-title', 'text-anchor': 'middle'}, t('Batch size')));
      grid.append(node('text', {x: margin.left - (compact ? 30 : 40), y: 12, class: 'decoding-axis-title'}, t('Throughput (tokens/s)')));
      svg.append(grid);

      // Baselines sit behind the RAM-Net lines; markers are drawn after every line.
      const ordered = [...series.filter(item => !item.ramnet), ...series.filter(item => item.ramnet).reverse()];
      const lines = node('g'), markers = node('g');
      for (const item of ordered) {
        const points = item.values.map((value, index) => [x(batches[index]), y(value)]);
        lines.append(node('path', {d: 'M' + points.map(point => point.join(' ')).join('L'),
          class: item.ramnet ? 'decoding-line is-ramnet' : 'decoding-line', style: lineStyle(item), ...(item.ramnet && {pathLength: 1})}));
        for (const [px, py] of points) markers.append(marker(item, px, py));
      }
      svg.append(lines, markers);

      const top8 = series.find(item => item.model === 'RAM-Net Top-8');
      const fastest = series.filter(item => !item.ramnet).reduce((best, item) => item.values.at(-1) > best.values.at(-1) ? item : best);
      const arrowX = x(batches.at(-1)) - (compact ? 14 : 18), high = y(top8.values.at(-1)) + 9, low = y(fastest.values.at(-1)) - 9;
      const head = 6, half = 3.5;
      const arrow = node('g', {class: 'decoding-arrow'});
      arrow.append(node('line', {x1: arrowX, x2: arrowX, y1: high + head - 1, y2: low - head + 1, class: 'decoding-arrow-halo'}),
        node('line', {x1: arrowX, x2: arrowX, y1: high + head - 1, y2: low - head + 1}),
        node('path', {d: `M${arrowX} ${high}L${arrowX + half} ${high + head}H${arrowX - half}z`}),
        node('path', {d: `M${arrowX} ${low}L${arrowX + half} ${low - head}H${arrowX - half}z`}),
        node('text', {x: arrowX - 9, y: (high + low) / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'decoding-ratio'},
          `${(top8.values.at(-1) / fastest.values.at(-1)).toFixed(1)}×`));
      svg.append(arrow);

      // End labels: merge names whose lines end together, then push the rest apart.
      const lineHeight = compact ? 14 : 15, endX = x(batches.at(-1));
      let labels = series.map(item => ({names: [item.model], target: y(item.values.at(-1))})).sort((a, b) => a.target - b.target);
      labels = labels.reduce((merged, label) => {
        const previous = merged.at(-1);
        if (previous && label.target - previous.target < 5) {
          previous.names.push(...label.names);
          previous.target = (previous.target * (previous.names.length - 1) + label.target) / previous.names.length;
        } else merged.push({...label});
        return merged;
      }, []);
      labels.forEach(label => {
        label.y = label.target;
        label.lines = compact ? label.names.map(name => name.replace('RAM-Net ', '')) : [label.names.join(' / ')];
      });
      for (let pass = 0; pass < 40; pass++) {
        for (let index = 1; index < labels.length; index++) {
          const previous = labels[index - 1], label = labels[index];
          const overlap = previous.y + (previous.lines.length + label.lines.length) * lineHeight / 2 - label.y;
          if (overlap > 0) { previous.y -= overlap / 2; label.y += overlap / 2; }
        }
      }
      const labelGroup = node('g', {class: 'decoding-labels'});
      for (const label of labels) {
        const textX = endX + (compact ? 16 : 20);
        if (Math.abs(label.y - label.target) > 2) labelGroup.append(node('path', {d: `M${endX + 7} ${label.target}L${textX - 4} ${label.y}`, class: 'decoding-leader'}));
        const ramnet = label.names[0].startsWith('RAM-Net');
        const text = node('text', {x: textX, y: label.y - (label.lines.length - 1) * lineHeight / 2, 'dominant-baseline': 'middle', class: ramnet ? 'decoding-label is-ramnet' : 'decoding-label'});
        label.lines.forEach((line, index) => text.append(node('tspan', {x: textX, dy: index ? lineHeight : 0}, line)));
        labelGroup.append(text);
      }
      svg.append(labelGroup);
      container.replaceChildren(svg);
    }
  }
})();
