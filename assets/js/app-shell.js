import { loadToy, loadFromQuery } from './loader.js';

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
    if (toy.module.endsWith('.js')) {
      loadToy(toy.slug);
    } else {
      window.location.href = toy.module;
    }
  });

  return card;
}

async function init() {
  const res = await fetch('assets/data/toys.json');
  const toys = await res.json();
  const list = document.getElementById('toy-list');
  if (list) {
    toys.forEach((toy) => list.appendChild(createCard(toy)));
  }
  await loadFromQuery();
}

init();
