(() => {
  'use strict';

  let tonePairs, toneColors, textColors;
  const tones = () => tonePairs ??= window.RamnetPalette.tones;
  const compactInteractionMedia = matchMedia('(max-aspect-ratio: 1/1), (max-width: 560px), (max-width: 1024px) and (min-aspect-ratio: 9/5)');
  const compactInteractions = new EventTarget();
  compactInteractions.matches = compactInteractionMedia.matches;
  compactInteractions.set = matches => {
    if (compactInteractions.matches === matches) return;
    compactInteractions.matches = matches;
    compactInteractions.dispatchEvent(new Event('change'));
  };
  const articlePage = Boolean(document.querySelector('main.article'));
  if (!articlePage) {
    compactInteractionMedia.addEventListener('change', () => compactInteractions.set(compactInteractionMedia.matches));
  }
  const compactLayout = articlePage ? compactInteractions : compactInteractionMedia;
  const narrowLayout = compactLayout;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const nativeFrame = requestAnimationFrame.bind(window);

  window.ramnetDiagramTheme = {
    get colors() { return toneColors ??= Object.fromEntries(Object.entries(tones()).map(([name, pair]) => [name, pair[0]])); },
    get alpha() { return window.RamnetPalette.alpha; },
    text: color => (textColors ??= new Map(Object.values(tones()))).get(color) || color,
    strength(value, color) {
      const palette = window.RamnetPalette;
      const range = palette.ranges.diagramStrength;
      return range.start + (range.end - range.start) * palette.weight(value, color);
    },
    rgba(color, alpha) {
      const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
      return `rgba(${rgb.join(',')},${Math.max(0, Math.min(1, alpha))})`;
    }
  };
  window.ramnetCompactInteractions = compactInteractions;

  function applyTheme(element) {
    for (const [name, [color, ink]] of Object.entries(tones())) {
      element.style.setProperty(`--diagram-${name}`, color);
      element.style.setProperty(`--diagram-${name}-ink`, ink);
    }
  }

  function playbackIcon(playing) {
    const path = playing ? 'M7 5v10M13 5v10' : 'm7 4 9 6-9 6z';
    return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  function setPlaybackIcon(button, playing) {
    const mode = playing ? 'pause' : 'play';
    if (button.dataset.playbackIcon !== mode) {
      button.innerHTML = playbackIcon(playing);
      button.dataset.playbackIcon = mode;
    }
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    button.title = playing ? 'Pause' : 'Play';
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
    window.RamnetPaletteReady.then(() => {
      applyTheme(document.documentElement);
      bindInteractions(document.documentElement, document.body);
      window.RamnetAnimations[name](createScope(document));
    });
  }

  window.RamnetRuntime = {
    compactInteractions, compactLayout, narrowLayout, reducedMotion,
    applyTheme, bindInteractions, createScope, mountStandalone,
    playbackIcon, setPlaybackIcon
  };
})();
