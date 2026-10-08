(() => {
  'use strict';
  const lang = new URL(location.href).searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  const catalog = window.RamnetChinese;
  const t = value => lang === 'zh' ? catalog.text[value] ?? value : value;

  function translate(root) {
    if (lang !== 'zh') return;
    for (const [selector, values] of Object.entries(catalog.html)) {
      root.querySelectorAll(selector).forEach((element, index) => {
        if (index < values.length) element.innerHTML = values[index];
      });
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script, style, math, .math')) continue;
      const key = node.textContent.trim().replace(/\s+/g, ' ');
      if (catalog.text[key]) node.textContent = node.textContent.replace(/\S[\s\S]*\S|\S/, t(key));
    }
    root.querySelectorAll('[aria-label], [title], [placeholder], [alt]').forEach(element => {
      for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
      }
    });
  }

  window.RamnetI18n = {lang, t, translate};
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  translate(document);
  if (lang === 'zh') {
    document.querySelector('meta[name="description"]').content = '探索 RAM-Net：以少量槽位读写更大的递归记忆。通过交互动画理解 Product Softmax、CAPE、门控稀疏更新与 CUDA 执行流程。';
  }
  document.querySelectorAll('[data-language]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.language === lang));
    button.addEventListener('click', () => {
      if (button.dataset.language === lang) return;
      const url = new URL(location.href);
      if (button.dataset.language === 'zh') url.searchParams.set('lang', 'zh');
      else url.searchParams.delete('lang');
      url.hash = location.hash;
      location.assign(url.href);
    });
  });
})();
