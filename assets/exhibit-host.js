(() => {
  'use strict';
  const tones = {
    red: ['#ba736d', '#8c4b46'], pink: ['#ab749f', '#804c75'],
    purple: ['#967bb5', '#6c5289'], indigo: ['#7e83bf', '#575a92'],
    blue: ['#5e8dbe', '#356391'], sky: ['#729ed5', '#3269a8'],
    cyan: ['#3c97ab', '#006d80'], green: ['#5a9971', '#2f6f49'],
    gold: ['#a28545', '#785c18'], orange: ['#b37a53', '#87512a']
  };
  const colors = Object.fromEntries(Object.entries(tones).map(([name, pair]) => [name, pair[0]]));
  const textColors = new Map(Object.values(tones));
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
  const compact = window.ramnetCompactInteractions = matchMedia('(max-width: 760px), (max-width: 1024px) and (pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hosts = [...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];

  async function mount(host) {
    const name = host.dataset.exhibit;
    const markup = window.RamnetExhibitMarkup[name];
    const shadow = host.attachShadow({mode: 'open'});
    const styles = markup.styles.map(path => {
      const sheet = document.createElement('link');
      sheet.rel = 'stylesheet';
      sheet.href = path;
      const loaded = new Promise(resolve => { sheet.onload = resolve; sheet.onerror = resolve; });
      shadow.append(sheet);
      return loaded;
    });
    const wrapper = document.createElement('div');
    const body = document.createElement('div');
    body.className = `${markup.bodyClass} exhibit-body`;
    body.innerHTML = markup.html;
    wrapper.append(body);
    shadow.append(wrapper);
    for (const [tone, [color, ink]] of Object.entries(tones)) {
      host.style.setProperty(`--diagram-${tone}`, color);
      host.style.setProperty(`--diagram-${tone}-ink`, ink);
    }
    const syncCompact = () => {
      wrapper.classList.toggle('compact-interactions', compact.matches);
      body.querySelectorAll('[data-fine-interaction]').forEach(element => { element.inert = compact.matches; });
    };
    compact.addEventListener('change', syncCompact);
    syncCompact();
    await Promise.all(styles);

    const scopedDocument = {
      body,
      documentElement: body,
      get hidden() { return document.hidden; },
      getElementById: id => shadow.getElementById(id),
      querySelector: selector => shadow.querySelector(selector),
      querySelectorAll: selector => shadow.querySelectorAll(selector),
      createElement: document.createElement.bind(document),
      createElementNS: document.createElementNS.bind(document),
      addEventListener(type, listener, options) {
        (type === 'visibilitychange' ? document : body).addEventListener(type, listener, options);
      }
    };
    let visible = false, scheduled = 0, nextId = 0;
    const callbacks = new Map();
    const schedule = () => {
      if (scheduled || !visible || reducedMotion.matches || document.hidden || !callbacks.size) return;
      scheduled = window.requestAnimationFrame(time => {
        scheduled = 0;
        if (!visible || reducedMotion.matches || document.hidden) return;
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach(callback => callback(time));
        schedule();
      });
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }, {rootMargin: '100px 0px'});
    observer.observe(host);
    document.addEventListener('visibilitychange', schedule);
    reducedMotion.addEventListener('change', schedule);
    window.RamnetAnimations[name]({
      document: scopedDocument,
      setCycleDuration(seconds) {
        if (Number.isFinite(seconds) && seconds > 0) host.dataset.cycleMs = String(Math.round(seconds * 1000));
      },
      onAutoplayStart(callback) { host.addEventListener('ramnet:autoplay-start', callback); },
      requestAnimationFrame(callback) { const id = ++nextId; callbacks.set(id, callback); schedule(); return id; },
      cancelAnimationFrame(id) { callbacks.delete(id); }
    });
    host.style.minHeight = '';
    const syncHeight = () => { host.style.height = `${Math.ceil(wrapper.offsetHeight)}px`; };
    new ResizeObserver(syncHeight).observe(wrapper);
    syncHeight();
    host.dispatchEvent(new Event('ramnet:mounted'));
  }

  hosts.forEach(host => mount(host).catch(error => {
    console.error(error);
    host.textContent = 'Unable to load this figure.';
  }));
})();
