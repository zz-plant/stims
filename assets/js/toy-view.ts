type DocumentGetter = () => Document | null;

type Toy = {
  slug: string;
  title?: string;
};

type StatusConfig = {
  type: 'loading' | 'error' | 'warning';
  title: string;
  message: string;
};

type CapabilityOptions = {
  allowFallback?: boolean;
  onBack?: () => void;
  onContinue?: () => void;
  details?: string | null;
};

type RendererStatus = {
  backendLabel: string;
  description: string;
  fallbackDetail?: string | null;
  shouldRetryWebGPU?: boolean;
};

type ImportErrorOptions = {
  moduleUrl?: string;
  importError?: Error;
  onBack?: () => void;
};

const TOY_CONTAINER_CLASS = 'active-toy-container';
const HIDDEN_CLASS = 'is-hidden';

function hideElement(element: HTMLElement | null) {
  if (element && !element.classList.contains(HIDDEN_CLASS)) {
    element.classList.add(HIDDEN_CLASS);
  }
}

function showElement(element: HTMLElement | null) {
  if (element && element.classList.contains(HIDDEN_CLASS)) {
    element.classList.remove(HIDDEN_CLASS);
  }
}

function clearElement(element: HTMLElement | null) {
  if (!element) return;

  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function buildStatusElement(doc: Document, container: HTMLElement, { type, title, message }: StatusConfig) {
  const existing = container.querySelector('.active-toy-status');
  if (existing) {
    existing.remove();
  }

  const status = doc.createElement('div');
  const statusVariant = type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : 'is-loading';
  status.className = `active-toy-status ${statusVariant}`;

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
}

function buildImportErrorMessage(toy: Toy | undefined, { moduleUrl, importError }: ImportErrorOptions = {}) {
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
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
  documentRef = () => (typeof document === 'undefined' ? null : document),
  listId = 'toy-list',
  containerId = 'active-toy-container',
}: { documentRef?: DocumentGetter; listId?: string; containerId?: string } = {}) {
  const getDocument = () => documentRef();

  const getToyList = () => getDocument()?.getElementById(listId) ?? null;

  const findActiveToyContainer = () => getDocument()?.getElementById(containerId) ?? null;

  const ensureActiveToyContainer = () => {
    const doc = getDocument();
    if (!doc) return null;

    const existing = findActiveToyContainer();
    if (existing) return existing;

    const container = doc.createElement('div');
    container.id = containerId;
    container.className = `${TOY_CONTAINER_CLASS} ${HIDDEN_CLASS}`;
    doc.body.appendChild(container);
    return container;
  };

  let rendererStatusElement: HTMLElement | null = null;

  const ensureBackControl = (container: HTMLElement | null, onBack?: () => void) => {
    const doc = getDocument();
    if (!doc || !container) return null;

    let control = container.querySelector('[data-back-to-library]') as HTMLButtonElement | null;
    if (control) return control;

    control = doc.createElement('button');
    control.type = 'button';
    control.className = 'home-link';
    control.textContent = 'Back to Library';
    control.setAttribute('data-back-to-library', 'true');
    control.addEventListener('click', () => onBack?.());

    container.appendChild(control);
    return control;
  };

  const renderRendererStatus = (
    status: RendererStatus | null,
    { onRetry }: { onRetry?: () => void } = {}
  ) => {
    const doc = getDocument();
    const container = ensureActiveToyContainer();
    if (!doc || !container) return null;

    if (!rendererStatusElement) {
      rendererStatusElement = doc.createElement('div');
      rendererStatusElement.className = 'renderer-status';
      container.appendChild(rendererStatusElement);
    }

    rendererStatusElement.replaceChildren();

    if (!status) return rendererStatusElement;

    const pill = doc.createElement('div');
    pill.className = 'renderer-status__pill';
    pill.dataset.backend = status.backendLabel.toLowerCase();

    const label = doc.createElement('span');
    label.className = 'renderer-status__label';
    label.textContent = 'Renderer';

    const backend = doc.createElement('strong');
    backend.textContent = status.backendLabel;
    pill.append(label, backend);

    const detail = doc.createElement('div');
    detail.className = 'renderer-status__detail';
    detail.textContent = status.fallbackDetail ?? status.description;

    rendererStatusElement.append(pill, detail);

    if (status.shouldRetryWebGPU && onRetry) {
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'renderer-status__retry';
      retry.textContent = 'Retry WebGPU';
      retry.addEventListener('click', () => onRetry());
      rendererStatusElement.appendChild(retry);
    }

    return rendererStatusElement;
  };

  const showLibraryView = () => {
    showElement(getToyList());
    hideElement(findActiveToyContainer());
  };

  const showActiveToyView = (onBack?: () => void) => {
    hideElement(getToyList());
    const container = ensureActiveToyContainer();
    ensureBackControl(container, onBack);
    showElement(container);
    return container;
  };

  const showLoadingIndicator = (toyTitle?: string) => {
    const container = ensureActiveToyContainer();
    const doc = getDocument();
    if (!container || !doc) return null;

    return buildStatusElement(doc, container, {
      type: 'loading',
      title: 'Preparing toy...',
      message: toyTitle ? `${toyTitle} is loading.` : 'Loading toy...',
    });
  };

  const removeStatusElement = () => {
    const container = findActiveToyContainer();
    container?.querySelector('.active-toy-status')?.remove();
  };

  const showImportError = (toy: Toy | undefined, options: ImportErrorOptions = {}) => {
    const container = ensureActiveToyContainer();
    const doc = getDocument();
    if (!container || !doc) return null;

    clearElement(container);
    const status = buildStatusElement(doc, container, {
      type: 'error',
      title: 'Unable to load this toy',
      message: buildImportErrorMessage(toy, options),
    });

    if (!status) return null;

    const actions = doc.createElement('div');
    actions.className = 'active-toy-status__actions';

    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'cta-button primary';
    back.textContent = 'Back to library';
    back.addEventListener('click', () => options.onBack?.());
    actions.appendChild(back);

    status.querySelector('.active-toy-status__content')?.appendChild(actions);
    return status;
  };

  const showCapabilityError = (toy: Toy | undefined, options: CapabilityOptions = {}) => {
    const container = ensureActiveToyContainer();
    const doc = getDocument();
    if (!container || !doc) return null;

    clearElement(container);

    const status = buildStatusElement(doc, container, {
      type: options.allowFallback ? 'warning' : 'error',
      title: options.allowFallback ? 'WebGPU is unavailable' : 'WebGPU not available',
      message: `${
        options.allowFallback
        ? toy?.title
          ? `${toy.title} works best with WebGPU. We can try a lighter WebGL version instead.`
          : 'This toy works best with WebGPU. We can try a lighter WebGL version instead.'
        : toy?.title
          ? `${toy.title} needs WebGPU, which is not supported in this browser.`
          : 'This toy requires WebGPU, which is not supported in this browser.'
      }${options.details ? ` (${options.details})` : ''}`,
    });

    if (!status) return null;

    const actions = doc.createElement('div');
    actions.className = 'active-toy-actions';

    const back = doc.createElement('button');
    back.type = 'button';
    back.className = 'cta-button';
    back.textContent = 'Back to Library';
    back.addEventListener('click', () => options.onBack?.());
    actions.appendChild(back);

    if (options.allowFallback && options.onContinue) {
      const continueButton = doc.createElement('button');
      continueButton.type = 'button';
      continueButton.className = 'cta-button primary';
      continueButton.textContent = 'Continue with WebGL';
      continueButton.addEventListener('click', () => options.onContinue?.());
      actions.appendChild(continueButton);
    }

    status.querySelector('.active-toy-status__content')?.appendChild(actions);
    return status;
  };

  return {
    showLibraryView,
    showActiveToyView,
    showLoadingIndicator,
    showImportError,
    showCapabilityError,
    removeStatusElement,
    clearActiveToyContainer: () => {
      clearElement(findActiveToyContainer());
      rendererStatusElement = null;
    },
    ensureActiveToyContainer,
    updateRendererStatus: (
      status: RendererStatus | null,
      options: { onRetry?: () => void } = {}
    ) => renderRendererStatus(status, options),
  };
}
