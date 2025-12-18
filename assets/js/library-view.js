const ns = 'http://www.w3.org/2000/svg';

function createSVGAnimation(slug) {
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${slug} holographic icon`);
  svg.classList.add('toy-icon');

  let hue = 0;
  for (const char of slug) {
    hue = (hue * 31 + char.charCodeAt(0)) % 360;
  }

  const primary = `hsl(${hue}, 80%, 60%)`;
  const accent = `hsl(${(hue + 140) % 360}, 90%, 65%)`;
  const highlight = `hsla(${(hue + 40) % 360}, 100%, 70%, 0.9)`;

  const defs = document.createElementNS(ns, 'defs');
  const glowGradient = document.createElementNS(ns, 'radialGradient');
  glowGradient.setAttribute('id', `glow-${slug}`);
  glowGradient.innerHTML = `
    <stop offset="0%" stop-color="${highlight}" stop-opacity="0.9" />
    <stop offset="60%" stop-color="${accent}" stop-opacity="0.35" />
    <stop offset="100%" stop-color="${primary}" stop-opacity="0" />
  `;
  defs.appendChild(glowGradient);

  const shimmerGradient = document.createElementNS(ns, 'linearGradient');
  shimmerGradient.setAttribute('id', `shimmer-${slug}`);
  shimmerGradient.setAttribute('x1', '0%');
  shimmerGradient.setAttribute('x2', '100%');
  shimmerGradient.setAttribute('y1', '0%');
  shimmerGradient.setAttribute('y2', '100%');
  shimmerGradient.innerHTML = `
    <stop offset="0%" stop-color="${primary}" />
    <stop offset="50%" stop-color="${accent}" />
    <stop offset="100%" stop-color="${highlight}" />
  `;
  defs.appendChild(shimmerGradient);
  svg.appendChild(defs);

  const halo = document.createElementNS(ns, 'circle');
  halo.setAttribute('cx', '60');
  halo.setAttribute('cy', '60');
  halo.setAttribute('r', '52');
  halo.setAttribute('fill', `url(#glow-${slug})`);
  svg.appendChild(halo);

  const ringGroup = document.createElementNS(ns, 'g');
  ringGroup.setAttribute('transform', 'translate(60 60)');

  const ring1 = document.createElementNS(ns, 'circle');
  ring1.setAttribute('cx', '0');
  ring1.setAttribute('cy', '0');
  ring1.setAttribute('r', '42');
  ring1.setAttribute('fill', 'none');
  ring1.setAttribute('stroke', `url(#shimmer-${slug})`);
  ring1.setAttribute('stroke-width', '3');
  ring1.setAttribute('stroke-dasharray', '6 12');
  ring1.setAttribute('stroke-linecap', 'round');
  const ring1Anim = document.createElementNS(ns, 'animate');
  ring1Anim.setAttribute('attributeName', 'stroke-dashoffset');
  ring1Anim.setAttribute('values', '0; -120');
  ring1Anim.setAttribute('dur', '6s');
  ring1Anim.setAttribute('repeatCount', 'indefinite');
  ring1.appendChild(ring1Anim);

  const ring2 = document.createElementNS(ns, 'circle');
  ring2.setAttribute('cx', '0');
  ring2.setAttribute('cy', '0');
  ring2.setAttribute('r', '26');
  ring2.setAttribute('fill', 'none');
  ring2.setAttribute('stroke', highlight);
  ring2.setAttribute('stroke-width', '2.5');
  ring2.setAttribute('stroke-dasharray', '4 10');
  ring2.setAttribute('stroke-linecap', 'round');
  const ring2Anim = document.createElementNS(ns, 'animate');
  ring2Anim.setAttribute('attributeName', 'stroke-dashoffset');
  ring2Anim.setAttribute('values', '60; -60');
  ring2Anim.setAttribute('dur', '4s');
  ring2Anim.setAttribute('repeatCount', 'indefinite');
  ring2.appendChild(ring2Anim);

  const ringRotate = document.createElementNS(ns, 'animateTransform');
  ringRotate.setAttribute('attributeName', 'transform');
  ringRotate.setAttribute('attributeType', 'XML');
  ringRotate.setAttribute('type', 'rotate');
  ringRotate.setAttribute('from', '0');
  ringRotate.setAttribute('to', '360');
  ringRotate.setAttribute('dur', '14s');
  ringRotate.setAttribute('repeatCount', 'indefinite');
  ringGroup.appendChild(ringRotate);
  ringGroup.appendChild(ring1);
  ringGroup.appendChild(ring2);
  svg.appendChild(ringGroup);

  const starburst = document.createElementNS(ns, 'g');
  starburst.setAttribute('transform', 'translate(60 60)');
  for (let i = 0; i < 12; i += 1) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '36');
    line.setAttribute('stroke', primary);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.7');
    line.setAttribute('transform', `rotate(${i * 30})`);
    const lineAnim = document.createElementNS(ns, 'animate');
    lineAnim.setAttribute('attributeName', 'stroke-dasharray');
    lineAnim.setAttribute('values', '0 36; 36 0; 0 36');
    lineAnim.setAttribute('dur', '5s');
    lineAnim.setAttribute('repeatCount', 'indefinite');
    line.appendChild(lineAnim);
    starburst.appendChild(line);
  }
  const starRotate = document.createElementNS(ns, 'animateTransform');
  starRotate.setAttribute('attributeName', 'transform');
  starRotate.setAttribute('type', 'rotate');
  starRotate.setAttribute('from', '0 60 60');
  starRotate.setAttribute('to', '-360 60 60');
  starRotate.setAttribute('dur', '10s');
  starRotate.setAttribute('repeatCount', 'indefinite');
  starburst.appendChild(starRotate);
  svg.appendChild(starburst);

  const diamondGroup = document.createElementNS(ns, 'g');
  diamondGroup.setAttribute('transform', 'translate(60 60)');
  for (const radius of [10, 20, 32]) {
    const diamond = document.createElementNS(ns, 'path');
    diamond.setAttribute('d', `M 0 -${radius} L ${radius} 0 L 0 ${radius} L -${radius} 0 Z`);
    diamond.setAttribute('fill', 'none');
    diamond.setAttribute('stroke', accent);
    diamond.setAttribute('stroke-width', '1.5');
    diamond.setAttribute('stroke-linejoin', 'round');
    diamond.setAttribute('stroke-dasharray', '3 6');
    const dashAnim = document.createElementNS(ns, 'animate');
    dashAnim.setAttribute('attributeName', 'stroke-dashoffset');
    dashAnim.setAttribute('values', '0; 30');
    dashAnim.setAttribute('dur', `${3 + radius / 10}s`);
    dashAnim.setAttribute('repeatCount', 'indefinite');
    diamond.appendChild(dashAnim);
    diamondGroup.appendChild(diamond);
  }
  const diamondRotate = document.createElementNS(ns, 'animateTransform');
  diamondRotate.setAttribute('attributeName', 'transform');
  diamondRotate.setAttribute('type', 'rotate');
  diamondRotate.setAttribute('from', '0 60 60');
  diamondRotate.setAttribute('to', '360 60 60');
  diamondRotate.setAttribute('dur', '12s');
  diamondRotate.setAttribute('repeatCount', 'indefinite');
  diamondGroup.appendChild(diamondRotate);
  svg.appendChild(diamondGroup);

  return svg;
}

function setupDarkModeToggle(themeToggleId = 'theme-toggle') {
  const btn = document.getElementById(themeToggleId);
  if (!btn) return;
  let dark = localStorage.getItem('theme') !== 'light';
  const updateButtonState = () => {
    btn.textContent = dark ? 'Light Mode' : 'Dark Mode';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute(
      'aria-label',
      dark ? 'Switch to light mode' : 'Switch to dark mode',
    );
  };

  updateButtonState();
  btn.addEventListener('click', () => {
    dark = !dark;
    const root = document.documentElement;
    if (dark) {
      root.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.add('light');
      localStorage.setItem('theme', 'light');
    }
    updateButtonState();
  });
}

export function createLibraryView({
  toys = [],
  loadToy,
  initNavigation,
  loadFromQuery,
  targetId = 'toy-list',
  searchInputId,
  cardElement = 'button',
  enableIcons = false,
  enableCapabilityBadges = false,
  enableKeyboardHandlers = false,
  enableDarkModeToggle = false,
  themeToggleId = 'theme-toggle',
} = {}) {
  let allToys = toys;

  const openToy = (toy) => {
    if (toy.type === 'module' && typeof loadToy === 'function') {
      loadToy(toy.slug, { pushState: true });
    } else if (toy.module) {
      window.location.href = toy.module;
    }
  };

  const createCard = (toy) => {
    const card = document.createElement(cardElement);
    card.className = 'webtoy-card';
    if (cardElement === 'button') {
      card.type = 'button';
    }

    if (enableIcons) {
      card.appendChild(createSVGAnimation(toy.slug));
    }

    const title = document.createElement('h3');
    title.textContent = toy.title;
    const desc = document.createElement('p');
    desc.textContent = toy.description;
    card.appendChild(title);
    card.appendChild(desc);

    if (enableCapabilityBadges && toy.requiresWebGPU) {
      const metaRow = document.createElement('div');
      metaRow.className = 'webtoy-card-meta';

      const badge = document.createElement('span');
      badge.className = 'capability-badge';
      badge.textContent = 'WebGPU';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-label', 'Requires WebGPU');

      const hasWebGPU = typeof navigator !== 'undefined' && Boolean(navigator.gpu);
      if (!hasWebGPU) {
        badge.classList.add('capability-badge--warning');
        badge.title = 'WebGPU not detected; falling back to WebGL if available.';

        const fallbackNote = document.createElement('span');
        fallbackNote.className = 'capability-note';
        fallbackNote.textContent = 'No WebGPU detected — will try WebGL fallback.';
        metaRow.appendChild(fallbackNote);
      } else {
        badge.title = 'Requires WebGPU to run.';
      }

      metaRow.appendChild(badge);
      if (metaRow.childElementCount > 0) {
        card.appendChild(metaRow);
      }
    }

    const handleOpenToy = () => openToy(toy);
    card.addEventListener('click', handleOpenToy);

    if (enableKeyboardHandlers) {
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenToy();
        }
      });
    }

    return card;
  };

  const renderToys = (listToRender) => {
    const list = document.getElementById(targetId);
    if (!list) return;
    list.innerHTML = '';
    listToRender.forEach((toy) => list.appendChild(createCard(toy)));
  };

  const filterToys = (query) => {
    const search = query.toLowerCase();
    const filtered = allToys.filter(
      (t) =>
        t.title.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search),
    );
    renderToys(filtered);
  };

  const initSearch = () => {
    if (!searchInputId) return;
    const search = document.getElementById(searchInputId);
    if (search) {
      search.addEventListener('input', (e) => filterToys(e.target.value));
    }
  };

  const init = async () => {
    renderToys(allToys);

    if (enableDarkModeToggle) {
      setupDarkModeToggle(themeToggleId);
    }

    initSearch();
    if (typeof initNavigation === 'function') {
      initNavigation();
    }
    if (typeof loadFromQuery === 'function') {
      await loadFromQuery();
    }
  };

  return {
    init,
    renderToys,
    filterToys,
  };
}
