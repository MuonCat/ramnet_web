(() => {
  'use strict';
  const initialHash = window.ramnetInitialHash;
  if (!initialHash) {
    window.addEventListener('pageshow', () => window.scrollTo({top: 0, behavior: 'instant'}), {once: true});
    return;
  }

  let interrupted = false;
  for (const type of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(type, () => { interrupted = true; }, {once: true, passive: true});
  }
  window.addEventListener('pageshow', async () => {
    if (interrupted) return;
    window.scrollTo({top: 0, behavior: 'instant'});
    await document.fonts.ready;
    const hosts = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
    const started = performance.now();
    const wait = () => {
      if (interrupted) return;
      if (!hosts.every(host => host.style.height || host.textContent.includes('Unable to load')) && performance.now() - started < 4000) {
        setTimeout(wait, 40);
        return;
      }
      requestAnimationFrame(() => {
        if (interrupted) return;
        history.replaceState(history.state, '', location.pathname + location.search + initialHash);
        window.RamnetSectionScroll.navigateHash(initialHash);
      });
    };
    wait();
  }, {once: true});
})();
