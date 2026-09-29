(() => {
  'use strict';
  // Common hue families; sky follows the site's accent with darker, readable labels.
  const tones = {
    red: ['#ba736d', '#8c4b46'],
    pink: ['#ab749f', '#804c75'],
    purple: ['#967bb5', '#6c5289'],
    indigo: ['#7e83bf', '#575a92'],
    blue: ['#5e8dbe', '#356391'],
    sky: ['#729ed5', '#3269a8'],
    cyan: ['#3c97ab', '#006d80'],
    green: ['#5a9971', '#2f6f49'],
    gold: ['#a28545', '#785c18'],
    orange: ['#b37a53', '#87512a']
  };
  const colors = Object.fromEntries(Object.entries(tones).map(([name, pair]) => [name, pair[0]]));
  const textColors = new Map(Object.values(tones));
  for (const [name, [color, ink]] of Object.entries(tones)) {
    document.documentElement.style.setProperty(`--diagram-${name}`, color);
    document.documentElement.style.setProperty(`--diagram-${name}-ink`, ink);
  }
  window.ramnetDiagramTheme = {
    colors,
    alpha: {surface: .06, border: .35, link: .72, low: .24, strong: .82},
    text: color => textColors.get(color) || color,
    strength: value => .08 + .74 * Math.max(0, Math.min(1, value)),
    rgba(color, alpha) {
      const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      return `rgba(${rgb.join(',')},${Math.max(0, Math.min(1, alpha))})`;
    }
  };
  document.documentElement.classList.toggle('is-embedded', window.parent !== window);
  const compact = window.ramnetCompactInteractions = window.matchMedia('(max-width: 760px), (max-width: 1024px) and (pointer: coarse)');
  function updateInteractionMode() {
    document.documentElement.classList.toggle('compact-interactions', compact.matches);
    document.querySelectorAll('[data-fine-interaction]').forEach(element => { element.inert = compact.matches; });
  }
  compact.addEventListener('change', updateInteractionMode);
  updateInteractionMode();
  // Wheel and touch events do not bubble out of an iframe.
  let captureScroll = false, scrollTouch = null;
  const scrollControl = target => target instanceof Element && target.closest('input, select, textarea, button, a, [role="slider"], [contenteditable="true"]');
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.data?.type === 'ramnet:scroll-mode') captureScroll = event.data.capture === true;
  });
  window.addEventListener('wheel', event => {
    if (!captureScroll || event.ctrlKey || event.defaultPrevented || !event.cancelable || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || scrollControl(event.target)) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    window.parent.postMessage({type: 'ramnet:scroll-input', delta}, '*');
  }, {passive: false});
  window.addEventListener('touchstart', event => {
    if (window.parent === window || event.touches.length !== 1 || scrollControl(event.target) || event.target.closest('[data-fine-interaction]:not([inert])')) return;
    scrollTouch = {x: event.touches[0].clientX, y: event.touches[0].clientY, capture: captureScroll};
    window.parent.postMessage({type: 'ramnet:scroll-touch', active: true}, '*');
  }, {passive: true});
  window.addEventListener('touchmove', event => {
    if (!scrollTouch || !scrollTouch.capture || event.touches.length !== 1 || event.defaultPrevented || !event.cancelable) return;
    const touch = event.touches[0], delta = scrollTouch.y - touch.clientY;
    const horizontal = Math.abs(touch.clientX - scrollTouch.x) > Math.abs(delta);
    scrollTouch.x = touch.clientX;
    scrollTouch.y = touch.clientY;
    if (horizontal) return;
    event.preventDefault();
    window.parent.postMessage({type: 'ramnet:scroll-input', delta, touch: true}, '*');
  }, {passive: false});
  function endScrollTouch() {
    if (!scrollTouch) return;
    scrollTouch = null;
    window.parent.postMessage({type: 'ramnet:scroll-touch', active: false}, '*');
  }
  window.addEventListener('touchend', endScrollTouch, {passive: true});
  window.addEventListener('touchcancel', endScrollTouch, {passive: true});
  // Suspend animation work outside the article viewport without changing local playback state.
  const nativeFrame = window.requestAnimationFrame.bind(window);
  let active = window.parent === window;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scheduled = false;
  let sequence = 0;
  const callbacks = new Map();
  function schedule() {
    if (scheduled || !active || paused || document.hidden || !callbacks.size) return;
    scheduled = true;
    nativeFrame(stamp => {
      scheduled = false;
      if (!active || paused || document.hidden) return;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach(callback => callback(stamp));
      schedule();
    });
  }
  window.requestAnimationFrame = callback => {
    const id = ++sequence;
    callbacks.set(id, callback);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'ramnet:visibility') return;
    active = event.data.active === true;
    paused = event.data.paused === true;
    schedule();
  });
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('DOMContentLoaded', () => {
    updateInteractionMode();
    const root = document.querySelector('.exhibit-root');
    const report = () => window.parent.postMessage({type: 'ramnet:resize', height: Math.ceil(root.getBoundingClientRect().height)}, '*');
    new ResizeObserver(report).observe(root);
    report();
    window.parent.postMessage({type: 'ramnet:ready'}, '*');
  });
})();
