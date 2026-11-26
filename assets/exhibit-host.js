(() => {
  'use strict';
  const runtime = window.RamnetRuntime;
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
    wrapper.className = 'exhibit-content';
    const body = document.createElement('div');
    body.className = `${markup.bodyClass} exhibit-body`;
    body.innerHTML = markup.html;
    window.RamnetI18n?.translate(body);
    wrapper.append(body);
    shadow.append(wrapper);
    runtime.applyTheme(host);
    runtime.bindInteractions(wrapper, body);
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
    window.RamnetAnimations[name](runtime.createScope(scopedDocument, host));
    host.style.minHeight = '';
    host.dispatchEvent(new Event('ramnet:mounted'));
  }

  window.RamnetExhibitsReady = window.RamnetPaletteReady.then(() =>
    Promise.all(hosts.map(host => mount(host).catch(error => {
      console.error(error);
      (host.shadowRoot || host).textContent = runtime.translateText('Unable to load this figure.');
    })))
  );
})();
