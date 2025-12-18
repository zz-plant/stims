import toysData from './toys-data.js';

const MANIFEST_PATH = '/.vite/manifest.json';
const TOY_QUERY_PARAM = 'toy';
let manifestPromise;
let navigationInitialized = false;

function getDocument() {
  return typeof document === 'undefined' ? null : document;
}

function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

function getToyList() {
  const doc = getDocument();
  return doc?.getElementById('toy-list') ?? null;
}

function findActiveToyContainer() {
  const doc = getDocument();
  return doc?.getElementById('active-toy-container') ?? null;
}

function ensureActiveToyContainer() {
  const existing = findActiveToyContainer();
  if (existing) return existing;

  const doc = getDocument();
  if (!doc) return null;

  const container = doc.createElement('div');
  container.id = 'active-toy-container';
  container.className = 'active-toy-container is-hidden';
  doc.body.appendChild(container);
  return container;
}

function hideElement(element) {
  if (element && !element.classList.contains('is-hidden')) {
    element.classList.add('is-hidden');
  }
}

function showElement(element) {
  if (element && element.classList.contains('is-hidden')) {
    element.classList.remove('is-hidden');
  }
}

function clearActiveToyContainer() {
  const container = findActiveToyContainer();
  if (!container) return;

  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function showLibraryView() {
  showElement(getToyList());
  hideElement(findActiveToyContainer());
}

function showActiveToyView() {
  hideElement(getToyList());
  const container = ensureActiveToyContainer();
  ensureBackToLibraryControl(container);
  showElement(container);
}

function updateHistoryToLibraryView() {
  const win = getWindow();
  if (!win?.history) return;

  const url = new URL(win.location.href);
  if (!url.searchParams.has(TOY_QUERY_PARAM)) {
    return;
  }

  url.searchParams.delete(TOY_QUERY_PARAM);
  win.history.pushState({}, '', url);
}

function ensureBackToLibraryControl(container) {
  const doc = getDocument();
  if (!doc || !container) return null;

  let control = container.querySelector('[data-back-to-library]');
  if (control) return control;

  control = doc.createElement('button');
  control.type = 'button';
  control.className = 'home-link';
  control.textContent = 'Back to Library';
  control.setAttribute('data-back-to-library', 'true');
  control.addEventListener('click', () => {
    disposeActiveToy();
    showLibraryView();
    updateHistoryToLibraryView();
  });

  container.appendChild(control);
  return control;
}

function disposeActiveToy() {
  const activeToy = globalThis.__activeWebToy;

  if (activeToy?.dispose) {
    try {
      activeToy.dispose();
    } catch (error) {
      console.error('Error disposing existing toy', error);
    }
  }

  clearActiveToyContainer();

  const globalObject = globalThis;
  delete globalObject.__activeWebToy;
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

function pushToyState(slug) {
  const win = getWindow();
  if (!win?.history) return;

  const url = new URL(win.location.href);
  url.searchParams.set(TOY_QUERY_PARAM, slug);
  win.history.pushState({ toy: slug }, '', url);
}

export async function loadToy(slug, { pushState = false } = {}) {
  const toys = toysData;
  const toy = toys.find((t) => t.slug === slug);
  if (!toy) {
    console.error(`Toy not found: ${slug}`);
    showLibraryView();
    return;
  }

  if (toy.type === 'page') {
    disposeActiveToy();
    window.location.href = `./${slug}.html`;
  } else if (toy.type === 'module') {
    if (pushState) {
      pushToyState(slug);
    }

    disposeActiveToy();
    showActiveToyView();
    const moduleUrl = await resolveModulePath(toy.module);
    await import(moduleUrl);
  } else {
    disposeActiveToy();
    window.location.href = toy.module;
  }
}

export async function loadFromQuery() {
  const win = getWindow();
  if (!win) return;

  const params = new URLSearchParams(win.location.search);
  const slug = params.get(TOY_QUERY_PARAM);

  if (slug) {
    await loadToy(slug);
  } else {
    disposeActiveToy();
    showLibraryView();
  }
}

export function initNavigation() {
  const win = getWindow();
  if (!win || navigationInitialized) return;

  navigationInitialized = true;
  win.addEventListener('popstate', () => {
    loadFromQuery();
  });
}
