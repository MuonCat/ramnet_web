(() => {
  'use strict';
  const exhibits = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
  const sections = [...document.querySelectorAll('.paper-section')];
  const figures = exhibits.map(host => ({host, stage: host.closest('.figure-stage'), section: host.closest('.paper-section')}));
  const nav = document.querySelector('.chapter-nav');
  const results = document.getElementById('results');
  const addressingText = document.querySelector('#addressing .prose');
  const root = document.documentElement;
  const addressingExhibit = exhibits.find(exhibit => exhibit.dataset.exhibit === 'product_softmax');
  const article = document.querySelector('main.article');
  const compactLayout = window.RamnetRuntime.compactLayout;
  const touchViewport = matchMedia('(pointer: coarse)');
  const sectionNames = [...document.querySelectorAll('.section-name')].map(box => ({box, text: box.firstElementChild, name: box.textContent.trim()}));
  const nameMeasure = document.createElement('canvas').getContext('2d');
  let fittedNameBox = '';
  function textInkOffset(element) {
    const style = getComputedStyle(element);
    nameMeasure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const lines = element.textContent.toUpperCase().split('\n');
    const first = nameMeasure.measureText(lines[0]);
    const last = lines.length > 1 ? nameMeasure.measureText(lines[lines.length - 1]) : first;
    return (first.fontBoundingBoxAscent - first.fontBoundingBoxDescent - first.actualBoundingBoxAscent + last.actualBoundingBoxDescent) / 2;
  }
  function fitSectionNames() {
    const sample = sectionNames[0].box;
    const width = sample.clientWidth - 1, height = sample.clientHeight - 1;
    const boxKey = `${width}/${height}/${compactLayout.matches}`;
    if (fittedNameBox === boxKey) return;
    fittedNameBox = boxKey;
    for (const {box, text, name} of sectionNames) {
      const style = getComputedStyle(text);
      const fontSize = parseFloat(style.fontSize);
      const lineHeight = parseFloat(style.lineHeight) / fontSize;
      const spacing = parseFloat(style.letterSpacing) / fontSize;
      nameMeasure.font = `${style.fontWeight} 100px ${style.fontFamily}`;
      const widthAtOnePixel = line => nameMeasure.measureText(line.toUpperCase()).width / 100 + line.length * spacing;
      const words = name.split(/\s+/);
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
  let viewportWidth = root.clientWidth, viewportHeight = root.clientHeight, resizeTimer = 0;
  let addressingLayout = null, addressingMetrics = null, desktopAddressingMetrics = null;
  const topOffset = ({stage, section}) => stage.getBoundingClientRect().top - section.getBoundingClientRect().top;

  function desktopWidth(height, gutter) {
    // Let CSS supply the page margins and maximum width. Reserve space for outside tabs on wide screens.
    root.classList.remove('compact-layout');
    const reserved = viewportWidth > 1024 ? gutter : 0;
    article.style.setProperty('--addressing-tab-gutter', `${reserved}px`);
    if (reserved) article.style.setProperty('--article-width-limit', `${Math.max(1, root.clientWidth - 2 * (reserved + 24))}px`);
    else article.style.removeProperty('--article-width-limit');

    const base = article.getBoundingClientRect().width;
    const content = addressingText.getBoundingClientRect().width;
    let tallest = 0;
    for (const figure of figures) {
      const wrapper = figure.host.shadowRoot?.querySelector('.exhibit-content');
      if (!wrapper) continue;
      let figureHeight = wrapper.offsetHeight;
      if (figure.host === addressingExhibit && desktopAddressingMetrics) {
        const {aspect, tabWidth, chromeHeight, controlsHeight, topKHeight} = desktopAddressingMetrics;
        // Short displays budget through Top-K; tall displays include the distribution controls.
        figureHeight = (content + tabWidth + 16) / aspect + chromeHeight - (height <= 850 ? controlsHeight - topKHeight : 0);
      }
      tallest = Math.max(tallest, topOffset(figure) + figureHeight);
    }
    const firstRamnet = results.querySelector('.experiment-panel:not([hidden]) .experiment-table tbody:first-of-type .ramnet-row');
    if (firstRamnet) {
      tallest = Math.max(tallest, firstRamnet.getBoundingClientRect().bottom - results.getBoundingClientRect().top);
    }
    const budget = tallest + nav.offsetHeight + 36;
    return Math.floor(Math.min(base, Math.max(560, height * base / budget)));
  }

  function fitFigures() {
    // Touch browsers resize their toolbars during a swipe. Keep the height used for sizing stable.
    const height = viewportHeight, aspect = viewportWidth / height;
    const gutter = desktopAddressingMetrics ? desktopAddressingMetrics.tabWidth + 16 : 0;
    const previousZoom = figures.map(({host}) => host.style.zoom);
    for (const {host, stage} of figures) {
      host.style.zoom = host.style.width = host.style.transform = stage.style.height = '';
    }

    let compact = aspect < 1;
    if (!compact) {
      const width = desktopWidth(height, gutter);
      article.style.setProperty('--article-width-limit', `${width}px`);
      article.style.setProperty('--addressing-tab-gutter', `${gutter}px`);
      const scene = Math.min(addressingText.getBoundingClientRect().width, addressingExhibit.clientWidth - gutter);
      compact = scene < (aspect >= 9 / 5 ? 680 : 560);
    }
    root.classList.toggle('compact-layout', compact);
    root.classList.toggle('compact-landscape', compact && aspect > 1 && viewportWidth >= 560 && height <= 600);
    compactLayout.set(compact);
    fitSectionNames();

    // Read all natural sizes before changing any scale. Each section gets the space below its heading.
    const available = height - nav.offsetHeight - 14;
    const sizes = figures.map(figure => {
      const wrapper = figure.host.shadowRoot?.querySelector('.exhibit-content');
      if (!wrapper || (figure.host === addressingExhibit && !compact)) return null;
      const naturalHeight = wrapper.offsetHeight;
      if (!naturalHeight) return null;
      const scale = Math.max(0, Math.min(1, (available - topOffset(figure)) / naturalHeight));
      return {scale, width: figure.stage.clientWidth, height: naturalHeight};
    });
    figures.forEach(({host, stage}, i) => {
      const size = sizes[i];
      if (size && size.scale > 0 && size.scale < .999) {
        if (compact && CSS.supports('zoom', '0.7')) {
          // An explicit natural width keeps zoom from reflowing a percentage-width figure.
          host.style.width = `${size.width}px`;
          host.style.zoom = String(size.scale);
        } else {
          host.style.transform = `scale(${size.scale})`;
          stage.style.height = `${Math.ceil(size.height * size.scale)}px`;
        }
      }
      if (previousZoom[i] !== host.style.zoom) host.dispatchEvent(new Event('ramnet:fit'));
    });
    syncAddressingLayout();
  }
  const scheduleFit = window.RamnetRuntime.onNextFrame(fitFigures);
  window.addEventListener('resize', () => {
    // Mobile browser toolbars change the visible height during ordinary scrolling.
    const width = root.clientWidth, height = root.clientHeight;
    if (width === viewportWidth && (touchViewport.matches || height === viewportHeight)) return;
    viewportWidth = width;
    viewportHeight = height;
    scheduleFit();
    clearTimeout(resizeTimer);
    // Refit after a browser fullscreen transition settles.
    resizeTimer = setTimeout(scheduleFit, 500);
  });
  document.fonts.ready.then(() => {
    fittedNameBox = '';
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
    const text = addressingText.getBoundingClientRect();
    const exhibit = addressingExhibit.getBoundingClientRect();
    const scale = exhibit.width / addressingExhibit.offsetWidth;
    const width = Math.min(text.width / scale, addressingExhibit.clientWidth);
    const center = (text.left + text.width / 2 - exhibit.left) / scale;
    const left = Math.max(0, Math.min(addressingExhibit.clientWidth - width, center - width / 2));
    if (addressingLayout && Math.abs(addressingLayout.left - left) < .5 && Math.abs(addressingLayout.width - width) < .5) return;
    addressingLayout = {left, width};
    addressingExhibit.dispatchEvent(new CustomEvent('ramnet:content-layout', {detail: {left, width}}));
  }
  const scheduleAddressingLayout = window.RamnetRuntime.onNextFrame(syncAddressingLayout);
  const fitObserver = new ResizeObserver(entries => {
    // In desktop mode the tab layout sets its own height and reports a separate first-screen budget.
    if (entries.some(entry => entry.target !== addressingExhibit || compactLayout.matches)) scheduleFit();
    else scheduleAddressingLayout();
  });
  sections.forEach(section => fitObserver.observe(section.querySelector('.section-heading')));
  exhibits.forEach(exhibit => {
    fitObserver.observe(exhibit);
    exhibit.addEventListener('ramnet:mounted', () => {
      if (exhibit === addressingExhibit) { addressingLayout = null; syncAddressingLayout(); }
      scheduleFit();
    });
  });
  window.addEventListener('ramnet:results-layout', scheduleFit);
  scheduleFit();
})();
