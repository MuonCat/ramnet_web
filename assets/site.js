(() => {
  'use strict';
  const exhibits = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
  const sections = [...document.querySelectorAll('.paper-section')];
  const addressingExhibit = exhibits.find(exhibit => exhibit.dataset.exhibit === 'product_softmax');
  const article = document.querySelector('main.article');
  const compactLayout = window.RamnetRuntime.compactLayout;
  const sectionNames = [...document.querySelectorAll('.section-name')].map(box => ({box, text: box.firstElementChild, name: box.textContent.trim()}));
  const nameMeasure = document.createElement('canvas').getContext('2d');
  function textInkOffset(element) {
    const style = getComputedStyle(element);
    nameMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const lines = element.textContent.toUpperCase().split('\n');
    const first = nameMeasure.measureText(lines[0]);
    const last = lines.length > 1 ? nameMeasure.measureText(lines[lines.length - 1]) : first;
    return (first.fontBoundingBoxAscent - first.fontBoundingBoxDescent - first.actualBoundingBoxAscent + last.actualBoundingBoxDescent) / 2;
  }
  function fitSectionNames() {
    for (const {box, text, name} of sectionNames) {
      const style = getComputedStyle(text);
      const fontSize = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) / fontSize;
      const spacing = parseFloat(style.letterSpacing) / fontSize;
      nameMeasure.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      const widthAtOnePixel = line => nameMeasure.measureText(line.toUpperCase()).width / 100 + line.length * spacing;
      const words = name.split(/\s+/);
      const width = box.clientWidth - 1, height = box.clientHeight - 1;
      const singleSize = Math.min(width / widthAtOnePixel(name), height / lineHeight);
      const stackedSize = Math.min(width / Math.max(...words.map(widthAtOnePixel)), height / (words.length * lineHeight));
      const stacked = stackedSize > singleSize;
      text.textContent = stacked ? words.join('\n') : name;
      text.style.fontSize = `${Math.floor(Math.max(singleSize, stackedSize) * 100) / 100}px`;
      // Center the visible glyphs, including Georgia's uneven numeral heights.
      for (const element of [box.previousElementSibling, text]) {
        element.style.transform = compactLayout.matches ? `translateY(${-textInkOffset(element)}px)` : '';
      }
    }
  }
  let compactWidth = window.innerWidth;
  let compactScales = new WeakMap();
  let addressingLayout = null;
  let addressingMetrics = null;
  let desktopAddressingMetrics = null;
  let fitPending = false;
  const firstScreenPadding = 36;
  function firstScreenRatio(articleWidth, navHeight, compactSpacing, desktopBudget) {
    let largest = 0;
    for (const exhibit of exhibits) {
      const wrapper = exhibit.shadowRoot?.firstElementChild;
      if (!wrapper) continue;
      const section = exhibit.closest('.paper-section');
      const stage = exhibit.closest('.figure-stage');
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      let height = wrapper.offsetHeight;
      if (exhibit === addressingExhibit && desktopAddressingMetrics && desktopBudget) {
        const {tabWidth, aspect, chromeHeight, controlsHeight, topKHeight} = desktopAddressingMetrics;
        const contentWidth = section.querySelector('.prose').getBoundingClientRect().width;
        height = (contentWidth + tabWidth + 16) / aspect + chromeHeight -
          (compactSpacing ? controlsHeight - topKHeight : 0);
      }
      largest = Math.max(largest, (navHeight + offset + height + firstScreenPadding) / articleWidth);
    }
    const results = document.getElementById('results');
    const firstRamnet = results.querySelector('.experiment-panel:not([hidden]) .experiment-table tbody:first-of-type .ramnet-row');
    if (firstRamnet) {
      const height = firstRamnet.getBoundingClientRect().bottom - results.getBoundingClientRect().top;
      largest = Math.max(largest, (navHeight + height + firstScreenPadding) / articleWidth);
    }
    return largest;
  }
  function fitFigures() {
    if (window.innerWidth !== compactWidth) { compactWidth = window.innerWidth; compactScales = new WeakMap(); }
    document.documentElement.classList.remove('compact-layout', 'compact-interactions');
    article.classList.remove('compact-interactions');
    const navHeight = document.querySelector('.chapter-nav').getBoundingClientRect().height;
    const compactSpacing = window.innerHeight <= 850;
    const gutter = desktopAddressingMetrics ? desktopAddressingMetrics.tabWidth + 16 : 0;
    const reservedGutter = window.innerWidth <= 1024 ? 0 : gutter;
    const pageMargin = Math.max(40, Math.min(88, window.innerWidth * .07));
    exhibits.forEach(exhibit => {
      exhibit.style.zoom = '';
      exhibit.style.transform = '';
      exhibit.closest('.figure-stage').style.height = '';
    });
    function fittedWidth(tabGutter, desktopBudget, reflow = false) {
      const baseWidth = Math.min(1160, document.documentElement.clientWidth - Math.max(pageMargin, 2 * (tabGutter + 24)));
      article.style.setProperty('--article-width-limit', `${Math.max(1, baseWidth)}px`);
      article.style.setProperty('--addressing-tab-gutter', `${tabGutter}px`);
      const articleWidth = article.getBoundingClientRect().width;
      const ratio = firstScreenRatio(articleWidth, navHeight, compactSpacing || reflow, desktopBudget);
      const minimumWidth = reflow ? articleWidth * .88 : Math.min(560, articleWidth);
      return Math.min(articleWidth, Math.max(minimumWidth, ratio ? window.innerHeight / ratio : articleWidth));
    }
    const desktopWidth = fittedWidth(reservedGutter, Boolean(gutter));
    article.style.setProperty('--article-width-limit', `${Math.floor(desktopWidth)}px`);
    const desktopInset = document.querySelector('#addressing .prose').getBoundingClientRect().left - article.getBoundingClientRect().left;
    const aspect = window.innerWidth / window.innerHeight;
    const contentWidth = desktopWidth - 2 * desktopInset;
    const tabFootprint = Math.min(gutter, window.innerWidth <= 1024 ? 124 : Infinity);
    const sceneWidth = Math.min(contentWidth, addressingExhibit.clientWidth - tabFootprint);
    const useCompactLayout = aspect < 1 || sceneWidth < 560 || (aspect >= 9 / 5 && sceneWidth < 680);
    document.documentElement.classList.toggle('compact-layout', useCompactLayout);
    article.classList.toggle('compact-interactions', useCompactLayout);
    document.documentElement.classList.toggle('compact-interactions', useCompactLayout);
    compactLayout.set(useCompactLayout);
    const width = useCompactLayout ? fittedWidth(0, false, true) : desktopWidth;
    article.style.setProperty('--addressing-tab-gutter', `${useCompactLayout ? 0 : gutter}px`);
    article.style.setProperty('--article-width-limit', `${Math.floor(width)}px`);
    fitSectionNames();
    sections.forEach(section => {
      const stage = section.querySelector('.figure-stage');
      const exhibit = stage?.querySelector('.embedded-exhibit');
      if (!exhibit) return;
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const available = window.innerHeight - navHeight - offset - 14;
      const height = exhibit.offsetHeight;
      let scale = Math.min(1, Math.max(compactLayout.matches ? .68 : .55, available / height));
      // The full desktop view determines the shared width; compact controls may still need height fitting.
      if (exhibit === addressingExhibit && !compactLayout.matches) {
        const changed = exhibit.style.zoom || exhibit.style.transform;
        exhibit.style.zoom = '';
        exhibit.style.transform = '';
        stage.style.height = '';
        if (changed) exhibit.dispatchEvent(new Event('ramnet:fit'));
        return;
      }
      if (compactLayout.matches) {
        const previous = compactScales.get(exhibit);
        if (previous?.width === exhibit.offsetWidth && previous.height === height) scale = previous.scale;
        else compactScales.set(exhibit, {width: exhibit.offsetWidth, height, scale});
      }
      if (compactLayout.matches && CSS.supports('zoom', '0.7')) {
        const zoom = scale < .999 ? String(scale) : '';
        const changed = exhibit.style.zoom !== zoom;
        exhibit.style.zoom = zoom;
        exhibit.style.transform = '';
        stage.style.height = '';
        if (changed) exhibit.dispatchEvent(new Event('ramnet:fit'));
      } else {
        exhibit.style.zoom = '';
        exhibit.style.transform = scale < .999 ? `scale(${scale})` : '';
        stage.style.height = scale < .999 ? `${Math.ceil(height * scale)}px` : '';
      }
    });
    syncAddressingLayout();
    fitPending = false;
  }
  function scheduleFit() {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(fitFigures);
  }
  const fitObserver = new ResizeObserver(scheduleFit);
  sections.forEach(section => fitObserver.observe(section.querySelector('.section-heading')));
  let viewportWidth = window.innerWidth, viewportHeight = window.innerHeight, resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === viewportWidth && window.innerHeight === viewportHeight) return;
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    if (!compactLayout.matches || viewportWidth !== compactWidth) scheduleFit();
    clearTimeout(resizeTimer);
    // Refit after a browser fullscreen transition settles.
    resizeTimer = setTimeout(scheduleFit, 500);
  });
  document.fonts.ready.then(() => {
    addressingExhibit.dispatchEvent(new Event('ramnet:fit'));
    scheduleFit();
  });
  addressingExhibit.addEventListener('ramnet:layout-metrics', event => {
    const next = event.detail;
    if (addressingMetrics && next.aspect === addressingMetrics.aspect &&
        Math.abs(next.tabWidth - addressingMetrics.tabWidth) < .5 &&
        Math.abs(next.chromeHeight - addressingMetrics.chromeHeight) < .5 &&
        Math.abs(next.controlsHeight - addressingMetrics.controlsHeight) < .5 &&
        Math.abs(next.topKHeight - addressingMetrics.topKHeight) < .5) return;
    addressingMetrics = next;
    if (next.tabWidth) desktopAddressingMetrics = next;
    scheduleFit();
  });
  function syncAddressingLayout() {
    const text = document.querySelector('#addressing .prose').getBoundingClientRect();
    const exhibit = addressingExhibit.getBoundingClientRect();
    const scale = exhibit.width / addressingExhibit.offsetWidth;
    const width = Math.min(text.width / scale, addressingExhibit.clientWidth);
    const center = (text.left + text.width / 2 - exhibit.left) / scale;
    const left = Math.max(0, Math.min(addressingExhibit.clientWidth - width, center - width / 2));
    if (addressingLayout && Math.abs(addressingLayout.left - left) < .5 && Math.abs(addressingLayout.width - width) < .5) return;
    addressingLayout = {left, width};
    addressingExhibit.dispatchEvent(new CustomEvent('ramnet:content-layout', {detail: {left, width}}));
  }
  new ResizeObserver(syncAddressingLayout).observe(addressingExhibit);
  // Section 3 changes its own height while aligning its tabs with the prose.
  const exhibitObserver = new ResizeObserver(entries => {
    if (entries.some(entry => entry.target !== addressingExhibit || compactLayout.matches)) scheduleFit();
  });
  exhibits.forEach(exhibit => {
    exhibitObserver.observe(exhibit);
    exhibit.addEventListener('ramnet:mounted', () => {
      if (exhibit === addressingExhibit) { addressingLayout = null; syncAddressingLayout(); }
      if (exhibit === addressingExhibit) requestAnimationFrame(() => requestAnimationFrame(scheduleFit));
      else scheduleFit();
    });
  });
  window.addEventListener('ramnet:results-layout', scheduleFit);
  const links = [...document.querySelectorAll('.chapter-links a')];
  const progress = document.querySelector('.reading-progress');
  let scrollPending = false;
  function updateReading() {
    const current = sections.findLast(section => section.getBoundingClientRect().top <= 170) || sections[0];
    links.forEach(link => {
      if (link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${distance > 0 ? Math.min(1, window.scrollY / distance) : 0})`;
    scrollPending = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollPending) { scrollPending = true; requestAnimationFrame(updateReading); }
  }, {passive: true});
  window.addEventListener('resize', updateReading);
  updateReading();
  scheduleFit();
})();
