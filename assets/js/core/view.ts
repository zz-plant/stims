type DocumentLike = Document | null;
type WindowLike = Window & typeof globalThis;

type ToyInfo = {
  title?: string;
  slug?: string;
};

function toggleHidden(element: Element | null, hidden: boolean) {
  if (!element) return;

  if (hidden) {
    element.classList.add('is-hidden');
  } else {
    element.classList.remove('is-hidden');
  }
}

function buildImportErrorMessage(
  toy: ToyInfo | undefined,
  win: WindowLike | null,
  { moduleUrl, importError }: { moduleUrl?: string; importError?: Error } = {}
) {
  if (win?.location?.protocol === 'file:') {
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

export function createToyView({
  document: doc = typeof document !== 'undefined' ? document : null,
  window: win = typeof window !== 'undefined' ? window : null,
  host = doc?.body ?? null,
  toyList,
  onBackToLibrary,
}: {
  document?: DocumentLike;
  window?: WindowLike | null;
  host?: HTMLElement | null;
  toyList?: HTMLElement | null;
  onBackToLibrary?: () => void;
} = {}) {
  let activeContainer: HTMLElement | null = null;

  const getToyList = () => toyList ?? doc?.getElementById('toy-list') ?? null;

  const ensureActiveToyContainer = () => {
    if (activeContainer?.isConnected) return activeContainer;
    if (!doc || !host) return null;

    activeContainer = doc.createElement('div');
    activeContainer.id = 'active-toy-container';
    activeContainer.className = 'active-toy-container is-hidden';
    host.appendChild(activeContainer);

    return activeContainer;
  };

  const clearActiveToyContainer = () => {
    const container = ensureActiveToyContainer();
    if (!container) return;

    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  };

  const createStatusElement = (
    container: HTMLElement | null,
    { title, message, type }: { title: string; message: string; type: 'loading' | 'error' }
  ) => {
    if (!doc || !container) return null;

    const existing = container.querySelector('.active-toy-status');
    if (existing) {
      existing.remove();
    }

    const status = doc.createElement('div');
    status.className = `active-toy-status ${type === 'error' ? 'is-error' : 'is-loading'}`;

    const glow = doc.createElement('div');
    glow.className = 'active-toy-status__glow';
    status.appendChild(glow);

    const content = doc.createElement('div');
    content.className = 'active-toy-status__content';
    status.appendChild(content);

    if (type === 'loading') {
      const spinner = doc.createElement('div');
      spinner.className = 'toy-loading-spinner';
      content.appendChild(spinner);
    }

    const heading = doc.createElement('h2');
    heading.textContent = title;
    content.appendChild(heading);

    const body = doc.createElement('p');
    body.textContent = message;
    content.appendChild(body);

    container.appendChild(status);
    return status;
  };

  const showLoadingIndicator = (toyTitle?: string) => {
    const container = ensureActiveToyContainer();
    return createStatusElement(container, {
      type: 'loading',
      title: 'Preparing toy...',
      message: toyTitle ? `${toyTitle} is loading.` : 'Loading toy...',
    });
  };

  const removeStatusElement = () => {
    const container = ensureActiveToyContainer();
    const status = container?.querySelector('.active-toy-status');
    if (status) {
      status.remove();
    }
  };

  const ensureBackToLibraryControl = () => {
    const container = ensureActiveToyContainer();
    if (!doc || !container) return null;

    let control = container.querySelector<HTMLButtonElement>('[data-back-to-library]');
    if (control) return control;

    control = doc.createElement('button');
    control.type = 'button';
    control.className = 'home-link';
    control.textContent = 'Back to Library';
    control.setAttribute('data-back-to-library', 'true');
    control.addEventListener('click', () => {
      onBackToLibrary?.();
    });

    container.appendChild(control);
    return control;
  };

  const showLibraryView = () => {
    toggleHidden(getToyList(), false);
    toggleHidden(ensureActiveToyContainer(), true);
  };

  const showActiveToyView = () => {
    toggleHidden(getToyList(), true);
    const container = ensureActiveToyContainer();
    ensureBackToLibraryControl();
    toggleHidden(container, false);
    return container;
  };

  const showImportError = (
    toy: ToyInfo | undefined,
    { moduleUrl, importError }: { moduleUrl?: string; importError?: Error } = {}
  ) => {
    clearActiveToyContainer();
    const container = ensureActiveToyContainer();
    const status = createStatusElement(container, {
      type: 'error',
      title: 'Unable to load this toy',
      message: buildImportErrorMessage(toy, win, { moduleUrl, importError }),
    });

    if (!status || !doc) return;

    const actions = doc.createElement('div');
    actions.className = 'active-toy-status__actions';

    const retry = doc.createElement('button');
    retry.className = 'cta-button primary';
    retry.type = 'button';
    retry.textContent = 'Back to library';
    retry.addEventListener('click', () => {
      onBackToLibrary?.();
    });

    actions.appendChild(retry);
    status.querySelector('.active-toy-status__content')?.appendChild(actions);
  };

  const showCapabilityError = (toy?: ToyInfo) => {
    clearActiveToyContainer();
    const container = ensureActiveToyContainer();
    const status = createStatusElement(container, {
      type: 'error',
      title: 'WebGPU not available',
      message: toy?.title
        ? `${toy.title} needs WebGPU, which is not supported in this browser.`
        : 'This toy requires WebGPU, which is not supported in this browser.',
    });

    if (!status || !doc) return;

    const actions = doc.createElement('div');
    actions.className = 'active-toy-actions';

    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'cta-button';
    back.textContent = 'Back to Library';
    back.addEventListener('click', () => {
      onBackToLibrary?.();
    });

    actions.appendChild(back);
    status.querySelector('.active-toy-status__content')?.appendChild(actions);
  };

  return {
    ensureActiveToyContainer,
    ensureBackToLibraryControl,
    showLibraryView,
    showActiveToyView,
    showLoadingIndicator,
    removeStatusElement,
    showImportError,
    showCapabilityError,
    clearActiveToyContainer,
  };
}
