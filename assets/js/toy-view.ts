import { initNavigation as renderNav } from './ui/nav.ts';
import { initAudioControls } from './ui/audio-controls.ts';

type DocumentGetter = () => Document | null;

export interface ToyWindow extends Window {
  __stimsTheme?: {
    resolveThemePreference: () => 'light' | 'dark';
    applyTheme: (theme: 'light' | 'dark', persist?: boolean) => void;
  };
  startAudio?: (request: any) => Promise<unknown>;
  startAudioFallback?: () => Promise<unknown>;
}

declare global {
  interface Window {
    __stimsTheme?: {
      resolveThemePreference: () => 'light' | 'dark';
      applyTheme: (theme: 'light' | 'dark', persist?: boolean) => void;
    };
    startAudio?: (request: any) => Promise<unknown>;
    startAudioFallback?: () => Promise<unknown>;
  }
}

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
  audioPromptActive: boolean;
};

const TOY_CONTAINER_CLASS = 'active-toy-container';
const HIDDEN_CLASS = 'is-hidden';

function hideElement(element: HTMLElement | null) {
  if (element && !element.classList.contains(HIDDEN_CLASS)) {
    element.classList.add(HIDDEN_CLASS);
  }
}

function showElement(element: HTMLElement | null) {
  if (element?.classList.contains(HIDDEN_CLASS)) {
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
  status: StatusConfig | null,
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
    status.variant === 'error' ? 'alert' : 'status',
  );
  statusElement.setAttribute(
    'aria-live',
    status.variant === 'error' ? 'assertive' : 'polite',
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
  { moduleUrl, importError }: ImportErrorOptions = {},
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
  toy,
  onBack,
  rendererStatus,
}: {
  container: HTMLElement | null;
  toy?: Toy;
  onBack?: () => void;
  rendererStatus: RendererStatusState | null;
}) {
  if (!container) return null;
  renderNav(container, {
    mode: 'toy',
    title: toy?.title,
    slug: toy?.slug,
    onBack,
    rendererStatus,
  });
  return container;
}

function buildAudioPrompt({
  container,
  options,
}: {
  container: HTMLElement | null;
  options: {
    onRequestMicrophone: () => Promise<void>;
    onRequestDemoAudio: () => Promise<void>;
    onSuccess?: () => void;
  };
}) {
  if (!container) return null;

  let prompt = container.querySelector('.control-panel');
  if (prompt) return prompt;

  prompt = container.ownerDocument.createElement('div');
  prompt.className = 'control-panel control-panel--floating';
  container.appendChild(prompt);

  initAudioControls(prompt as HTMLElement, options);
  return prompt;
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
    audioPromptActive: false,
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
    // biome-ignore lint/style/noNonNullAssertion: callback runs synchronously
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
  }: {
    clearContainer?: boolean;
  } = {}) => {
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
      toy: state.activeToyMeta,
      onBack: state.backHandler,
      rendererStatus: state.rendererStatus,
    });

    const statusElement = renderStatusElement(doc, container, state.status);

    if (state.audioPromptActive) {
      // Note: Audio callbacks are handled in loader.ts which calls showAudioPrompt(active, callbacks)
      // For now, toy-view state doesn't hold callbacks, so we'll need to adapt loader.ts or pass them here
      // buildAudioPrompt({ container, options: ... });
    } else {
      container.querySelector('.control-panel')?.remove();
    }

    return { container, status: statusElement };
  };

  const showLibraryView = () => {
    state.mode = 'library';
    state.backHandler = undefined;
    state.rendererStatus = null;
    state.activeToyMeta = undefined;
    state.status = null;
    state.audioPromptActive = false;
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
    options: ImportErrorOptions = {},
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
      render({ clearContainer: true }),
    );
    return status;
  };

  const showUnavailableToy = (
    slug: string,
    { onBack }: { onBack?: () => void } = {},
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
      render({ clearContainer: true }),
    );
    return status;
  };

  const showCapabilityError = (
    toy: Toy | undefined,
    options: CapabilityOptions = {},
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
      render({ clearContainer: true }),
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
    showAudioPrompt: (active: boolean = true, callbacks?: any) => {
      state.audioPromptActive = active;
      if (active && callbacks) {
        const container = findActiveToyContainer();
        buildAudioPrompt({ container, options: callbacks });
      } else {
        render();
      }
    },
  };
}
