import type { ToyAudioRequest } from './core/toy-audio';
import { initAudioControls } from './ui/audio-controls.ts';
import { initNavigation as renderNav } from './ui/nav.ts';

type DocumentGetter = () => Document | null;

export interface ToyWindow extends Window {
  __stimsTheme?: {
    resolveThemePreference: () => 'light' | 'dark';
    applyTheme: (theme: 'light' | 'dark', persist?: boolean) => void;
  };
  startAudio?: (request?: ToyAudioRequest) => Promise<unknown>;
  startAudioFallback?: () => Promise<unknown>;
}

declare global {
  interface Window {
    __stimsTheme?: {
      resolveThemePreference: () => 'light' | 'dark';
      applyTheme: (theme: 'light' | 'dark', persist?: boolean) => void;
    };
    startAudio?: (request?: ToyAudioRequest) => Promise<unknown>;
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
  onBack?: () => void;
  onUsePreferredRenderer?: () => void;
  preferredRendererActionLabel?: string;
  onBrowseCompatible?: () => void;
  details?: string | null;
};

type ImportErrorOptions = {
  moduleUrl?: string;
  importError?: Error;
  onBack?: () => void;
  onBrowseCompatible?: () => void;
};

type RendererStatusState = {
  backend: 'webgl' | 'webgpu';
  fallbackReason?: string | null;
  actionLabel?: string;
  onAction?: () => void;
};

type AudioPromptCallbacks = {
  onRequestMicrophone: () => Promise<void>;
  onRequestDemoAudio: () => Promise<void>;
  onSuccess?: () => void;
  preferDemoAudio?: boolean;
  starterTips?: string[];
};

type ViewState = {
  mode: 'library' | 'toy';
  backHandler?: () => void;
  onNextToy?: () => void;
  onToggleHaptics?: (active: boolean) => void;
  hapticsActive?: boolean;
  hapticsSupported?: boolean;
  rendererStatus: RendererStatusState | null;
  activeToyMeta?: Toy;
  status: StatusConfig | null;
  audioPromptActive: boolean;
  audioPromptOptions?: AudioPromptCallbacks;
  activeStageSlot: 'primary' | 'secondary';
  pendingStageSlot: 'primary' | 'secondary' | null;
};

const TOY_CONTAINER_CLASS = 'active-toy-container';
const HIDDEN_CLASS = 'is-hidden';
const TOY_STAGE_CLASS = 'active-toy-stage';
const TRANSITION_DURATION_MS = 320;

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

function clearToyRootContent(container: HTMLElement | null) {
  if (!container) return;

  Array.from(container.children).forEach((child) => {
    if (
      child instanceof HTMLElement &&
      (child.dataset.preserve === 'toy-ui' ||
        child.classList.contains(TOY_STAGE_CLASS))
    ) {
      return;
    }

    child.remove();
  });

  container
    .querySelectorAll<HTMLElement>(`.${TOY_STAGE_CLASS}`)
    .forEach((stage) => clearContainerContent(stage));
}

function clearStageState(container: HTMLElement | null) {
  if (!container) return;

  container.removeAttribute('data-transition-state');
  container
    .querySelectorAll<HTMLElement>(`.${TOY_STAGE_CLASS}`)
    .forEach((stage) => stage.removeAttribute('data-stage-state'));
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
    return `${toy?.title ?? 'This toy'} could not start on this setup yet. Try another toy, or run through the dev server / production bundle so the TypeScript output is available.`;
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
  onNextToy,
  onToggleHaptics,
  hapticsActive,
  hapticsSupported,
}: {
  container: HTMLElement | null;
  toy?: Toy;
  onBack?: () => void;
  rendererStatus: RendererStatusState | null;
  onNextToy?: () => void;
  onToggleHaptics?: (active: boolean) => void;
  hapticsActive?: boolean;
  hapticsSupported?: boolean;
}) {
  if (!container) return null;
  let navContainer = container.querySelector<HTMLElement>('[data-toy-nav]');
  if (!navContainer) {
    navContainer = container.ownerDocument.createElement('div');
    navContainer.dataset.toyNav = 'true';
    navContainer.dataset.preserve = 'toy-ui';
    container.prepend(navContainer);
  }

  renderNav(navContainer as HTMLElement, {
    mode: 'toy',
    title: toy?.title,
    slug: toy?.slug,
    onBack,
    onNextToy,
    onToggleHaptics,
    hapticsActive,
    hapticsSupported,
    rendererStatus,
  });
  return container;
}

function buildAudioPrompt({
  container,
  options,
}: {
  container: HTMLElement | null;
  options: AudioPromptCallbacks;
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
    audioPromptOptions: undefined,
    activeStageSlot: 'primary',
    pendingStageSlot: null,
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

    let result: T | undefined;
    let ran = false;
    const runOnce = () => {
      if (ran) return result;
      ran = true;
      result = action();
      return result;
    };

    try {
      doc.startViewTransition(() => {
        runOnce();
      });
    } catch (_error) {
      return action();
    }

    if (!ran) {
      runOnce();
    }

    // biome-ignore lint/style/noNonNullAssertion: action always runs
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

  const ensureToyStage = (
    root: HTMLElement,
    slot: 'primary' | 'secondary' = state.activeStageSlot,
  ) => {
    let stage = root.querySelector<HTMLElement>(`[data-stage-slot="${slot}"]`);
    if (stage) return stage;

    stage = root.ownerDocument.createElement('div');
    stage.className = TOY_STAGE_CLASS;
    stage.dataset.stageSlot = slot;
    root.prepend(stage);
    return stage;
  };

  const getActiveToyStage = (root: HTMLElement) =>
    ensureToyStage(root, state.activeStageSlot);

  const getPendingToyStage = (root: HTMLElement) =>
    state.pendingStageSlot
      ? ensureToyStage(root, state.pendingStageSlot)
      : null;

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
      container.dataset.hasBlockingStatus = 'false';
      container.dataset.audioPromptActive = 'false';
      clearStageState(container);
      state.status = null;
      return { container, status: null };
    }

    hideElement(toyList);
    showElement(container);
    getActiveToyStage(container);

    buildToyNav({
      container,
      toy: state.activeToyMeta,
      onBack: state.backHandler,
      onNextToy: state.onNextToy,
      onToggleHaptics: state.onToggleHaptics,
      hapticsActive: state.hapticsActive,
      hapticsSupported: state.hapticsSupported,
      rendererStatus: state.rendererStatus,
    });

    const statusElement = renderStatusElement(doc, container, state.status);
    const hasBlockingStatus =
      state.status?.variant === 'error' || state.status?.variant === 'warning';
    container.dataset.hasBlockingStatus = hasBlockingStatus ? 'true' : 'false';
    container.dataset.audioPromptActive = state.audioPromptActive
      ? 'true'
      : 'false';

    if (state.audioPromptActive && state.audioPromptOptions) {
      const existingPrompt = container.querySelector('.control-panel');
      if (!(existingPrompt instanceof HTMLElement)) {
        buildAudioPrompt({ container, options: state.audioPromptOptions });
      }
    } else {
      container.querySelector('.control-panel')?.remove();
    }

    return { container, status: statusElement };
  };

  const showLibraryView = () => {
    state.mode = 'library';
    state.backHandler = undefined;
    state.onNextToy = undefined;
    state.onToggleHaptics = undefined;
    state.hapticsActive = false;
    state.hapticsSupported = false;
    state.rendererStatus = null;
    state.activeToyMeta = undefined;
    state.status = null;
    state.audioPromptActive = false;
    state.audioPromptOptions = undefined;
    state.activeStageSlot = 'primary';
    state.pendingStageSlot = null;
    runViewTransition(() => render({ clearContainer: true }));
  };

  const showActiveToyView = (
    onBack?: () => void,
    toy?: Toy,
    {
      onNextToy,
      onToggleHaptics,
      hapticsActive,
      hapticsSupported,
    }: {
      onNextToy?: () => void;
      onToggleHaptics?: (active: boolean) => void;
      hapticsActive?: boolean;
      hapticsSupported?: boolean;
    } = {},
  ) => {
    state.mode = 'toy';
    state.backHandler = onBack ?? state.backHandler;
    state.onNextToy = onNextToy ?? state.onNextToy;
    state.onToggleHaptics = onToggleHaptics ?? state.onToggleHaptics;
    state.hapticsActive = hapticsActive ?? state.hapticsActive;
    state.hapticsSupported = hapticsSupported ?? state.hapticsSupported;
    state.activeToyMeta = toy ?? state.activeToyMeta;
    const { container } = runViewTransition(() => render());
    return container ? getActiveToyStage(container) : null;
  };

  const showIncomingToyView = (
    onBack?: () => void,
    toy?: Toy,
    {
      onNextToy,
      onToggleHaptics,
      hapticsActive,
      hapticsSupported,
    }: {
      onNextToy?: () => void;
      onToggleHaptics?: (active: boolean) => void;
      hapticsActive?: boolean;
      hapticsSupported?: boolean;
    } = {},
  ) => {
    state.pendingStageSlot =
      state.activeStageSlot === 'primary' ? 'secondary' : 'primary';
    showActiveToyView(onBack, toy, {
      onNextToy,
      onToggleHaptics,
      hapticsActive,
      hapticsSupported,
    });
    const root = ensureActiveToyContainer();
    const incoming =
      root && state.pendingStageSlot
        ? ensureToyStage(root, state.pendingStageSlot)
        : null;
    if (!incoming) return null;

    clearContainerContent(incoming);
    incoming.dataset.stageState = 'incoming';
    root?.setAttribute('data-transition-state', 'loading');
    return incoming;
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

  const finishTransitionState = (root: HTMLElement | null) => {
    clearStageState(root);
    const pendingSlot = state.pendingStageSlot;
    if (!root || !pendingSlot) return;

    const outgoing = ensureToyStage(root, state.activeStageSlot);
    clearContainerContent(outgoing);
    outgoing.remove();
    state.activeStageSlot = pendingSlot;
    state.pendingStageSlot = null;
    ensureToyStage(root, state.activeStageSlot);
  };

  const completeToyTransition = async () => {
    const root = ensureActiveToyContainer();
    const pending = root ? getPendingToyStage(root) : null;
    if (!root || !pending) return;

    const current = ensureToyStage(root, state.activeStageSlot);
    root.setAttribute('data-transition-state', 'running');
    current.dataset.stageState = 'outgoing';
    pending.dataset.stageState = 'incoming';

    if (
      typeof window === 'undefined' ||
      typeof window.setTimeout !== 'function' ||
      prefersReducedMotion()
    ) {
      finishTransitionState(root);
      return;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, TRANSITION_DURATION_MS);
    });

    finishTransitionState(root);
  };

  const cancelToyTransition = () => {
    const root = ensureActiveToyContainer();
    const pending = root ? getPendingToyStage(root) : null;
    if (pending) {
      clearContainerContent(pending);
      pending.remove();
    }
    state.pendingStageSlot = null;
    clearStageState(root);
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
      title: "This toy couldn't start here yet",
      message: buildImportErrorMessage(toy, options),
      actionsClassName: 'active-toy-status__actions',
      actions: [
        {
          label: 'Try another toy',
          onClick: options.onBack,
          primary: true,
        },
        {
          label: 'Browse compatible toys',
          onClick: options.onBrowseCompatible,
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
    const hasPreferredRendererAction = Boolean(
      options.onUsePreferredRenderer && options.preferredRendererActionLabel,
    );

    state.status = {
      variant: 'error',
      title: 'WebGPU not available',
      message: `${
        toy?.title
          ? `${toy.title} needs WebGPU, which is not supported in this browser.`
          : 'This toy requires WebGPU, which is not supported in this browser.'
      } Try a browser with WebGPU support or choose another toy.${
        options.details ? ` (${options.details})` : ''
      }`,
      actionsClassName: 'active-toy-actions',
      actions: [
        ...(hasPreferredRendererAction
          ? [
              {
                label: options.preferredRendererActionLabel as string,
                onClick: options.onUsePreferredRenderer,
                primary: true,
              },
            ]
          : []),
        {
          label: 'Back to library',
          onClick: options.onBack,
          primary: !hasPreferredRendererAction,
        },
        {
          label: 'Browse compatible toys',
          onClick: options.onBrowseCompatible,
        },
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

  const setHapticsState = (active: boolean) => {
    state.hapticsActive = active;
    render();
  };

  return {
    showLibraryView,
    showActiveToyView,
    showIncomingToyView,
    showLoadingIndicator,
    showImportError,
    showCapabilityError,
    removeStatusElement,
    completeToyTransition,
    cancelToyTransition,
    clearActiveToyContainer: () =>
      (() => {
        const root = findActiveToyContainer();
        clearToyRootContent(root);
        state.pendingStageSlot = null;
        clearStageState(root);
      })(),
    ensureActiveToyContainer,
    setRendererStatus,
    setHapticsState,
    showUnavailableToy,
    showAudioPrompt: (
      active: boolean = true,
      callbacks?: AudioPromptCallbacks,
    ) => {
      state.audioPromptActive = active;
      state.audioPromptOptions =
        active && callbacks
          ? callbacks
          : active
            ? state.audioPromptOptions
            : undefined;
      if (active && callbacks) {
        findActiveToyContainer()?.querySelector('.control-panel')?.remove();
      }
      render();
    },
  };
}
