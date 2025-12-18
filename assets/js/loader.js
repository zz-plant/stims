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

function createStatusElement(container, { title, message, type }) {
  if (!container) return null;

  const existing = container.querySelector('.active-toy-status');
  if (existing) {
    existing.remove();
  }

  const status = document.createElement('div');
  status.className = `active-toy-status ${type === 'error' ? 'is-error' : 'is-loading'}`;

  const glow = document.createElement('div');
  glow.className = 'active-toy-status__glow';
  status.appendChild(glow);

  const content = document.createElement('div');
  content.className = 'active-toy-status__content';
  status.appendChild(content);

  if (type === 'loading') {
    const spinner = document.createElement('div');
    spinner.className = 'toy-loading-spinner';
    content.appendChild(spinner);
  }

  const heading = document.createElement('h2');
  heading.textContent = title;
  content.appendChild(heading);

  const body = document.createElement('p');
  body.textContent = message;
  content.appendChild(body);

  container.appendChild(status);
  return status;
}

function showLoadingIndicator(container, toyTitle) {
  return createStatusElement(container, {
    type: 'loading',
    title: 'Preparing toy...',
    message: toyTitle ? `${toyTitle} is loading.` : 'Loading toy...'
  });
}

function removeStatusElement(container) {
  const status = container?.querySelector('.active-toy-status');
  if (status) {
    status.remove();
  }
}

function showImportError(container, toy) {
  clearActiveToyContainer();

  const status = createStatusElement(container, {
    type: 'error',
    title: 'Unable to load this toy',
    message:
      toy?.title
        ? `${toy.title} hit a snag while loading. Try again or return to the library.`
        : 'Something went wrong while loading this toy. Try again or return to the library.'
  });

  if (!status) return;

  const actions = document.createElement('div');
  actions.className = 'active-toy-status__actions';

  const retry = document.createElement('button');
  retry.className = 'cta-button primary';
  retry.type = 'button';
  retry.textContent = 'Back to library';
  retry.addEventListener('click', () => {
    disposeActiveToy();
    const win = getWindow();
    if (win?.history) {
      const url = new URL(win.location.href);
      url.searchParams.delete(TOY_QUERY_PARAM);
      win.history.pushState({}, '', url);
    }
    showLibraryView();
  });

  actions.appendChild(retry);
  status.querySelector('.active-toy-status__content')?.appendChild(actions);
}

function showLibraryView() {
  showElement(getToyList());
  hideElement(findActiveToyContainer());
}

function showActiveToyView() {
  hideElement(getToyList());
  showElement(ensureActiveToyContainer());
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
    const container = ensureActiveToyContainer();
    showLoadingIndicator(container, toy.title || toy.slug);

    const moduleUrl = await resolveModulePath(toy.module);
    let importError = null;

    await import(moduleUrl).catch((error) => {
      importError = error;
    });

    if (importError) {
      console.error('Error loading toy module:', importError);
      showImportError(container, toy);
      return;
    }

    removeStatusElement(container);
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
