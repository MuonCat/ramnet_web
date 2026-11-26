(() => {
  'use strict';
  const initialHash = window.ramnetInitialHash;
  const pending = new AbortController();
  for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown', 'click', 'hashchange', 'popstate']) {
    window.addEventListener(type, () => pending.abort(), {passive: true, capture: true, signal: pending.signal});
  }
  window.addEventListener('pageshow', async event => {
    if (event.persisted || pending.signal.aborted) return;
    if (initialHash) {
      await Promise.allSettled([window.RamnetExhibitsReady, document.fonts.ready]);
      await new Promise(requestAnimationFrame);
    }
    if (pending.signal.aborted) return;
    pending.abort();
    if (initialHash) window.RamnetSectionScroll.navigateHash(initialHash);
    else window.scrollTo({top: 0, behavior: 'instant'});
  }, {once: true, signal: pending.signal});
})();
