export async function loadToy(slug) {
  const res = await fetch('assets/data/toys.json');
  const toys = await res.json();
  const toy = toys.find((t) => t.slug === slug);
  if (!toy) {
    console.error(`Toy not found: ${slug}`);
    return;
  }

  if (toy.module.includes('toy.html')) {
    window.location.href = `./${slug}.html`;
  } else if (toy.module.endsWith('.js')) {
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
