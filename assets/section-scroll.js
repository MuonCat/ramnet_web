(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.paper-section')];
  const chapterNav = document.querySelector('.chapter-nav');
  const hero = document.querySelector('.hero');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let targets = [], snapTimer = 0, snapFrame = 0, snapping = false, lastScrollY = scrollY, expectedY = null;
  let cooldownSection = null, cooldownUntil = 0;
  let touching = false, draggingScrollbar = false, autoplay = false;

  function targetAt(y) {
    return targets.reduce((best, target) => {
      if (y < target.start || y > target.end) return best;
      return !best || Math.abs(target.y - y) < Math.abs(best.y - y) ? target : best;
    }, null);
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
    if (autoplay || touching || draggingScrollbar || snapping) return;
    const remaining = cooldownUntil - performance.now();
    snapTimer = setTimeout(snap, Math.max(120, remaining + 1));
  }
  function interactive(event) {
    const target = event.composedPath()[0];
    return target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  }
  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    stopSnap();
    if (interactive(event)) return;
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
    if (autoplay) { lastScrollY = scrollY; return; }
    const delta = scrollY - lastScrollY;
    const ownScroll = snapping || expectedY !== null && scrollY === expectedY;
    lastScrollY = scrollY;
    expectedY = null;
    if (ownScroll || !delta) return;
    updateCooldown(delta, performance.now());
    scheduleSnap();
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (!interactive(event) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopSnap();
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
  const autoplayButton = document.getElementById('autoplay-toggle');
  const autoplayIcon = autoplayButton.querySelector('.autoplay-icon');
  autoplayIcon.innerHTML = window.RamnetRuntime.playbackIcon(false);
  const desktopAutoplay = matchMedia('(min-width: 761px) and (pointer: fine)');
  let autoplayTimer = 0, autoplayFrame = 0, autoplayVisit = 0;
  function stopAutoplay() {
    if (!autoplay) return;
    autoplay = false;
    autoplayVisit++;
    clearTimeout(autoplayTimer);
    cancelAnimationFrame(autoplayFrame);
    if (autoplayFrame) window.scrollTo({top: scrollY, behavior: 'instant'});
    autoplayFrame = 0;
    document.documentElement.classList.remove('is-autoplaying');
    delete document.documentElement.dataset.autoplaySection;
    autoplayButton.setAttribute('aria-pressed', 'false');
    autoplayButton.setAttribute('aria-label', 'Start automatic section playback');
    autoplayIcon.innerHTML = window.RamnetRuntime.playbackIcon(false);
    window.dispatchEvent(new Event('ramnet:autoplay-change'));
    scheduleSnap();
  }
  function playSection(index) {
    if (!autoplay) return;
    const visit = ++autoplayVisit, section = sections[index];
    const destination = () => clamp(scrollY + section.getBoundingClientRect().top - chapterNav.getBoundingClientRect().height, 0, Math.max(0, document.documentElement.scrollHeight - innerHeight));
    const started = performance.now();
    window.scrollTo({top: destination(), behavior: reducedMotion.matches ? 'instant' : 'smooth'});
    function waitForArrival(now) {
      if (!autoplay || visit !== autoplayVisit) return;
      if (Math.abs(scrollY - destination()) < 2 || now - started > 3000) {
        autoplayFrame = 0;
        document.documentElement.dataset.autoplaySection = section.id;
        section.querySelector('.embedded-exhibit')?.dispatchEvent(new Event('ramnet:autoplay-start'));
        window.dispatchEvent(new CustomEvent('ramnet:autoplay-section', {detail: {id: section.id}}));
        const exhibit = section.querySelector('.embedded-exhibit');
        const duration = Number(exhibit?.dataset.cycleMs || section.dataset.cycleMs) || 6000;
        autoplayTimer = setTimeout(() => playSection((index + 1) % sections.length), duration);
      } else autoplayFrame = requestAnimationFrame(waitForArrival);
    }
    if (Math.abs(scrollY - destination()) < 2) waitForArrival(performance.now());
    else autoplayFrame = requestAnimationFrame(waitForArrival);
  }
  autoplayButton.addEventListener('click', () => {
    if (autoplay) { stopAutoplay(); return; }
    if (!desktopAutoplay.matches || document.hidden) return;
    stopSnap();
    autoplay = true;
    document.documentElement.classList.add('is-autoplaying');
    autoplayButton.setAttribute('aria-pressed', 'true');
    autoplayButton.setAttribute('aria-label', 'Stop automatic section playback');
    autoplayIcon.innerHTML = window.RamnetRuntime.playbackIcon(true);
    window.dispatchEvent(new Event('ramnet:autoplay-change'));
    const current = sections.findLast(section => section.getBoundingClientRect().top <= chapterNav.getBoundingClientRect().bottom + 80);
    playSection(Math.max(0, sections.indexOf(current)));
  });
  window.addEventListener('wheel', stopAutoplay, {passive: true});
  window.addEventListener('touchstart', stopAutoplay, {passive: true});
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#autoplay-toggle')) stopAutoplay(); });
  document.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopAutoplay();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAutoplay(); });
  desktopAutoplay.addEventListener('change', () => { if (!desktopAutoplay.matches) stopAutoplay(); });
  window.addEventListener('popstate', () => { stopSnap(); clearCooldown(); scheduleSnap(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { stopSnap(); scheduleSnap(); } });
  const closing = document.querySelector('.closing');
  const closingHeading = closing.querySelector('.section-heading');
  const footer = document.querySelector('.site-footer');
  function sizeClosing() {
    for (const [name, height] of [
      ['--closing-nav-height', chapterNav.offsetHeight],
      ['--closing-footer-height', footer.offsetHeight],
      ['--closing-heading-height', closingHeading.offsetHeight]
    ]) {
      const value = `${height}px`;
      if (closing.style.getPropertyValue(name) !== value) closing.style.setProperty(name, value);
    }
  }
  const observer = new ResizeObserver(() => { sizeClosing(); refreshTargets(); });
  sections.forEach(section => observer.observe(section));
  observer.observe(hero);
  observer.observe(chapterNav);
  observer.observe(footer);
  observer.observe(closingHeading);
  let viewportWidth = innerWidth;
  window.addEventListener('resize', () => {
    if (innerWidth !== viewportWidth) { viewportWidth = innerWidth; stopAutoplay(); }
    sizeClosing();
    refreshTargets();
  });
  sizeClosing();
  refreshTargets();
})();
