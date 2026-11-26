(() => {
  'use strict';
  const sections = [...document.querySelectorAll('.paper-section')];
  const chapterNav = document.querySelector('.chapter-nav');
  const links = [...chapterNav.querySelectorAll('.chapter-links a')];
  const progress = chapterNav.querySelector('.reading-progress');
  const hero = document.querySelector('.hero');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const nativeScrollEnd = 'onscrollend' in document;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const targets = sections.map((section, index) => {
    const paragraphs = (sections[index - 1] || hero).querySelectorAll('p');
    return {section, heading: section.querySelector('.section-heading'), tail: paragraphs[Math.max(0, paragraphs.length - 2)]};
  });
  let maxScroll = 0, lastScrollY = scrollY, readingFrame = 0, highlighted;
  let snapFrame = 0, snapTimer = 0, snapArmed = false, alignedSection = null;
  let departure = null, cooldownUntil = 0;
  let touchInput = false, touching = false, awaitingScrollEnd = false, draggingScrollbar = false;
  let autoplay = false, hashTimer = 0, historyFrame = 0;
  let readingSection = null, resizeSection, resizeTimer = 0;
  let viewportWidth = document.documentElement.clientWidth, viewportScale = devicePixelRatio;

  function visibleSection(tolerance = 8) {
    return targets.findLast(target => target.y <= scrollY + tolerance)?.section ?? null;
  }
  function sectionY(section) {
    return targets.find(target => target.section === section)?.y ?? 0;
  }
  function targetAt(y) {
    return targets.reduce((best, target) => {
      if (y < target.start || y > target.end) return best;
      return !best || Math.abs(target.y - y) < Math.abs(best.y - y) ? target : best;
    }, null);
  }
  function renderReading() {
    readingFrame = 0;
    if (alignedSection && !snapFrame && !touching && !awaitingScrollEnd) {
      const y = sectionY(alignedSection);
      if (Math.abs(scrollY - y) > .5) moveTo(y);
    }
    const current = visibleSection();
    if (current !== highlighted) {
      for (const link of links) {
        if (current && link.hash === '#' + current.id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
      highlighted = current;
    }
    progress.style.transform = `scaleX(${maxScroll ? clamp(scrollY / maxScroll, 0, 1) : 0})`;
  }
  function scheduleReading() {
    if (!readingFrame) readingFrame = requestAnimationFrame(renderReading);
  }
  function refreshTargets() {
    const root = document.documentElement;
    const inset = chapterNav.getBoundingClientRect().height;
    if (root.style.getPropertyValue('--chapter-nav-height') !== `${inset}px`) root.style.setProperty('--chapter-nav-height', `${inset}px`);
    maxScroll = Math.max(0, root.scrollHeight - innerHeight);
    const offset = scrollY - inset;
    for (const target of targets) {
      const y = target.y = clamp(target.section.getBoundingClientRect().top + offset, 0, maxScroll);
      // Capture the previous section’s last lines and this section’s partially visible heading.
      target.start = clamp(target.tail ? target.tail.getBoundingClientRect().top + offset : y - 180, Math.max(0, y - 280), y);
      target.end = clamp(target.heading.getBoundingClientRect().bottom + offset, y, maxScroll);
    }
    scheduleReading();
    scheduleSnap();
  }
  function releaseResizeSection() {
    if (resizeSection === undefined) return;
    clearTimeout(resizeTimer);
    resizeSection = undefined;
    readingSection = visibleSection();
  }
  function updateCooldown(delta) {
    const target = targetAt(scrollY);
    if (target && delta && delta * (target.y - scrollY) <= 0) {
      departure = target;
      cooldownUntil = performance.now() + 500;
    } else departure = null;
  }
  function stopSnap() {
    clearTimeout(snapTimer);
    cancelAnimationFrame(snapFrame);
    snapFrame = 0;
    alignedSection = null;
    lastScrollY = scrollY;
  }
  function moveTo(y) {
    window.scrollTo({top: y, behavior: 'instant'});
    // Browsers round to a representable position; ignore the scroll event for this exact write.
    lastScrollY = scrollY;
  }
  function alignSection(section, onArrival) {
    releaseResizeSection();
    stopSnap();
    clearTimeout(hashTimer);
    departure = null;
    awaitingScrollEnd = false;
    readingSection = alignedSection = section;
    const start = scrollY, began = performance.now();
    function finish() {
      snapFrame = 0;
      snapArmed = false;
      scheduleReading();
      setChapterHash(section);
      onArrival?.();
    }
    if (reducedMotion.matches || Math.abs(start - sectionY(section)) <= .5) {
      moveTo(sectionY(section));
      finish();
      return;
    }
    // Absolute smoothstep keeps the landing independent of frame rate.
    function step(now) {
      const u = clamp((now - began) / 360, 0, 1);
      moveTo(start + (sectionY(section) - start) * u * u * (3 - 2 * u));
      if (u < 1) snapFrame = requestAnimationFrame(step);
      else finish();
    }
    snapFrame = requestAnimationFrame(step);
  }
  function canSnap() {
    return snapArmed && !touching && !draggingScrollbar && !autoplay && !snapFrame &&
      resizeSection === undefined && !document.hidden && (window.visualViewport?.scale ?? 1) === 1;
  }
  function scheduleSnap() {
    clearTimeout(snapTimer);
    if (!canSnap() || awaitingScrollEnd) return;
    const target = targetAt(scrollY);
    if (target !== departure) departure = null;
    if (!target || target.section === alignedSection) return;
    // Older touch browsers have no scrollend; wait for a quiet viewport after the last scroll.
    const settle = touchInput && !nativeScrollEnd ? 240 : 120;
    snapTimer = setTimeout(() => {
      if (canSnap() && scrollY === lastScrollY && targetAt(scrollY) === target) alignSection(target.section);
    }, Math.max(settle, departure ? cooldownUntil - performance.now() : 0));
  }
  function setChapterHash(section) {
    const hash = section && section.id !== 'closing' ? `#${section.id}` : '';
    if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
  }
  function scheduleHashUpdate() {
    if (autoplay || resizeSection !== undefined) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => setChapterHash(visibleSection()), 650);
  }
  function interactive(event) {
    const target = event.composedPath()[0];
    return target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  }
  function interrupt() {
    cancelAnimationFrame(historyFrame);
    if (snapFrame) scheduleHashUpdate();
    releaseResizeSection();
    stopAutoplay();
    stopSnap();
  }
  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.defaultPrevented || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) { stopAutoplay(); return; }
    interrupt();
    touchInput = awaitingScrollEnd = false;
    if (interactive(event)) return;
    snapArmed = true;
    updateCooldown(event.deltaY);
    scheduleSnap();
  }, {passive: true});
  const touchOptions = {capture: true, passive: true};
  window.addEventListener('touchstart', () => {
    touching = touchInput = true;
    // A new contact brakes the previous fling, which may never send another scrollend.
    awaitingScrollEnd = false;
    interrupt();
  }, touchOptions);
  function releaseTouch(event) {
    touching = event.touches.length > 0;
    if (!touching) scheduleSnap();
  }
  window.addEventListener('touchend', releaseTouch, touchOptions);
  window.addEventListener('touchcancel', releaseTouch, touchOptions);
  document.addEventListener('scrollend', event => {
    if (event.target !== document || !awaitingScrollEnd) return;
    awaitingScrollEnd = false;
    scheduleSnap();
  });
  window.addEventListener('scroll', () => {
    scheduleReading();
    const delta = scrollY - lastScrollY;
    lastScrollY = scrollY;
    if (!delta || resizeSection !== undefined) return;
    // Reflow can move the viewport while an anchor is settling. Real input releases
    // that anchor synchronously. On older touch browsers a delayed fling can also resume.
    if (alignedSection || snapFrame) {
      if (!(snapFrame && snapArmed && touchInput && !nativeScrollEnd)) return;
      stopSnap();
    }
    if (autoplay) return;
    if (touchInput) {
      snapArmed = true;
      awaitingScrollEnd = nativeScrollEnd;
    }
    if (document.documentElement.clientWidth === viewportWidth && devicePixelRatio === viewportScale) readingSection = visibleSection();
    updateCooldown(delta);
    scheduleHashUpdate();
    scheduleSnap();
  }, {passive: true});
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') { interrupt(); return; }
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    if (interactive(event)) { stopAutoplay(); return; }
    interrupt();
    touchInput = awaitingScrollEnd = false;
    snapArmed = true;
  });
  document.addEventListener('pointerdown', event => {
    if (event.target.closest('#autoplay-toggle')) return;
    interrupt();
    if (event.pointerType !== 'mouse' || event.clientX < document.documentElement.clientWidth) return;
    draggingScrollbar = snapArmed = true;
    touchInput = awaitingScrollEnd = false;
  });
  function releaseScrollbar() {
    if (draggingScrollbar) { draggingScrollbar = false; scheduleSnap(); }
  }
  window.addEventListener('pointerup', releaseScrollbar);
  window.addEventListener('pointercancel', releaseScrollbar);
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.hash === '#top') {
      event.preventDefault();
      snapArmed = false;
      setChapterHash(null);
      alignSection(null);
      return;
    }
    if (!document.getElementById(link.hash.slice(1))) return;
    event.preventDefault();
    history.pushState(null, '', link.hash);
    navigateHash(link.hash);
  });
  const autoplayButton = document.getElementById('autoplay-toggle');
  const autoplayIcon = autoplayButton.querySelector('.autoplay-icon');
  const desktopAutoplay = matchMedia('(min-width: 761px) and (pointer: fine)');
  let autoplayTimer = 0;
  function setAutoplay(active) {
    autoplay = active;
    document.documentElement.classList.toggle('is-autoplaying', active);
    autoplayButton.setAttribute('aria-pressed', String(active));
    autoplayButton.setAttribute('aria-label', window.RamnetRuntime.translateText(active ? 'Stop automatic section playback' : 'Start automatic section playback'));
    autoplayIcon.innerHTML = window.RamnetRuntime.playbackIcon(active);
    window.dispatchEvent(new Event('ramnet:autoplay-change'));
  }
  function stopAutoplay() {
    if (!autoplay) return;
    clearTimeout(autoplayTimer);
    stopSnap();
    delete document.documentElement.dataset.autoplaySection;
    setAutoplay(false);
    scheduleSnap();
  }
  function playSection(index, resumeCurrent = false) {
    const section = sections[index];
    alignSection(section, () => {
      document.documentElement.dataset.autoplaySection = section.id;
      const detail = {id: section.id, resumeCurrent};
      const exhibit = section.querySelector('.embedded-exhibit');
      exhibit?.dispatchEvent(new CustomEvent('ramnet:autoplay-start', {detail}));
      window.dispatchEvent(new CustomEvent('ramnet:autoplay-section', {detail}));
      const duration = resumeCurrent && Number.isFinite(detail.remainingMs) ? Math.max(250, detail.remainingMs) : Number(exhibit?.dataset.cycleMs || section.dataset.cycleMs) || 6000;
      autoplayTimer = setTimeout(() => playSection((index + 1) % sections.length), duration);
    });
  }
  autoplayIcon.innerHTML = window.RamnetRuntime.playbackIcon(false);
  autoplayButton.addEventListener('click', () => {
    if (autoplay) { stopAutoplay(); return; }
    if (!desktopAutoplay.matches || document.hidden) return;
    setAutoplay(true);
    const current = visibleSection(80);
    playSection(Math.max(0, sections.indexOf(current)), Boolean(current));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopAutoplay(); stopSnap(); }
    else scheduleSnap();
  });
  desktopAutoplay.addEventListener('change', () => { if (!desktopAutoplay.matches) stopAutoplay(); });

  function navigateHash(hash) {
    snapArmed = false;
    if (!hash || hash === '#top') { setChapterHash(null); alignSection(null); return; }
    const element = document.getElementById(hash.slice(1));
    const section = element?.closest('.paper-section');
    if (section) { setChapterHash(section); alignSection(section); }
    else if (element) {
      stopSnap();
      snapArmed = false;
      clearTimeout(hashTimer);
      if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
      element.scrollIntoView({behavior: 'instant', block: 'start'});
      lastScrollY = scrollY;
      readingSection = visibleSection();
      scheduleReading();
    }
  }
  function historyNavigation() {
    clearTimeout(hashTimer);
    cancelAnimationFrame(historyFrame);
    historyFrame = requestAnimationFrame(() => {
      stopAutoplay();
      snapArmed = false;
      navigateHash(location.hash);
    });
  }
  window.addEventListener('popstate', historyNavigation);
  window.addEventListener('hashchange', historyNavigation);
  window.addEventListener('pageshow', () => { refreshTargets(); readingSection = visibleSection(); });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && snapFrame && !autoplay) alignSection(alignedSection);
  });
  const closing = document.querySelector('.closing');
  const closingHeading = closing.querySelector('.section-heading');
  const footer = document.querySelector('.site-footer');
  function refreshLayout() {
    for (const [name, height] of [
      ['--closing-nav-height', chapterNav.offsetHeight],
      ['--closing-footer-height', footer.offsetHeight],
      ['--closing-heading-height', closingHeading.offsetHeight]
    ]) {
      const value = `${height}px`;
      if (closing.style.getPropertyValue(name) !== value) closing.style.setProperty(name, value);
    }
    refreshTargets();
  }
  const observer = new ResizeObserver(window.RamnetRuntime.onNextFrame(refreshLayout));
  for (const element of [...sections, hero, chapterNav, footer, closingHeading]) observer.observe(element);
  window.addEventListener('resize', () => {
    const width = document.documentElement.clientWidth;
    if (width !== viewportWidth || devicePixelRatio !== viewportScale) {
      if (resizeSection === undefined && !touching && !awaitingScrollEnd) resizeSection = readingSection;
      viewportWidth = width;
      viewportScale = devicePixelRatio;
      stopAutoplay();
      stopSnap();
      snapArmed = false;
      departure = null;
      clearTimeout(hashTimer);
    }
    refreshLayout();
    if (resizeSection !== undefined) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const section = resizeSection;
        resizeSection = undefined;
        alignedSection = readingSection = section;
        moveTo(sectionY(section));
        setChapterHash(section);
        scheduleReading();
      }, 650);
    }
  });
  refreshLayout();
  readingSection = visibleSection();
  window.RamnetSectionScroll = {navigateHash};
})();
