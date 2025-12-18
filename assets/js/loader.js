import toysData from './toys-data.js';

const MANIFEST_PATH = '/.vite/manifest.json';
let manifestPromise;

function disposeActiveToy() {
  const activeToy = globalThis.__activeWebToy;

  if (activeToy?.dispose) {
    try {
      activeToy.dispose();
    } catch (error) {
      console.error('Error disposing existing toy', error);
    }
  }

  delete globalThis.__activeWebToy;
}

async function fetchManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_PATH)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

export async function resolveModulePath(entry) {
  const manifest = await fetchManifest();
  const manifestEntry = manifest?.[entry];

  if (manifestEntry) {
    const compiledFile = manifestEntry.file || manifestEntry.url;
    if (compiledFile) {
      return new URL(compiledFile, window.location.origin).pathname;
    }
  }

  return entry.startsWith('/') || entry.startsWith('.') ? entry : `/${entry}`;
}

export async function loadToy(slug) {
  const toys = toysData;
  const toy = toys.find((t) => t.slug === slug);
  if (!toy) {
    console.error(`Toy not found: ${slug}`);
    return;
  }

  if (toy.type === 'page') {
    disposeActiveToy();
    window.location.href = `./${slug}.html`;
  } else if (toy.type === 'module') {
    disposeActiveToy();
    document.getElementById('toy-list')?.remove();
    const moduleUrl = await resolveModulePath(toy.module);
    await import(moduleUrl);
  } else {
    disposeActiveToy();
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
