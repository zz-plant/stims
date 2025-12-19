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

function clearContainerContent(container: HTMLElement | null) {
  if (!container) return;

  Array.from(container.children).forEach((child) => {
    if (child instanceof HTMLElement && child.dataset.preserve === 'toy-ui') {
      return;
    }

    child.remove();
  });
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

function buildToyNav({
  container,
  doc,
  toy,
  onBack,
}: {
  container: HTMLElement | null;
  doc: Document | null;
  toy?: Toy;
  onBack?: () => void;
}) {
  if (!container || !doc) return null;

  let nav = container.querySelector('.active-toy-nav') as HTMLElement | null;
  if (!nav) {
    nav = doc.createElement('div');
    nav.className = 'active-toy-nav';
    nav.dataset.preserve = 'toy-ui';
    container.appendChild(nav);
  }

  nav.replaceChildren();

  const navContent = doc.createElement('div');
  navContent.className = 'active-toy-nav__content';

  const eyebrow = doc.createElement('p');
  eyebrow.className = 'active-toy-nav__eyebrow';
  eyebrow.textContent = 'Now playing';
  navContent.appendChild(eyebrow);

  const title = doc.createElement('p');
  title.className = 'active-toy-nav__title';
  title.textContent = toy?.title ?? 'Web toy';
  navContent.appendChild(title);

  const hint = doc.createElement('p');
  hint.className = 'active-toy-nav__hint';
  hint.textContent = 'Press Esc or use Back to return to the library.';
  navContent.appendChild(hint);

  if (toy?.slug) {
    const chip = doc.createElement('span');
    chip.className = 'active-toy-nav__pill';
    chip.textContent = toy.slug;
    navContent.appendChild(chip);
  }

  const actions = doc.createElement('div');
  actions.className = 'active-toy-nav__actions';

  const backControl = doc.createElement('button');
  backControl.type = 'button';
  backControl.className = 'toy-nav__back';
  backControl.setAttribute('data-back-to-library', 'true');
  backControl.innerHTML = '<span aria-hidden="true">←</span><span>Back to library</span>';
  backControl.addEventListener('click', () => onBack?.());
  actions.appendChild(backControl);

  nav.appendChild(navContent);
  nav.appendChild(actions);
  return nav;
}

export function createToyView({
  documentRef = () => (typeof document === 'undefined' ? null : document),
  listId = 'toy-list',
  containerId = 'active-toy-container',
}: { documentRef?: DocumentGetter; listId?: string; containerId?: string } = {}) {
  let backHandler: (() => void) | undefined;

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

  const showLibraryView = () => {
    backHandler = undefined;
    showElement(getToyList());
    hideElement(findActiveToyContainer());
  };

  const showActiveToyView = (onBack?: () => void, toy?: Toy) => {
    backHandler = onBack ?? backHandler;
    hideElement(getToyList());
    const container = ensureActiveToyContainer();
    buildToyNav({ container, doc: getDocument(), toy, onBack: backHandler });
    showElement(container);
    return container;
  };

  const showLoadingIndicator = (toyTitle?: string, toy?: Toy) => {
    const container = ensureActiveToyContainer();
    const doc = getDocument();
    if (!container || !doc) return null;

    buildToyNav({ container, doc, toy, onBack: backHandler });

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

    backHandler = options.onBack ?? backHandler;
    clearContainerContent(container);
    buildToyNav({ container, doc, toy, onBack: backHandler });

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

    backHandler = options.onBack ?? backHandler;
    clearContainerContent(container);
    buildToyNav({ container, doc, toy, onBack: backHandler });

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
    clearActiveToyContainer: () => clearContainerContent(findActiveToyContainer()),
    ensureActiveToyContainer,
  };
}
