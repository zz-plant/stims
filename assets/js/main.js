import { loadToy, loadFromQuery } from './loader.js';

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
  if (toy.module.endsWith('.js') || toy.module.endsWith('.ts')) {
    loadToy(toy.slug);
  } else {
    window.location.href = toy.module;
  }
}

async function init() {
  const res = await fetch('assets/data/toys.json');
  allToys = await res.json();
  renderToys(allToys);

  setupDarkModeToggle();
  await loadFromQuery();
}

init();
