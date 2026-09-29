(() => {
  'use strict';
  const list = document.querySelector('.experiment-tabs');
  const results = document.getElementById('results');
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  let current = 0, timer, hovering = false, visible = false;
  const mobileResults = matchMedia('(max-width: 760px)');
  function schedule() {
    clearTimeout(timer);
    const focused = results.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (visible && !mobileResults.matches && !hovering && !focused && !document.hidden) timer = setTimeout(() => select((current + 1) % tabs.length), 10000);
  }
  function select(index) {
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
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
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
    const rows = [];
    for (const group of table.tBodies) {
      const groupRows = [...group.rows].filter(row => !row.classList.contains('experiment-scale'));
      rows.push(...groupRows);
      for (let column = 1; column < headers.length; column++) {
        const heading = headers[column].textContent;
        const groupHeading = headerGrid[0][column];
        const direction = heading.includes('↓') ? -1 : heading.includes('↑') ? 1 : 0;
        const values = groupRows.map(row => Number.parseFloat(row.cells[column].textContent));
        groupRows.forEach((row, index) => {
          const cell = row.cells[column], value = document.createElement('span');
          cell.dataset.label = [groupHeading.colSpan > 1 ? groupHeading.textContent : '', heading].filter(Boolean).join(' · ');
          value.className = 'experiment-value';
          value.append(...cell.childNodes);
          cell.append(value);
          if (!direction) return;
          const better = values.filter(other => direction * other > direction * values[index]).length;
          const worse = values.filter(other => direction * other < direction * values[index]).length;
          // Midranks give ties the same indicator and keep an all-tied column neutral.
          const standing = values.length > 1 ? .5 + (worse - better) / (2 * (values.length - 1)) : .5;
          const level = Math.round(standing * 4);
          cell.style.setProperty('--relative-position', `${standing * 100}%`);
          cell.title = `${['Lower', 'Lower-middle', 'Middle', 'Upper-middle', 'Upper'][level]} relative standing · ${group.dataset.scale} models · ${direction > 0 ? 'Higher' : 'Lower'} values are better · Red to green indicates weaker to stronger relative performance`;
        });
      }
    }
    let activeCell = null, highlighted = [];
    function clear() {
      for (const node of highlighted) node.classList.remove('is-row', 'is-column', 'is-cell');
      highlighted = [];
      activeCell = null;
    }
    function mark(node, name) { node.classList.add(name); highlighted.push(node); }
    table.addEventListener('pointerover', event => {
      if (mobileResults.matches || event.pointerType === 'touch') return;
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
    mobileResults.addEventListener('change', () => { if (mobileResults.matches) clear(); });
  });
  select(0);
  list.hidden = false;
})();
