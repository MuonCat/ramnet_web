(() => {
  'use strict';
  const exhibits = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
  const sections = [...document.querySelectorAll('.paper-section')];
  const addressingExhibit = exhibits.find(exhibit => exhibit.dataset.exhibit === 'product_softmax');
  const article = document.querySelector('main.article');
  const compactLayout = window.RamnetRuntime.compactLayout;
  let compactWidth = window.innerWidth;
  let compactScales = new WeakMap();
  let addressingLayout = null;
  let addressingMetrics = null;
  let fitPending = false;
  function fitFigures() {
    fitPending = false;
    if (window.innerWidth !== compactWidth) { compactWidth = window.innerWidth; compactScales = new WeakMap(); }
    const navHeight = document.querySelector('.chapter-nav').getBoundingClientRect().height;
    if (addressingMetrics && !compactLayout.matches) {
      const section = addressingExhibit.closest('.paper-section');
      const stage = section.querySelector('.figure-stage');
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const textInset = section.querySelector('.prose').getBoundingClientRect().left - article.getBoundingClientRect().left;
      const {tabWidth, aspect, chromeHeight} = addressingMetrics;
      const gutter = tabWidth + 16;
      const horizontalLimit = Math.min(1160, document.documentElement.clientWidth - 2 * (gutter + 24));
      const heightWidth = (window.innerHeight - navHeight - offset - 14 - chromeHeight) * aspect - gutter;
      const widthLimit = Math.min(horizontalLimit, Math.max(560, heightWidth) + textInset);
      article.style.setProperty('--addressing-width-limit', `${Math.floor(widthLimit)}px`);
      article.style.setProperty('--addressing-tab-gutter', `${gutter}px`);
    } else {
      article.style.removeProperty('--addressing-width-limit');
      article.style.removeProperty('--addressing-tab-gutter');
    }
    sections.forEach(section => {
      const stage = section.querySelector('.figure-stage');
      const exhibit = stage?.querySelector('.embedded-exhibit');
      if (!exhibit) return;
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const available = window.innerHeight - navHeight - offset - 14;
      const height = exhibit.offsetHeight;
      let scale = Math.min(1, Math.max(compactLayout.matches ? .68 : .55, available / height));
      // Desktop section 3 determines the shared width; never scale it a second time.
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
  compactLayout.addEventListener('change', scheduleFit);
  document.fonts.ready.then(() => {
    addressingExhibit.dispatchEvent(new Event('ramnet:fit'));
    scheduleFit();
  });
  addressingExhibit.addEventListener('ramnet:layout-metrics', event => {
    const next = event.detail;
    if (addressingMetrics && next.aspect === addressingMetrics.aspect &&
        Math.abs(next.tabWidth - addressingMetrics.tabWidth) < .5 &&
        Math.abs(next.chromeHeight - addressingMetrics.chromeHeight) < .5) return;
    addressingMetrics = next;
    scheduleFit();
  });
  function syncAddressingLayout() {
    const text = document.querySelector('#addressing .prose').getBoundingClientRect();
    const exhibit = addressingExhibit.getBoundingClientRect();
    const scale = compactLayout.matches ? exhibit.width / addressingExhibit.offsetWidth : 1;
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
