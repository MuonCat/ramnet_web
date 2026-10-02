(() => {
  'use strict';
  const source = document.currentScript.dataset.palette;
  const cover = document.createElement('style');
  cover.textContent = 'html:not(.palette-ready) body{visibility:hidden}';
  document.head.append(cover);

  window.RamnetPaletteReady = fetch(source).then(response => {
    if (!response.ok) throw new Error(`Palette request failed: ${response.status}`);
    return response.json();
  }).then(config => {
    const clamp = value => Math.max(0, Math.min(1, value));
    const neutral = step => {
      if (step === 'black') return config.neutral.black;
      if (step === 'dark') return config.neutral.dark;
      const t = clamp(step / config.neutral.steps);
      const channels = [1, 3, 5].map(offset => {
        const start = parseInt(config.neutral.ink.slice(offset, offset + 2), 16);
        const end = parseInt(config.neutral.light.slice(offset, offset + 2), 16);
        return Math.round(start + (end - start) * t);
      });
      return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`;
    };
    const withAlpha = (color, alpha) => {
      const hex = color.length === 4 ? `#${[1, 2, 3].map(i => color[i] + color[i]).join('')}` : color.slice(0, 7);
      return hex + Math.round(clamp(alpha) * 255).toString(16).padStart(2, '0');
    };
    const mix = (from, to, weight) => {
      const t = clamp(weight);
      return `#${[1, 3, 5].map(offset => {
        const start = parseInt(from.slice(offset, offset + 2), 16);
        const end = parseInt(to.slice(offset, offset + 2), 16);
        return Math.round(start + (end - start) * t).toString(16).padStart(2, '0');
      }).join('')}`;
    };
    const style = document.createElement('style');
    style.textContent = ':root{' + Object.entries(config.colors)
      .map(([key, value]) => `--color-${key}:${value};`).join('') +
      Object.entries(config.tones).map(([name, [base, ink]]) =>
        `--tone-${name}:${base};--tone-${name}-ink:${ink};`).join('') +
      Array.from({length: config.neutral.steps + 1}, (_, step) => `--neutral-${step}:${neutral(step)};`).join('') +
      `--neutral-black:${config.neutral.black};` +
      `--neutral-dark:${config.neutral.dark};` +
      `--rank-low:${config.tones[config.ranges.resultRank.start][0]};` +
      `--rank-high:${config.tones[config.ranges.resultRank.end][0]};` + '}';
    document.head.append(style);
    const progress = (range, value) => {
      const t = clamp(value);
      return range.scaling === 'sqrt' ? Math.sqrt(t) :
        range.scaling === 'power' ? t ** range.exponent : t;
    };
    const toneScale = new Map(Object.entries(config.tones).flatMap(([name, colors]) =>
      colors.map(color => [color, config.ranges.diagramStrength.toneScale?.[name] ?? 1])));
    const scale = (range, value) => range.scaling === 'sqrt-after' ?
      Math.sqrt(range.start + (range.end - range.start) * clamp(value)) :
      range.start + (range.end - range.start) * progress(range, value);
    window.RamnetPalette = {...config, color: key => config.colors[key],
      tone: (name, shade = 'base') => config.tones[name][shade === 'ink' ? 1 : 0],
      neutral, neutralAnchors: config.neutral, withAlpha, mix, scale,
      weight: (value, color) => clamp(progress(config.ranges.diagramStrength, value) * (toneScale.get(color) ?? 1))};
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', config.colors.paper);
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) fetch(icon.href).then(response => response.text()).then(svg => {
      const fills = [config.colors.paper, mix(config.tones.sky[0], neutral(16), .3), config.colors.pageAccent];
      let index = 0;
      icon.href = 'data:image/svg+xml,' + encodeURIComponent(svg.replace(/#[0-9a-f]{6}/gi,
        color => fills[index++] || color));
    });
    document.documentElement.classList.add('palette-ready');
    return window.RamnetPalette;
  }).catch(error => {
    document.documentElement.classList.add('palette-ready');
    console.error(error);
    throw error;
  });
})();
