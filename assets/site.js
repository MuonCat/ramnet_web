(() => {
  'use strict';
  const frames = [...document.querySelectorAll('iframe[data-exhibit]')];
  const sections = [...document.querySelectorAll('.paper-section')];
  const addressingFrame = frames.find(frame => frame.dataset.exhibit === 'product_softmax');
  const compactLayout = matchMedia('(max-width: 760px), (max-width: 1024px) and (max-aspect-ratio: 4/5), (max-width: 1024px) and (min-aspect-ratio: 3/2)');
  let fitPending = false;
  function fitFigures() {
    const navHeight = document.querySelector('.chapter-nav').getBoundingClientRect().height;
    sections.forEach(section => {
      const stage = section.querySelector('.figure-stage');
      const frame = stage?.querySelector('iframe');
      if (!frame) return;
      const offset = stage.getBoundingClientRect().top - section.getBoundingClientRect().top;
      const available = window.innerHeight - navHeight - offset - 14;
      const height = frame.offsetHeight;
      const scale = Math.min(1, Math.max(compactLayout.matches ? .68 : .55, available / height));
      frame.style.transform = scale < .999 ? `scale(${scale})` : '';
      stage.style.height = scale < .999 ? `${Math.ceil(height * scale)}px` : '';
    });
    fitPending = false;
  }
  function scheduleFit() {
    if (fitPending) return;
    fitPending = true;
    requestAnimationFrame(fitFigures);
  }
  const fitObserver = new ResizeObserver(scheduleFit);
  sections.forEach(section => fitObserver.observe(section.querySelector('.section-heading')));
  window.addEventListener('resize', scheduleFit);
  document.fonts.ready.then(scheduleFit);
  function syncAddressingLayout() {
    const text = document.querySelector('#addressing .prose').getBoundingClientRect();
    const frame = addressingFrame.getBoundingClientRect();
    addressingFrame.contentWindow?.postMessage({type: 'ramnet:content-layout', left: text.left - frame.left, width: text.width}, '*');
  }
  new ResizeObserver(syncAddressingLayout).observe(addressingFrame);
  const visible = new Set();
  const paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function syncFrame(frame) {
    frame.contentWindow?.postMessage({type: 'ramnet:visibility', active: visible.has(frame), paused}, '*');
  }
  const frameObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
      syncFrame(entry.target);
    });
  }, {rootMargin: '100px 0px'});
  frames.forEach(frame => { frameObserver.observe(frame); frame.addEventListener('load', () => { syncFrame(frame); scheduleFit(); }); });
  window.addEventListener('message', event => {
    const frame = frames.find(item => item.contentWindow === event.source);
    if (!frame) return;
    if (event.data?.type === 'ramnet:ready') {
      syncFrame(frame);
      if (frame === addressingFrame) syncAddressingLayout();
    }
    if (event.data?.type === 'ramnet:resize' && Number.isFinite(event.data.height)) {
      frame.style.height = `${Math.max(1, Math.min(2400, event.data.height))}px`;
      scheduleFit();
    }
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
