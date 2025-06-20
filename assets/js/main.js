import { loadToy, loadFromQuery } from './loader.js';

let allToys = [];
let sortedToys = [];

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

function createCard(toy) {
  const card = document.createElement('div');
  card.className = 'webtoy-card';
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

function filterToys(query) {
  const search = query.toLowerCase();
  const filtered = sortedToys.filter(
    (t) =>
      t.title.toLowerCase().includes(search) ||
      t.description.toLowerCase().includes(search)
  );
  renderToys(filtered);
}

function applySort(mode) {
  if (mode === 'alpha') {
    sortedToys = [...allToys].sort((a, b) => a.title.localeCompare(b.title));
  } else if (mode === 'random') {
    sortedToys = [...allToys];
    for (let i = sortedToys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sortedToys[i], sortedToys[j]] = [sortedToys[j], sortedToys[i]];
    }
  } else {
    sortedToys = [...allToys];
  }
  renderToys(sortedToys);
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
  sortedToys = [...allToys];
  renderToys(sortedToys);

  const search = document.getElementById('search-bar');
  search?.addEventListener('input', (e) => filterToys(e.target.value));

  const sort = document.getElementById('sort-select');
  sort?.addEventListener('change', (e) => applySort(e.target.value));

  const randomBtn = document.getElementById('random-btn');
  randomBtn?.addEventListener('click', () => {
    const randomToy = allToys[Math.floor(Math.random() * allToys.length)];
    if (randomToy) openToy(randomToy);
  });

  setupDarkModeToggle();
  await loadFromQuery();
}

init();
