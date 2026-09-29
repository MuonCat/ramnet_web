(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.paper-section')];
  const frames = [...document.querySelectorAll('iframe[data-exhibit]')];
  const chapterNav = document.querySelector('.chapter-nav');
  const hero = document.querySelector('.hero');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let targets = [], anchor = null, animation = 0, velocity = 0, lastFrame = 0;
  let restTimer = 0, motionSpeed = 0, lastMotionAt = 0, lastWheelAt = 0;
  let lastScrollY = scrollY, lastScrollAt = performance.now(), expectedY = null;
  let touching = false, draggingScrollbar = false, captureFrames = false;

  function targetAt(y) {
    return targets.reduce((best, target) => {
      if (y < target.start || y > target.end) return best;
      return !best || Math.abs(target.y - y) < Math.abs(best.y - y) ? target : best;
    }, null);
  }
  function syncFrames() {
    const capture = !reducedMotion.matches && (anchor !== null || targets.some(target => scrollY >= target.start - 80 && scrollY <= target.end + 80));
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
    if (anchor) {
      anchor = targets.find(target => target.section === anchor.section);
      if (targetAt(scrollY)?.section !== anchor?.section) stopPull();
    }
    syncFrames();
    scheduleRest();
  }
  function stopPull() {
    cancelAnimationFrame(animation);
    animation = 0;
    anchor = null;
    velocity = 0;
    lastFrame = 0;
  }
  function attraction(now) {
    // Scroll speed fades to zero after input stops, restoring full attraction at rest.
    const speed = motionSpeed * clamp(1 - (now - lastMotionAt) / 300, 0, 1);
    return clamp(1 - speed / 1.4, 0, 1);
  }
  function pull() {
    if (animation || !anchor) return;
    function step(now) {
      animation = 0;
      if (!anchor || touching || draggingScrollbar) { stopPull(); return; }
      const strength = attraction(performance.now());
      if (strength <= 0) { stopPull(); return; }
      const dt = Math.min((now - (lastFrame || now - 16)) / 1000, .032);
      lastFrame = now;
      const distance = anchor.y - scrollY;
      velocity = clamp(velocity + (64 * strength * distance - 16 * velocity) * dt, -500, 500);
      if (Math.abs(distance) < .8 && Math.abs(velocity) < 10) {
        expectedY = anchor.y;
        window.scrollTo({top: anchor.y, behavior: 'instant'});
        stopPull();
        return;
      }
      expectedY = clamp(scrollY + velocity * dt, 0, document.documentElement.scrollHeight - innerHeight);
      window.scrollTo({top: expectedY, behavior: 'instant'});
      animation = requestAnimationFrame(step);
    }
    animation = requestAnimationFrame(step);
  }
  function evaluate() {
    if (reducedMotion.matches || touching || draggingScrollbar || attraction(performance.now()) <= 0) { stopPull(); return; }
    const target = targetAt(scrollY);
    if (!target || Math.abs(target.y - scrollY) < .8) { stopPull(); return; }
    if (anchor?.section !== target.section) { stopPull(); anchor = target; }
    else anchor = target;
    pull();
    syncFrames();
  }
  function scheduleRest() {
    clearTimeout(restTimer);
    const delay = clamp(140 + motionSpeed * 110, 160, 600);
    restTimer = setTimeout(() => {
      if (touching || draggingScrollbar) return;
      motionSpeed = 0;
      evaluate();
    }, delay);
  }
  function recordWheel(delta) {
    const now = performance.now();
    const interval = now - lastWheelAt;
    motionSpeed = Math.abs(delta) / Math.max(interval > 300 ? 180 : interval, 16);
    lastWheelAt = lastMotionAt = now;
    if (motionSpeed >= 1.4) stopPull();
    scheduleRest();
  }
  function interactive(target) {
    return target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  }
  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || interactive(event.target)) return;
    recordWheel(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1));
  }, {passive: true});
  window.addEventListener('touchstart', () => {
    touching = true;
    clearTimeout(restTimer);
    stopPull();
  }, {passive: true});
  function endTouch() {
    touching = false;
    scheduleRest();
  }
  window.addEventListener('touchend', endTouch, {passive: true});
  window.addEventListener('touchcancel', endTouch, {passive: true});
  window.addEventListener('scroll', () => {
    const now = performance.now();
    const delta = scrollY - lastScrollY;
    const interval = now - lastScrollAt;
    const ownScroll = expectedY !== null && Math.abs(scrollY - expectedY) < 2;
    lastScrollY = scrollY;
    lastScrollAt = now;
    expectedY = null;
    syncFrames();
    if (ownScroll || !delta) return;
    const observed = Math.abs(delta) / Math.max(interval, 16);
    motionSpeed = now - lastWheelAt < 70 ? Math.max(motionSpeed, observed) : observed;
    lastMotionAt = now;
    evaluate();
    scheduleRest();
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (!interactive(event.target) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopPull();
  });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.clientX >= document.documentElement.clientWidth) {
      draggingScrollbar = true;
      clearTimeout(restTimer);
      stopPull();
    }
  });
  window.addEventListener('pointerup', () => {
    if (draggingScrollbar) { draggingScrollbar = false; scheduleRest(); }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = targets.find(item => '#' + item.section.id === link.hash);
    if (!target) return;
    event.preventDefault();
    stopPull();
    history.pushState(null, '', link.hash);
    window.scrollTo({top: target.y, behavior: reducedMotion.matches ? 'instant' : 'smooth'});
  });
  window.addEventListener('popstate', () => { stopPull(); scheduleRest(); });
  reducedMotion.addEventListener('change', () => { stopPull(); syncFrames(); });
  window.addEventListener('message', event => {
    const frame = frames.find(item => item.contentWindow === event.source);
    if (!frame) return;
    const message = event.data;
    if (message?.type === 'ramnet:ready') frame.contentWindow.postMessage({type: 'ramnet:scroll-mode', capture: captureFrames}, '*');
    if (message?.type === 'ramnet:scroll-touch') {
      if (message.active) { touching = true; clearTimeout(restTimer); stopPull(); }
      else endTouch();
    }
    if (message?.type === 'ramnet:scroll-input' && Number.isFinite(message.delta)) {
      if (!message.touch) recordWheel(message.delta);
      window.scrollBy({top: message.delta, behavior: 'instant'});
    }
  });
  const observer = new ResizeObserver(refreshTargets);
  sections.forEach(section => observer.observe(section));
  observer.observe(hero);
  window.addEventListener('resize', refreshTargets);
  refreshTargets();
})();
