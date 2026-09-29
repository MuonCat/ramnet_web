(() => {
  'use strict';

  const tones = {
    red: ['#ba736d', '#8c4b46'], pink: ['#ab749f', '#804c75'],
    purple: ['#967bb5', '#6c5289'], indigo: ['#7e83bf', '#575a92'],
    blue: ['#5e8dbe', '#356391'], sky: ['#729ed5', '#3269a8'],
    cyan: ['#3c97ab', '#006d80'], green: ['#5a9971', '#2f6f49'],
    gold: ['#a28545', '#785c18'], orange: ['#b37a53', '#87512a']
  };
  const textColors = new Map(Object.values(tones));
  const compactInteractions = matchMedia('(max-width: 760px), (max-width: 1024px) and (pointer: coarse)');
  const compactLayout = matchMedia('(max-width: 760px), (max-width: 1024px) and (max-aspect-ratio: 4/5), (max-width: 1024px) and (min-aspect-ratio: 3/2)');
  const narrowLayout = matchMedia('(max-width: 760px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const nativeFrame = requestAnimationFrame.bind(window);

  window.ramnetDiagramTheme = {
    colors: Object.fromEntries(Object.entries(tones).map(([name, pair]) => [name, pair[0]])),
    alpha: {surface: .06, border: .35, link: .72, low: .24, strong: .82},
    text: color => textColors.get(color) || color,
    strength: value => .08 + .74 * Math.max(0, Math.min(1, value)),
    rgba(color, alpha) {
      const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      return `rgba(${rgb.join(',')},${Math.max(0, Math.min(1, alpha))})`;
    }
  };
  window.ramnetCompactInteractions = compactInteractions;

  function applyTheme(element) {
    for (const [name, [color, ink]] of Object.entries(tones)) {
      element.style.setProperty(`--diagram-${name}`, color);
      element.style.setProperty(`--diagram-${name}-ink`, ink);
    }
  }

  function bindInteractions(container, content) {
    const update = () => {
      container.classList.toggle('compact-interactions', compactInteractions.matches);
      content.querySelectorAll('[data-fine-interaction]').forEach(element => {
        element.inert = compactInteractions.matches;
      });
    };
    compactInteractions.addEventListener('change', update);
    update();
  }

  function createScope(scopedDocument, host = null) {
    const callbacks = new Map();
    let visible = !host, scheduled = false, reducedFrameRendered = false, nextId = 0;
    function schedule() {
      if (scheduled || !visible || document.hidden || !callbacks.size || reducedMotion.matches && reducedFrameRendered) return;
      scheduled = true;
      nativeFrame(time => {
        scheduled = false;
        if (!visible || document.hidden) return;
        const pending = [...callbacks.values()];
        callbacks.clear();
        reducedFrameRendered = reducedMotion.matches;
        pending.forEach(callback => callback(time));
        schedule();
      });
    }
    if (host) new IntersectionObserver(entries => {
      if (!visible && entries[0].isIntersecting) reducedFrameRendered = false;
      visible = entries[0].isIntersecting;
      schedule();
    }, {rootMargin: '100px 0px'}).observe(host);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reducedFrameRendered = false; schedule(); });
    reducedMotion.addEventListener('change', () => { reducedFrameRendered = false; schedule(); });
    return {
      document: scopedDocument,
      requestAnimationFrame(callback) {
        const id = ++nextId;
        callbacks.set(id, callback);
        schedule();
        return id;
      },
      cancelAnimationFrame(id) { callbacks.delete(id); },
      setCycleDuration(seconds) {
        if (host && Number.isFinite(seconds) && seconds > 0) {
          host.dataset.cycleMs = String(Math.round(seconds * 1000));
        }
      },
      onAutoplayStart(callback) {
        host?.addEventListener('ramnet:autoplay-start', callback);
      }
    };
  }

  function mountStandalone(name) {
    applyTheme(document.documentElement);
    bindInteractions(document.documentElement, document.body);
    window.RamnetAnimations[name](createScope(document));
  }

  window.RamnetRuntime = {
    compactInteractions, compactLayout, narrowLayout, reducedMotion,
    applyTheme, bindInteractions, createScope, mountStandalone
  };
})();
