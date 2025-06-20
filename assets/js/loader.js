import toysData from './toys-data.js';

export async function loadToy(slug) {
  const toys = toysData;
  const toy = toys.find((t) => t.slug === slug);
  if (!toy) {
    console.error(`Toy not found: ${slug}`);
    return;
  }

  if (toy.module.includes('toy.html')) {
    window.location.href = `./${slug}.html`;
  } else if (toy.module.endsWith('.js') || toy.module.endsWith('.ts')) {
    document.getElementById('toy-list')?.remove();
    await import(toy.module);
  } else {
    window.location.href = toy.module;
  }
}

export async function loadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('toy');
  if (slug) {
    await loadToy(slug);
  }
}
