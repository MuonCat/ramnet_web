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
  const compact = window.ramnetCompactInteractions = window.matchMedia('(max-width: 760px), (max-width: 1024px) and (pointer: coarse)');
  function updateInteractionMode() {
    document.documentElement.classList.toggle('compact-interactions', compact.matches);
    document.querySelectorAll('[data-fine-interaction]').forEach(element => { element.inert = compact.matches; });
  }
  compact.addEventListener('change', updateInteractionMode);
  updateInteractionMode();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const callbacks = new Map();
  let scheduled = false, sequence = 0;
  function schedule() {
    if (scheduled || reducedMotion.matches || document.hidden || !callbacks.size) return;
    scheduled = true;
    nativeFrame(stamp => {
      scheduled = false;
      if (reducedMotion.matches || document.hidden) return;
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
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', schedule);
})();
