(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.paper-section')];
  const frames = [...document.querySelectorAll('iframe[data-exhibit]')];
  const chapterNav = document.querySelector('.chapter-nav');
  const hero = document.querySelector('.hero');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let targets = [], snapTimer = 0, snapFrame = 0, snapping = false, lastScrollY = scrollY, expectedY = null;
  let cooldownSection = null, cooldownUntil = 0;
  let touching = false, draggingScrollbar = false, captureFrames = false;

  function targetAt(y) {
    return targets.reduce((best, target) => {
      if (y < target.start || y > target.end) return best;
      return !best || Math.abs(target.y - y) < Math.abs(best.y - y) ? target : best;
    }, null);
  }
  function syncFrames() {
    const capture = !reducedMotion.matches && targets.some(target => scrollY >= target.start - 80 && scrollY <= target.end + 80);
    if (Boolean(capture) === captureFrames) return;
    captureFrames = Boolean(capture);
    frames.forEach(frame => frame.contentWindow?.postMessage({type: 'ramnet:scroll-mode', capture: captureFrames}, '*'));
  }
  function refreshTargets() {
    const inset = chapterNav.getBoundingClientRect().height;
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const top = element => scrollY + element.getBoundingClientRect().top - inset;
    targets = sections.map((section, index) => {
      const previous = sections[index - 1] || hero;
      const paragraphs = [...previous.querySelectorAll('p')];
      const tail = paragraphs.at(-2) || paragraphs.at(-1);
      const heading = section.querySelector('.section-heading');
      const y = clamp(top(section), 0, max);
      // The visible top edge enters at the previous tail and exits through this heading.
      return {
        section,
        y,
        start: clamp(tail ? top(tail) : y - 180, Math.max(0, y - 280), y),
        end: clamp(top(heading) + heading.getBoundingClientRect().height, y, max)
      };
    });
    if (targetAt(scrollY)?.section !== cooldownSection) clearCooldown();
    syncFrames();
    scheduleSnap();
  }
  function clearCooldown() {
    cooldownSection = null;
    cooldownUntil = 0;
  }
  function updateCooldown(delta, now) {
    const target = targetAt(scrollY);
    if (!target) { clearCooldown(); return; }
    if (cooldownSection !== target.section) clearCooldown();
    const distance = target.y - scrollY;
    if (delta * distance > 0) clearCooldown();
    else if (delta * distance < 0 || distance === 0) {
      cooldownSection = target.section;
      cooldownUntil = now + 500;
    }
  }
  function stopSnap() {
    clearTimeout(snapTimer);
    cancelAnimationFrame(snapFrame);
    snapFrame = 0;
    snapping = false;
    expectedY = null;
    lastScrollY = scrollY;
  }
  function moveTo(y) {
    expectedY = y;
    window.scrollTo({top: y, behavior: 'instant'});
    expectedY = lastScrollY = scrollY;
    syncFrames();
  }
  function snap() {
    if (touching || draggingScrollbar) return;
    const target = targetAt(scrollY);
    if (!target) { clearCooldown(); return; }
    if (cooldownSection !== target.section) clearCooldown();
    if (performance.now() < cooldownUntil) { scheduleSnap(); return; }
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const y = clamp(scrollY + target.section.getBoundingClientRect().top - chapterNav.getBoundingClientRect().height, 0, max);
    if (scrollY === y) return;
    if (reducedMotion.matches) { moveTo(y); return; }
    const start = scrollY, began = performance.now(), duration = 360;
    snapping = true;
    // Closed-form path: x(t) = start + (target - start) * (3u² - 2u³).
    function step(now) {
      const u = clamp((now - began) / duration, 0, 1);
      moveTo(start + (y - start) * u * u * (3 - 2 * u));
      if (u < 1) snapFrame = requestAnimationFrame(step);
      else { snapFrame = 0; snapping = false; }
    }
    snapFrame = requestAnimationFrame(step);
  }
  function scheduleSnap() {
    clearTimeout(snapTimer);
    if (touching || draggingScrollbar || snapping) return;
    const remaining = cooldownUntil - performance.now();
    snapTimer = setTimeout(snap, Math.max(120, remaining + 1));
  }
  function interactive(target) {
    return target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  }
  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    stopSnap();
    if (interactive(event.target)) return;
    updateCooldown(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1), performance.now());
    scheduleSnap();
  }, {passive: true});
  window.addEventListener('touchstart', () => {
    touching = true;
    stopSnap();
  }, {passive: true});
  function endTouch() {
    touching = false;
    scheduleSnap();
  }
  window.addEventListener('touchend', endTouch, {passive: true});
  window.addEventListener('touchcancel', endTouch, {passive: true});
  window.addEventListener('scroll', () => {
    const delta = scrollY - lastScrollY;
    const ownScroll = snapping || expectedY !== null && scrollY === expectedY;
    lastScrollY = scrollY;
    expectedY = null;
    syncFrames();
    if (ownScroll || !delta) return;
    updateCooldown(delta, performance.now());
    scheduleSnap();
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (!interactive(event.target) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopSnap();
  });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.clientX >= document.documentElement.clientWidth) {
      draggingScrollbar = true;
      stopSnap();
    }
  });
  window.addEventListener('pointerup', () => {
    if (draggingScrollbar) { draggingScrollbar = false; scheduleSnap(); }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = targets.find(item => '#' + item.section.id === link.hash);
    if (!target) return;
    event.preventDefault();
    stopSnap();
    clearCooldown();
    history.pushState(null, '', link.hash);
    window.scrollTo({top: target.y, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  });
  window.addEventListener('popstate', () => { stopSnap(); clearCooldown(); scheduleSnap(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { stopSnap(); scheduleSnap(); } syncFrames(); });
  window.addEventListener('message', event => {
    const frame = frames.find(item => item.contentWindow === event.source);
    if (!frame) return;
    const message = event.data;
    if (message?.type === 'ramnet:ready') frame.contentWindow.postMessage({type: 'ramnet:scroll-mode', capture: captureFrames}, '*');
    if (message?.type === 'ramnet:scroll-touch') {
      if (message.active) { touching = true; stopSnap(); }
      else endTouch();
    }
    if (message?.type === 'ramnet:scroll-input' && Number.isFinite(message.delta)) {
      stopSnap();
      if (!message.touch) updateCooldown(message.delta, performance.now());
      window.scrollBy({top: message.delta, behavior: 'instant'});
    }
  });
  const observer = new ResizeObserver(refreshTargets);
  sections.forEach(section => observer.observe(section));
  observer.observe(hero);
  window.addEventListener('resize', refreshTargets);
  refreshTargets();
})();
