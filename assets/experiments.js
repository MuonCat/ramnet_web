(async () => {
  'use strict';
  const t = window.RamnetRuntime.translateText;
  let data = window.ramnetExperiments;
  if (location.protocol !== 'file:') {
    try {
      const response = await fetch('data/experiments.json');
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
    let activeCell = null, highlighted = [];
    function clear() {
      for (const node of highlighted) node.classList.remove('is-row', 'is-column', 'is-cell');
      highlighted = [];
      activeCell = null;
    }
    const scroll = table.closest('.experiment-scroll');
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
  select(0);
  list.hidden = false;
  window.dispatchEvent(new Event('ramnet:results-layout'));
})();
