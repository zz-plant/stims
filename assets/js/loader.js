import toysData from './toys-data.js';
import { ensureWebGL } from './utils/webgl-check.ts';

const TOY_QUERY_PARAM = 'toy';
let manifestPromise;
let navigationInitialized = false;

function getBaseUrl() {
  const win = getWindow();
  if (!win) return null;

  const href = win.location?.href;
  if (href) {
    return new URL(href);
  }

  const origin = win.location?.origin;
  if (origin) {
    return new URL(origin);
  }

  return null;
}

function hasWebGPUSupport() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

function getDocument() {
  return typeof document === 'undefined' ? null : document;
}

function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

function getManifestPath() {
  const baseUrl = getBaseUrl();
  return baseUrl ? new URL('./.vite/manifest.json', baseUrl).pathname : '/.vite/manifest.json';
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

function buildImportErrorMessage(toy, { moduleUrl, importError } = {}) {
  if (getWindow()?.location?.protocol === 'file:') {
    return 'This toy needs a local web server to compile its TypeScript modules. Run `npm run dev` (or `bun run dev`) and reload from `http://localhost:5173`.';
  }

  const message = importError?.message ?? '';
  if (typeof moduleUrl === 'string' && moduleUrl.endsWith('.ts')) {
    return `${toy?.title ?? 'This toy'} could not be compiled. Make sure you are running through the dev server or a production build so the TypeScript bundle is available.`;
  }

  if (message.toLowerCase().includes('mime')) {
    return `${toy?.title ?? 'This toy'} could not be loaded because the server is returning an unexpected file type. Try reloading from the dev server or production build.`;
  }

  return toy?.title
    ? `${toy.title} hit a snag while loading. Try again or return to the library.`
    : 'Something went wrong while loading this toy. Try again or return to the library.';
}

function showImportError(container, toy, { moduleUrl, importError } = {}) {
  clearActiveToyContainer();

  const status = createStatusElement(container, {
    type: 'error',
    title: 'Unable to load this toy',
    message: buildImportErrorMessage(toy, { moduleUrl, importError }),
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

function showCapabilityError(container, toy) {
  clearActiveToyContainer();

  const status = createStatusElement(container, {
    type: 'error',
    title: 'WebGPU not available',
    message: toy?.title
      ? `${toy.title} needs WebGPU, which is not supported in this browser.`
      : 'This toy requires WebGPU, which is not supported in this browser.',
  });

  if (!status) return;

  const actions = document.createElement('div');
  actions.className = 'active-toy-actions';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cta-button';
  back.textContent = 'Back to Library';
  back.addEventListener('click', () => {
    showLibraryView();
    updateHistoryToLibraryView();
  });

  actions.appendChild(back);
  status.querySelector('.active-toy-status__content')?.appendChild(actions);
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
    manifestPromise = fetch(getManifestPath())
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
      const baseUrl = getBaseUrl();
      return baseUrl
        ? new URL(compiledFile, baseUrl).pathname
        : new URL(compiledFile, window.location.origin).pathname;
    }
  }

  if (entry.startsWith('./')) {
    try {
      return new URL(entry, import.meta.url).pathname;
    } catch (error) {
      console.error('Error resolving module path from import.meta.url:', error);
    }
  }

  const baseUrl = getBaseUrl();
  if (baseUrl) {
    return new URL(entry, baseUrl).pathname;
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

  if (toy.type === 'module') {
    const supportsRendering = ensureWebGL({
      title: toy.title ? `${toy.title} needs graphics acceleration` : 'Graphics support required',
      description:
        'We could not detect WebGL or WebGPU support on this device. Try a modern browser with hardware acceleration enabled.',
    });

    if (!supportsRendering) {
      return;
    }

    if (pushState) {
      pushToyState(slug);
    }

    disposeActiveToy();
    showActiveToyView();

    if (toy.requiresWebGPU && !hasWebGPUSupport()) {
      const container = ensureActiveToyContainer();
      showCapabilityError(container, toy);
      return;
    }

    const container = ensureActiveToyContainer();
    showLoadingIndicator(container, toy.title || toy.slug);

    const moduleUrl = await resolveModulePath(toy.module);
    let importError = null;

    let moduleExports = null;

    await import(moduleUrl)
      .then((mod) => {
        moduleExports = mod;
      })
      .catch((error) => {
        importError = error;
      });

    if (importError) {
      console.error('Error loading toy module:', importError);
      showImportError(container, toy, { moduleUrl, importError });
      return;
    }

    const starter = moduleExports?.start ?? moduleExports?.default?.start;

    if (starter) {
      try {
        const active = await starter({ container, slug });
        if (active && !globalThis.__activeWebToy) {
          globalThis.__activeWebToy = active;
        }
      } catch (error) {
        console.error('Error starting toy module:', error);
        showImportError(container, toy);
        return;
      }
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
