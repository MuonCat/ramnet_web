(() => {
  'use strict';
  const visual = document.querySelector('.hero-visual');
  const cells = [...visual.querySelectorAll('.slot')];
  const routes = [...visual.querySelectorAll('.route')];
  const routeGroup = visual.querySelector('.hero-routes');
  const mobile = matchMedia('(max-width: 760px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  let selected = [], elapsed = 0, previous = null, frame = null, visible = false;

  function chooseSlots() {
    const previousSelection = selected;
    previousSelection.forEach(cell => { cell.classList.remove('selected'); cell.style.removeProperty('--activity'); });
    const available = cells.filter(cell => !previousSelection.includes(cell));
    selected = routes.map(route => {
      const cell = available.splice(Math.floor(Math.random() * available.length), 1)[0];
      cell.classList.add('selected');
      const x = +cell.getAttribute('x') + 8.5, y = +cell.getAttribute('y') + 8.5;
      route.setAttribute('d', `M235 327 C235 298 ${x} 298 ${x} ${y}`);
      return cell;
    });
  }

  function render() {
    const reading = elapsed >= 3.2;
    const phase = elapsed - (reading ? 3.2 : 0);
    const fade = 1 - ease((phase - 2) / .8);
    const brightness = ease((phase - (reading ? 0 : .55)) / (reading ? .55 : .65)) * fade;
    const transferStart = reading ? .7 : 0;
    routeGroup.style.opacity = String(ease((phase - transferStart) / .35) * fade * .85);
    selected.forEach(cell => cell.style.setProperty('--activity', `${brightness * 100}%`));
    routes.forEach(route => {
      route.style.strokeDashoffset = String((reading ? 1 : -1) * Math.max(0, phase - transferStart) * 30);
    });
  }

  function animate(now) {
    frame = null;
    if (previous !== null) elapsed += Math.min((now - previous) / 1000, .1);
    previous = now;
    if (elapsed >= 6.4) { elapsed %= 6.4; chooseSlots(); }
    render();
    frame = requestAnimationFrame(animate);
  }

  function sync() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previous = null;
    if (reducedMotion.matches) { elapsed = 1.5; render(); }
    if (visible && !mobile.matches && !reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(animate);
  }

  chooseSlots();
  render();
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(visual);
  mobile.addEventListener('change', sync);
  reducedMotion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
})();
