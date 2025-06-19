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

async function createCard(toy) {
  const card = document.createElement('div');
  card.className = 'webtoy-card';
  const title = document.createElement('h3');
  title.textContent = toy.title;
  const desc = document.createElement('p');
  desc.textContent = toy.description;
  card.appendChild(title);
  card.appendChild(desc);

  card.addEventListener('click', () => {
    if (toy.module.endsWith('.js') || toy.module.endsWith('.ts')) {
      loadToy(toy.slug);
    } else {
      window.location.href = toy.module;
    }
  });

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
  const filtered = allToys.filter(
    (t) =>
      t.title.toLowerCase().includes(search) ||
      t.description.toLowerCase().includes(search)
  );
  renderToys(filtered);
}

async function init() {
  const res = await fetch('assets/data/toys.json');
  allToys = await res.json();
  renderToys(allToys);

  const search = document.getElementById('search-bar');
  search?.addEventListener('input', (e) => filterToys(e.target.value));
  setupDarkModeToggle();
  await loadFromQuery();
}

init();
