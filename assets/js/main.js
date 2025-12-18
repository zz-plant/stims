import { loadToy, loadFromQuery } from './loader.js';
import toysData from './toys-data.js';

let allToys = [];

function setupDarkModeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  let dark = localStorage.getItem('theme') !== 'light';
  btn.textContent = dark ? 'Light Mode' : 'Dark Mode';
  btn.addEventListener('click', () => {
    dark = !dark;
    const root = document.documentElement;
    if (dark) {
      root.classList.remove('light');
      localStorage.setItem('theme', 'dark');
      btn.textContent = 'Light Mode';
    } else {
      root.classList.add('light');
      localStorage.setItem('theme', 'light');
      btn.textContent = 'Dark Mode';
    }
  });
}

function colorFromSlug(slug) {
  let hash = 0;
  for (const char of slug) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${hash}, 70%, 60%)`;
}

function createSVGAnimation(slug) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.classList.add('toy-icon');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '50');
  circle.setAttribute('cy', '50');
  circle.setAttribute('r', '30');
  circle.setAttribute('fill', colorFromSlug(slug));
  const anim = document.createElementNS(ns, 'animate');
  anim.setAttribute('attributeName', 'r');
  anim.setAttribute('values', '20;40;20');
  anim.setAttribute('dur', '3s');
  anim.setAttribute('repeatCount', 'indefinite');
  circle.appendChild(anim);
  svg.appendChild(circle);
  return svg;
}

function createCard(toy) {
  const card = document.createElement('div');
  card.className = 'webtoy-card';
  card.appendChild(createSVGAnimation(toy.slug));
  const title = document.createElement('h3');
  title.textContent = toy.title;
  const desc = document.createElement('p');
  desc.textContent = toy.description;
  card.appendChild(title);
  card.appendChild(desc);

  const metaRow = document.createElement('div');
  metaRow.className = 'webtoy-card-meta';

  if (toy.requiresWebGPU) {
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
  }

  if (metaRow.childElementCount > 0) {
    card.appendChild(metaRow);
  }

  card.addEventListener('click', () => openToy(toy));

  return card;
}

function renderToys(toys) {
  const list = document.getElementById('toy-list');
  if (!list) return;
  list.innerHTML = '';
  toys.forEach((toy) => list.appendChild(createCard(toy)));
}

function openToy(toy) {
  if (toy.type === 'module') {
    loadToy(toy.slug);
  } else {
    window.location.href = toy.module;
  }
}

async function init() {
  allToys = toysData;
  renderToys(allToys);

  setupDarkModeToggle();
  await loadFromQuery();
}

init();
