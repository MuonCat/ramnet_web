(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.paper-section')];
  const frames = [...document.querySelectorAll('iframe[data-exhibit]')];
  const chapterNav = document.querySelector('.chapter-nav');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let targets = [], anchor = null, bypass = null;
  let animation = 0, velocity = 0, lastFrame = 0, settleTimer = 0, idleTimer = 0;
  let capturedAt = 0, lastInput = 0, lastMagnitude = 0, effort = 0, direction = 0;
  let touching = false, touchY = null, touchX = null, touchCapture = false, draggingScrollbar = false, captureFrames = false;
  let gestureEligible = false, fastWheel = false, touchSpeed = 0, touchDistance = 0, lastTouchAt = 0;
  let scrollSpeed = 0, lastMotionAt = 0;

  const inZone = (target, y) => target && y >= target.start && y <= target.end;

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
      const y = clamp(top(section), 0, max);
      const previous = sections[index - 1];
      const paragraphs = previous && [...previous.querySelectorAll('.prose p')];
      const entry = paragraphs?.at(-2) || paragraphs?.at(-1);
      const heading = section.querySelector('.section-heading');
      const start = clamp(entry ? top(entry) : y - 180, Math.max(0, y - 280), y);
      const end = clamp(top(heading) + heading.getBoundingClientRect().height, y, max);
      return {section, y, start, end};
    });
    if (anchor) {
      anchor = targets.find(target => target.section === anchor.section);
      pull();
    }
    syncFrames();
  }
  function nearest(y) {
    return targets.filter(target => target.section !== bypass).reduce((best, target) =>
      !best || Math.abs(target.y - y) < Math.abs(best.y - y) ? target : best, null);
  }
  function cancelPull() {
    cancelAnimationFrame(animation);
    animation = 0;
    velocity = 0;
    lastFrame = 0;
  }
  function release() {
    if (anchor) bypass = anchor.section;
    anchor = null;
    effort = 0;
    cancelPull();
    syncFrames();
  }
  function pull() {
    if (!anchor || animation || reducedMotion.matches) return;
    let position = scrollY;
    // A critically damped spring approaches alignment without a sudden jump.
    function step(now) {
      const dt = Math.min((now - (lastFrame || now - 16)) / 1000, .032);
      lastFrame = now;
      const distance = anchor.y - position;
      const recent = clamp(1 - (performance.now() - lastMotionAt) / 250, 0, 1);
      const strength = 1 - .7 * clamp(scrollSpeed / 1.4, 0, 1) * recent;
      velocity = clamp(velocity + (64 * strength * distance - 16 * velocity) * dt, -500, 500);
      if (Math.abs(distance) < .8 && Math.abs(velocity) < 10) {
        window.scrollTo({top: anchor.y, behavior: 'instant'});
        animation = 0;
        velocity = 0;
        lastFrame = 0;
        return;
      }
      position += velocity * dt;
      window.scrollTo({top: position, behavior: 'instant'});
      animation = requestAnimationFrame(step);
    }
    animation = requestAnimationFrame(step);
  }
  function capture(target) {
    anchor = target;
    capturedAt = performance.now();
    effort = 0;
    gestureEligible = false;
    pull();
    syncFrames();
  }
  function settle(idle = false) {
    if (reducedMotion.matches || touching || draggingScrollbar || animation || (!gestureEligible && !idle)) return;
    if (anchor) { pull(); return; }
    const target = nearest(scrollY);
    if (inZone(target, scrollY)) capture(target);
  }
  function scrollInput(delta, touch = false) {
    if (reducedMotion.matches || !delta) return false;
    if (touch) { trackTouch(delta); return false; }
    const now = performance.now(), interval = now - lastInput, sign = Math.sign(delta);
    if (interval > 300) { fastWheel = false; gestureEligible = false; }
    const speed = Math.abs(delta) / Math.max(interval > 300 ? 180 : interval, 16);
    const fast = Math.abs(delta) > 180 || speed > 1.4;
    const fresh = now - lastInput > 170 || sign !== direction;
    const tapering = !fresh && Math.abs(delta) < lastMagnitude * .96;
    lastInput = now;
    lastMagnitude = Math.abs(delta);
    direction = sign;
    scrollSpeed = speed;
    lastMotionAt = now;
    if (fast) { fastWheel = true; gestureEligible = false; if (anchor) release(); return false; }
    if (!fastWheel) {
      gestureEligible = true;
      const target = nearest(scrollY);
      if (!anchor && speed < .45 && inZone(target, scrollY)) capture(target);
    }
    if (anchor) {
      if (fresh) effort = 0;
      const arriving = !touch && now - capturedAt < 360;
      if (arriving) effort = 0;
      else effort += Math.abs(delta) * (!touch && tapering ? .15 : 1);
      // Absorb the tail of the arriving gesture, then let a deliberate scroll leave.
      const ready = !arriving;
      if (ready && effort > (touch ? 70 : fresh ? 80 : 220)) {
        release();
        return false;
      }
      cancelPull();
      window.scrollBy({top: delta * (.08 + .7 * clamp(speed / 1.4, 0, 1)), behavior: 'instant'});
      pull();
      return true;
    }
    return false;
  }
  function trackTouch(delta) {
    const now = performance.now();
    touchSpeed = Math.max(touchSpeed, Math.abs(delta) / Math.max(now - lastTouchAt, 16));
    touchDistance += Math.abs(delta);
    lastTouchAt = now;
  }
  function beginTouch() {
    touching = true;
    clearTimeout(idleTimer);
    touchSpeed = 0;
    touchDistance = 0;
    lastTouchAt = performance.now();
    gestureEligible = false;
    if (anchor) { anchor = null; cancelPull(); syncFrames(); }
  }
  function interactive(target) {
    return target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  }
  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || !event.cancelable || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || interactive(event.target)) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (scrollInput(delta)) event.preventDefault();
  }, {passive: false});
  window.addEventListener('touchstart', event => {
    beginTouch();
    touchY = event.touches.length === 1 && !interactive(event.target) ? event.touches[0].clientY : null;
    touchX = touchY === null ? null : event.touches[0].clientX;
    touchCapture = false;
    effort = 0;
  }, {passive: true});
  window.addEventListener('touchmove', event => {
    if (touchY === null || event.touches.length !== 1 || !event.cancelable) return;
    const y = event.touches[0].clientY, x = event.touches[0].clientX, delta = touchY - y;
    const horizontal = Math.abs(x - touchX) > Math.abs(delta);
    if (!horizontal) trackTouch(delta);
    touchY = y;
    touchX = x;
    if (horizontal || !touchCapture) return;
    event.preventDefault();
    if (!scrollInput(delta, true)) window.scrollBy({top: delta, behavior: 'instant'});
  }, {passive: false});
  function endTouch() {
    touching = false;
    gestureEligible = touchDistance > 10 && touchSpeed < 1.1;
    scrollSpeed = touchSpeed;
    lastMotionAt = performance.now();
    touchY = null;
    touchX = null;
    touchCapture = false;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 180);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => settle(true), 800);
  }
  window.addEventListener('touchend', endTouch, {passive: true});
  window.addEventListener('touchcancel', endTouch, {passive: true});
  window.addEventListener('scroll', () => {
    if (anchor && !animation && !touching && Math.abs(anchor.y - scrollY) > 28) release();
    if (bypass) {
      const target = targets.find(target => target.section === bypass);
      if (scrollY < target.start - 80 || scrollY > target.end + 80) bypass = null;
    }
    syncFrames();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 180);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => settle(true), 800);
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (!interactive(event.target) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) release();
  });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.clientX >= document.documentElement.clientWidth) {
      draggingScrollbar = true;
      release();
    }
  });
  window.addEventListener('pointerup', () => {
    if (draggingScrollbar) { draggingScrollbar = false; settle(); }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = targets.find(target => '#' + target.section.id === link.hash);
    release();
    if (!target || reducedMotion.matches) return;
    event.preventDefault();
    bypass = null;
    history.pushState(null, '', link.hash);
    capture(target);
  });
  window.addEventListener('popstate', release);
  reducedMotion.addEventListener('change', release);
  window.addEventListener('message', event => {
    const frame = frames.find(frame => frame.contentWindow === event.source);
    if (!frame) return;
    const message = event.data;
    if (message?.type === 'ramnet:ready') frame.contentWindow.postMessage({type: 'ramnet:scroll-mode', capture: captureFrames}, '*');
    if (message?.type === 'ramnet:scroll-touch') {
      if (message.active) { beginTouch(); effort = 0; } else endTouch();
    }
    if (message?.type === 'ramnet:scroll-input' && Number.isFinite(message.delta)) {
      if (!scrollInput(message.delta, message.touch === true)) window.scrollBy({top: message.delta, behavior: 'instant'});
    }
  });
  const observer = new ResizeObserver(refreshTargets);
  sections.forEach(section => observer.observe(section));
  observer.observe(document.querySelector('.hero'));
  window.addEventListener('resize', refreshTargets);
  refreshTargets();
  idleTimer = setTimeout(() => settle(true), 800);
})();
