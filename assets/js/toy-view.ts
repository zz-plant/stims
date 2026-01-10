type DocumentGetter = () => Document | null;

type Toy = {
  slug: string;
  title?: string;
};

type StatusVariant = 'loading' | 'error' | 'warning';

type StatusConfig = {
  variant: StatusVariant;
  title: string;
  message: string;
  actions?: StatusAction[];
  actionsClassName?: string;
};

type StatusAction = {
  label: string;
  onClick?: () => void;
  primary?: boolean;
  className?: string;
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

type RendererStatusState = {
  backend: 'webgl' | 'webgpu';
  fallbackReason?: string | null;
  shouldRetryWebGPU?: boolean;
  triedWebGPU?: boolean;
  onRetry?: () => void;
};

type ViewState = {
  mode: 'library' | 'toy';
  backHandler?: () => void;
  rendererStatus: RendererStatusState | null;
  activeToyMeta?: Toy;
  status: StatusConfig | null;
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

function renderStatusElement(
  doc: Document,
  container: HTMLElement,
  status: StatusConfig | null
) {
  const existing = container.querySelector('.active-toy-status');
  if (!status) {
    existing?.remove();
    return null;
  }

  existing?.remove();

  const statusElement = doc.createElement('div');
  const statusVariant =
    status.variant === 'error'
      ? 'is-error'
      : status.variant === 'warning'
        ? 'is-warning'
        : 'is-loading';
  statusElement.className = `active-toy-status ${statusVariant}`;
  statusElement.setAttribute(
    'role',
    status.variant === 'error' ? 'alert' : 'status'
  );
  statusElement.setAttribute(
    'aria-live',
    status.variant === 'error' ? 'assertive' : 'polite'
  );

  const glow = doc.createElement('div');
  glow.className = 'active-toy-status__glow';
  statusElement.appendChild(glow);

  const content = doc.createElement('div');
  content.className = 'active-toy-status__content';
  statusElement.appendChild(content);

  if (status.variant === 'loading') {
    const spinner = doc.createElement('div');
    spinner.className = 'toy-loading-spinner';
    content.appendChild(spinner);
  }

  const heading = doc.createElement('h2');
  heading.textContent = status.title;
  content.appendChild(heading);

  const body = doc.createElement('p');
  body.textContent = status.message;
  content.appendChild(body);

  if (status.actions?.length) {
    const actions = doc.createElement('div');
    actions.className = status.actionsClassName ?? 'active-toy-status__actions';

    status.actions.forEach((action) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      const baseClass = action.primary ? 'cta-button primary' : 'cta-button';
      button.className = action.className ?? baseClass;
      if (!action.className && !action.primary) {
        button.className = 'cta-button';
      }
      button.addEventListener('click', () => action.onClick?.());
      actions.appendChild(button);
    });

    content.appendChild(actions);
  }

  container.appendChild(statusElement);
  return statusElement;
}

function buildImportErrorMessage(
  toy: Toy | undefined,
  { moduleUrl, importError }: ImportErrorOptions = {}
) {
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    return 'This toy needs a local web server to compile its TypeScript modules. Run `bun run dev` and reload from `http://localhost:5173`.';
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
  rendererStatus,
}: {
  container: HTMLElement | null;
  doc: Document | null;
  toy?: Toy;
  onBack?: () => void;
  rendererStatus: RendererStatusState | null;
}) {
  if (!container || !doc) return null;

  let nav = container.querySelector('.active-toy-nav');
  if (!nav) {
    nav = doc.createElement('div');
    nav.className = 'active-toy-nav';
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

  if (rendererStatus) {
    const statusContainer = doc.createElement('div');
    statusContainer.className = 'renderer-status';

    const pill = doc.createElement('span');
    const fallback = rendererStatus.backend !== 'webgpu';
    pill.className = `renderer-pill ${fallback ? 'renderer-pill--fallback' : 'renderer-pill--success'}`;
    pill.textContent = fallback ? 'WebGL fallback' : 'WebGPU';
    pill.title =
      rendererStatus.fallbackReason ??
      (fallback
        ? 'WebGPU unavailable, using WebGL.'
        : 'WebGPU renderer active.');
    statusContainer.appendChild(pill);

    if (rendererStatus.fallbackReason) {
      const detail = doc.createElement('small');
      detail.className = 'renderer-pill__detail';
      detail.textContent = rendererStatus.fallbackReason;
      statusContainer.appendChild(detail);
    }

    if (rendererStatus.shouldRetryWebGPU && rendererStatus.onRetry) {
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'renderer-pill__retry';
      retry.textContent = rendererStatus.triedWebGPU
        ? 'Retry WebGPU'
        : 'Try WebGPU';
      retry.addEventListener('click', () => rendererStatus.onRetry?.());
      statusContainer.appendChild(retry);
    }

    actions.appendChild(statusContainer);
  }

  const backControl = doc.createElement('button');
  backControl.type = 'button';
  backControl.className = 'toy-nav__back';
  backControl.setAttribute('data-back-to-library', 'true');
  backControl.innerHTML =
    '<span aria-hidden="true">←</span><span>Back to library</span>';
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
}: {
  documentRef?: DocumentGetter;
  listId?: string;
  containerId?: string;
} = {}) {
  const state: ViewState = {
    mode: 'library',
    rendererStatus: null,
    status: null,
  };

  const getDocument = () => documentRef();
  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const runViewTransition = <T>(action: () => T) => {
    const doc = getDocument();
    if (
      !doc ||
      typeof doc.startViewTransition !== 'function' ||
      prefersReducedMotion()
    ) {
      return action();
    }

    let result: T;
    doc.startViewTransition(() => {
      result = action();
    });
    return result!;
  };

  const getToyList = () => getDocument()?.getElementById(listId) ?? null;

  const findActiveToyContainer = () =>
    getDocument()?.getElementById(containerId) ?? null;

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

  const render = ({
    clearContainer = false,
  }: { clearContainer?: boolean } = {}) => {
    const doc = getDocument();
    const toyList = getToyList();
    const container = ensureActiveToyContainer();

    if (!doc || !container) {
      return {
        container: null as HTMLElement | null,
        status: null as HTMLElement | null,
      };
    }

    if (clearContainer) {
      clearContainerContent(container);
    }

    if (state.mode === 'library') {
      showElement(toyList);
      hideElement(container);
      state.status = null;
      return { container, status: null };
    }

    hideElement(toyList);
    showElement(container);

    buildToyNav({
      container,
      doc,
      toy: state.activeToyMeta,
      onBack: state.backHandler,
      rendererStatus: state.rendererStatus,
    });

    const statusElement = renderStatusElement(doc, container, state.status);
    return { container, status: statusElement };
  };

  const showLibraryView = () => {
    state.mode = 'library';
    state.backHandler = undefined;
    state.rendererStatus = null;
    state.activeToyMeta = undefined;
    state.status = null;
    runViewTransition(() => render({ clearContainer: true }));
  };

  const showActiveToyView = (onBack?: () => void, toy?: Toy) => {
    state.mode = 'toy';
    state.backHandler = onBack ?? state.backHandler;
    state.activeToyMeta = toy ?? state.activeToyMeta;
    const { container } = runViewTransition(() => render());
    return container;
  };

  const showLoadingIndicator = (toyTitle?: string, toy?: Toy) => {
    state.mode = 'toy';
    state.activeToyMeta = toy ?? state.activeToyMeta;
    state.status = {
      variant: 'loading',
      title: 'Preparing toy...',
      message: toyTitle ? `${toyTitle} is loading.` : 'Loading toy...',
    };

    const { status } = runViewTransition(() => render());
    return status;
  };

  const removeStatusElement = () => {
    state.status = null;
    render();
  };

  const showImportError = (
    toy: Toy | undefined,
    options: ImportErrorOptions = {}
  ) => {
    state.mode = 'toy';
    state.backHandler = options.onBack ?? state.backHandler;
    state.activeToyMeta = toy ?? state.activeToyMeta;
    state.status = {
      variant: 'error',
      title: 'Unable to load this toy',
      message: buildImportErrorMessage(toy, options),
      actionsClassName: 'active-toy-status__actions',
      actions: [
        {
          label: 'Back to library',
          onClick: options.onBack,
          primary: true,
        },
      ],
    };

    const { status } = runViewTransition(() =>
      render({ clearContainer: true })
    );
    return status;
  };

  const showUnavailableToy = (
    slug: string,
    { onBack }: { onBack?: () => void } = {}
  ) => {
    state.mode = 'toy';
    state.backHandler = onBack ?? state.backHandler;
    state.activeToyMeta = undefined;
    state.status = {
      variant: 'error',
      title: 'Toy unavailable',
      message: `We couldn't find the stim "${slug}". It may have been moved or removed.`,
      actions: [
        {
          label: 'Back to library',
          onClick: onBack,
          primary: true,
        },
      ],
    };

    const { status } = runViewTransition(() =>
      render({ clearContainer: true })
    );
    return status;
  };

  const showCapabilityError = (
    toy: Toy | undefined,
    options: CapabilityOptions = {}
  ) => {
    state.mode = 'toy';
    state.backHandler = options.onBack ?? state.backHandler;
    state.activeToyMeta = toy ?? state.activeToyMeta;
    state.status = {
      variant: options.allowFallback ? 'warning' : 'error',
      title: options.allowFallback
        ? 'WebGPU is unavailable'
        : 'WebGPU not available',
      message: `${
        options.allowFallback
          ? toy?.title
            ? `${toy.title} works best with WebGPU. We can try a lighter WebGL version instead.`
            : 'This toy works best with WebGPU. We can try a lighter WebGL version instead.'
          : toy?.title
            ? `${toy.title} needs WebGPU, which is not supported in this browser.`
            : 'This toy requires WebGPU, which is not supported in this browser.'
      }${options.details ? ` (${options.details})` : ''}`,
      actionsClassName: 'active-toy-actions',
      actions: [
        {
          label: 'Back to Library',
          onClick: options.onBack,
        },
        ...(options.allowFallback && options.onContinue
          ? [
              {
                label: 'Continue with WebGL',
                onClick: options.onContinue,
                primary: true,
              },
            ]
          : []),
      ],
    };

    const { status } = runViewTransition(() =>
      render({ clearContainer: true })
    );
    return status;
  };

  const setRendererStatus = (status: RendererStatusState | null) => {
    state.rendererStatus = status;
    render();
  };

  return {
    showLibraryView,
    showActiveToyView,
    showLoadingIndicator,
    showImportError,
    showCapabilityError,
    removeStatusElement,
    clearActiveToyContainer: () =>
      clearContainerContent(findActiveToyContainer()),
    ensureActiveToyContainer,
    setRendererStatus,
    showUnavailableToy,
  };
}
