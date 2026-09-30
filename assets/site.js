(() => {
  'use strict';
  const exhibits = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
  const sections = [...document.querySelectorAll('.paper-section')];
  const addressingExhibit = exhibits.find(exhibit => exhibit.dataset.exhibit === 'product_softmax');
  const compactLayout = window.RamnetRuntime.compactLayout;
  let compactWidth = window.innerWidth;
  let compactScales = new WeakMap();
  let addressingLayout = null;
  let addressingScale = null;
  let fitPending = false;
  function fitFigures() {
    if (window.innerWidth !== compactWidth) { compactWidth = window.innerWidth; compactScales = new WeakMap(); }
    const navHeight = document.querySelector('.chapter-nav').getBoundingClientRect().height;
    sections.forEach(section => {
      const stage = section.querySelector('.figure-stage');
      const exhibit = stage?.querySelector('.embedded-exhibit');
      if (!exhibit) return;
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const available = window.innerHeight - navHeight - offset - 14;
      const height = exhibit.offsetHeight;
      let scale = Math.min(1, Math.max(compactLayout.matches ? .68 : .55, available / height));
      // Keep section 3's scale independent of its own layout changes.
      if (exhibit === addressingExhibit && !compactLayout.matches) {
        if (addressingScale !== null) scale = addressingScale;
        else if (exhibit.style.height) addressingScale = scale;
      }
      if (compactLayout.matches) {
        const previous = compactScales.get(exhibit);
        if (previous?.width === exhibit.offsetWidth && previous.height === height) scale = previous.scale;
        else compactScales.set(exhibit, {width: exhibit.offsetWidth, height, scale});
      }
      if ((compactLayout.matches || exhibit === addressingExhibit) && CSS.supports('zoom', '0.7')) {
        const zoom = scale < .999 ? String(scale) : '';
        const changed = exhibit.style.zoom !== zoom;
        if (exhibit === addressingExhibit) {
          stage.style.width = zoom && !compactLayout.matches ? `${scale * 100}%` : '';
          stage.style.marginInline = zoom && !compactLayout.matches ? 'auto' : '';
        }
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
    resizeTimer = setTimeout(() => { addressingScale = null; scheduleFit(); }, 500);
  });
  compactLayout.addEventListener('change', () => { addressingScale = null; scheduleFit(); });
  document.fonts.ready.then(() => { addressingScale = null; scheduleFit(); });
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
      if (exhibit === addressingExhibit) { addressingLayout = null; addressingScale = null; syncAddressingLayout(); }
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
