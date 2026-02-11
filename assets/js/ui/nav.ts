import {
  BREAKPOINTS,
  getMediaQueryList,
  isBelowBreakpoint,
  maxWidthQuery,
} from '../utils/breakpoints';
import { isMobileDevice } from '../utils/device-detect';
import {
  exitToyPictureInPicture,
  getToyPictureInPictureVideo,
  isPictureInPictureSupported,
  isToyPictureInPictureActive,
  requestToyPictureInPicture,
} from '../utils/picture-in-picture';

export interface NavOptions {
  mode: 'library' | 'toy';
  title?: string;
  slug?: string;
  onBack?: () => void;
  onShare?: () => void;
  onNextToy?: () => void | Promise<void>;
  onToggleFlow?: (active: boolean) => void;
  flowActive?: boolean;
  rendererStatus?: {
    backend: 'webgl' | 'webgpu';
    fallbackReason?: string | null;
    shouldRetryWebGPU?: boolean;
    triedWebGPU?: boolean;
    onRetry?: () => void;
  } | null;
}

type ToyNavContainer = HTMLElement & {
  __toyNavOffsetCleanup?: () => void;
};

const TOY_MICRO_CHALLENGES = [
  'Tap around the scene and find your favorite rhythm pocket.',
  'Try both microphone and demo audio, then compare the mood shift.',
  'Use Flow mode for one cycle and see which toy surprises you most.',
  'Push intensity up, then dial it back to find your sweet spot.',
  'Switch to picture-in-picture and keep the visuals ambient while multitasking.',
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match;
    }
  });
}

export function initNavigation(container: HTMLElement, options: NavOptions) {
  const doc = container.ownerDocument;

  if (options.mode === 'library') {
    renderLibraryNav(container, doc);
  } else {
    renderToyNav(container, doc, options);
  }

  setupThemeToggle(container);
}

function renderLibraryNav(container: HTMLElement, _doc: Document) {
  const toyContainer = container as ToyNavContainer;
  toyContainer.__toyNavOffsetCleanup?.();
  toyContainer.__toyNavOffsetCleanup = undefined;
  container.ownerDocument.documentElement.style.removeProperty(
    '--toy-nav-floating-offset',
  );
  container.ownerDocument.documentElement.removeAttribute(
    'data-toy-controls-expanded',
  );

  container.innerHTML = `
    <nav class="top-nav" data-top-nav aria-label="Primary" data-nav-expanded="true">
      <div class="brand">
        <span class="brand-mark"></span>
        <div class="brand-copy">
          <p class="eyebrow">Stim Lab</p>
          <p class="brand-title">Webtoy Library ✦</p>
        </div>
      </div>
      <button class="nav-toggle" type="button" aria-expanded="true" aria-controls="nav-actions">
        <span data-nav-toggle-label>Menu</span>
        <span class="nav-toggle__icon" data-nav-toggle-icon aria-hidden="true">☰</span>
      </button>
      <div class="nav-actions" id="nav-actions">
        <div class="nav-section nav-section--jump" aria-label="Jump to">
          <span class="nav-section__label">Jump</span>
          <a class="nav-link nav-link--section" data-section-link href="#intro">Intro</a>
          <a class="nav-link nav-link--section" data-section-link href="#quick-starts">Quick start</a>
          <a class="nav-link nav-link--section" data-section-link href="#system-check">System check</a>
          <a class="nav-link nav-link--section" data-section-link href="#library">Library</a>
          <a class="nav-link nav-link--section" data-section-link href="#github">GitHub</a>
          <a class="nav-link nav-link--section" data-section-link href="#site-footer">Connect</a>
        </div>
        <div class="nav-section nav-section--utilities" aria-label="Utilities">
          <span class="nav-section__label">Utilities</span>
          <a class="nav-link" href="#toy-list">Browse</a>
          <a class="nav-link" href="https://github.com/zz-plant/stims" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a class="nav-link" href="https://github.com/zz-plant/stims/issues" target="_blank" rel="noopener noreferrer">Issues</a>
          <a class="nav-link" href="https://github.com/zz-plant/stims/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog</a>
          <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false" aria-label="Switch to dark mode">
            <span class="theme-toggle__icon" aria-hidden="true">🌙</span>
            <span class="theme-toggle__label" data-theme-label>Dark mode</span>
          </button>
        </div>
      </div>
    </nav>
  `;

  const nav = container.querySelector('.top-nav') as HTMLElement | null;
  const toggle = container.querySelector(
    '.nav-toggle',
  ) as HTMLButtonElement | null;
  const label = container.querySelector(
    '[data-nav-toggle-label]',
  ) as HTMLSpanElement | null;
  const icon = container.querySelector(
    '[data-nav-toggle-icon]',
  ) as HTMLSpanElement | null;
  const mediaQuery = getMediaQueryList(maxWidthQuery(BREAKPOINTS.xs));
  let isExpanded = !isBelowBreakpoint(BREAKPOINTS.xs);

  const applyState = (expanded: boolean) => {
    if (!nav || !toggle) return;
    nav.dataset.navExpanded = expanded ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (label) {
      label.textContent = expanded ? 'Close menu' : 'Menu';
    }
    if (icon) {
      icon.textContent = expanded ? '✕' : '☰';
    }
  };

  const syncWithViewport = () => {
    if (isBelowBreakpoint(BREAKPOINTS.xs)) {
      isExpanded = false;
    } else {
      isExpanded = true;
    }
    applyState(isExpanded);
  };

  syncWithViewport();

  toggle?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    applyState(isExpanded);
  });

  if (mediaQuery) {
    mediaQuery.addEventListener('change', syncWithViewport);
  } else {
    window.addEventListener('resize', syncWithViewport);
  }

  container
    .querySelectorAll('.nav-link, .nav-link--section, .theme-toggle')
    .forEach((link) => {
      link.addEventListener('click', () => {
        if (!isBelowBreakpoint(BREAKPOINTS.xs)) return;
        isExpanded = false;
        applyState(isExpanded);
      });
    });
}

function renderToyNav(
  container: HTMLElement,
  doc: Document,
  options: NavOptions,
) {
  const safeTitle = escapeHtml(options.title ?? 'Web toy');
  const safeSlug = options.slug ? escapeHtml(options.slug) : '';
  const hintText = isMobileDevice()
    ? 'Tap Flow mode to auto-switch every 25–50s. Use Back to return.'
    : 'Press Esc or use Back to return to the library.';
  const randomChallenge =
    TOY_MICRO_CHALLENGES[
      Math.floor(Math.random() * TOY_MICRO_CHALLENGES.length)
    ] ?? TOY_MICRO_CHALLENGES[0];
  container.className = 'active-toy-nav';
  container.innerHTML = `
    <div class="active-toy-nav__content">
      <p class="active-toy-nav__eyebrow">Now playing</p>
      <p class="active-toy-nav__title">${safeTitle}</p>
      <p class="active-toy-nav__hint">${hintText}</p>
      ${safeSlug ? `<span class="active-toy-nav__pill">${safeSlug}</span>` : ''}
      <div class="active-toy-nav__mobile-actions">
        <button
          type="button"
          class="toy-nav__back-quick"
          data-back-to-library-quick="true"
        >
          <span aria-hidden="true">←</span><span>Back</span>
        </button>
        <button
          type="button"
          class="toy-nav__mobile-toggle"
          data-toy-actions-toggle="true"
          aria-controls="toy-nav-actions"
          aria-expanded="false"
        >
          Controls
        </button>
      </div>
    </div>
    <div class="active-toy-nav__actions" id="toy-nav-actions" data-toy-actions-expanded="true">
      <div class="renderer-status-container"></div>
      ${
        options.onNextToy
          ? `<div class="toy-nav__next-wrapper">
              <button type="button" class="toy-nav__next" data-next-toy="true">
                Next stim
              </button>
              <span class="toy-nav__next-status" role="status" aria-live="polite"></span>
            </div>`
          : ''
      }
      ${
        options.onToggleFlow
          ? `<div class="toy-nav__flow-wrapper">
              <button type="button" class="toy-nav__flow" data-flow-toggle="true" aria-pressed="${options.flowActive ? 'true' : 'false'}">
                ${options.flowActive ? 'Flow mode on' : 'Flow mode'}
              </button>
              <span class="toy-nav__flow-status" role="status" aria-live="polite"></span>
            </div>`
          : ''
      }
      <div class="toy-nav__challenge-wrapper">
        <button type="button" class="toy-nav__challenge" data-challenge-refresh="true">
          New mini challenge
        </button>
        <span class="toy-nav__challenge-status" role="status" aria-live="polite">${escapeHtml(randomChallenge)}</span>
      </div>
      <div class="toy-nav__pip-wrapper">
        <button type="button" class="toy-nav__pip" data-toy-pip="true" aria-pressed="false">
          Picture in picture
        </button>
        <span class="toy-nav__pip-status" role="status" aria-live="polite"></span>
      </div>
      <div class="toy-nav__share-wrapper">
        <button type="button" class="toy-nav__share" data-share-toy="true">
          Copy share link
        </button>
        <span class="toy-nav__share-status" role="status" aria-live="polite"></span>
      </div>
      <button type="button" class="toy-nav__back" data-back-to-library="true">
        <span aria-hidden="true">←</span><span>Back to library</span>
      </button>
    </div>
  `;

  setupToyNavFloatingOffset(container as ToyNavContainer, doc);

  if (options.rendererStatus) {
    const statusContainer = container.querySelector(
      '.renderer-status-container',
    );
    if (statusContainer) {
      renderRendererStatus(
        statusContainer as HTMLElement,
        doc,
        options.rendererStatus,
      );
    }
  }

  const backBtn = container.querySelector('.toy-nav__back');
  backBtn?.addEventListener('click', () => options.onBack?.());

  const quickBackBtn = container.querySelector('.toy-nav__back-quick');
  quickBackBtn?.addEventListener('click', () => options.onBack?.());

  const actionsContainer = container.querySelector(
    '.active-toy-nav__actions',
  ) as HTMLElement | null;
  const actionsToggleBtn = container.querySelector(
    '[data-toy-actions-toggle="true"]',
  ) as HTMLButtonElement | null;
  const mobileActionsMediaQuery = getMediaQueryList(
    maxWidthQuery(BREAKPOINTS.md),
  );
  let actionsExpanded = !isBelowBreakpoint(BREAKPOINTS.md);

  const applyActionsState = (expanded: boolean) => {
    actionsContainer?.setAttribute(
      'data-toy-actions-expanded',
      expanded ? 'true' : 'false',
    );
    doc.documentElement.setAttribute(
      'data-toy-controls-expanded',
      expanded ? 'true' : 'false',
    );
    actionsToggleBtn?.setAttribute(
      'aria-expanded',
      expanded ? 'true' : 'false',
    );
    if (actionsToggleBtn) {
      actionsToggleBtn.textContent = expanded ? 'Hide controls' : 'Controls';
    }
  };

  const syncActionsForViewport = () => {
    actionsExpanded = !isBelowBreakpoint(BREAKPOINTS.md);
    applyActionsState(actionsExpanded);
  };

  syncActionsForViewport();

  actionsToggleBtn?.addEventListener('click', () => {
    actionsExpanded = !actionsExpanded;
    applyActionsState(actionsExpanded);
  });

  if (mobileActionsMediaQuery) {
    mobileActionsMediaQuery.addEventListener('change', syncActionsForViewport);
  } else {
    window.addEventListener('resize', syncActionsForViewport);
  }

  const shareBtn = container.querySelector('.toy-nav__share');
  const shareStatus = container.querySelector(
    '.toy-nav__share-status',
  ) as HTMLElement | null;
  const nextBtn = container.querySelector(
    '.toy-nav__next',
  ) as HTMLButtonElement | null;
  const nextStatus = container.querySelector(
    '.toy-nav__next-status',
  ) as HTMLElement | null;
  const flowBtn = container.querySelector(
    '.toy-nav__flow',
  ) as HTMLButtonElement | null;
  const flowStatus = container.querySelector(
    '.toy-nav__flow-status',
  ) as HTMLElement | null;
  const challengeBtn = container.querySelector(
    '.toy-nav__challenge',
  ) as HTMLButtonElement | null;
  const challengeStatus = container.querySelector(
    '.toy-nav__challenge-status',
  ) as HTMLElement | null;
  let flowActive = Boolean(options.flowActive);

  challengeBtn?.addEventListener('click', () => {
    const nextChallenge =
      TOY_MICRO_CHALLENGES[
        Math.floor(Math.random() * TOY_MICRO_CHALLENGES.length)
      ] ?? TOY_MICRO_CHALLENGES[0];
    if (challengeStatus) {
      challengeStatus.textContent = nextChallenge;
    }
  });

  const showShareStatus = (message: string) => {
    if (!shareStatus) return;
    shareStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (shareStatus.textContent === message) {
        shareStatus.textContent = '';
      }
    }, 3200);
  };

  const showNextStatus = (message: string) => {
    if (!nextStatus) return;
    nextStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (nextStatus.textContent === message) {
        nextStatus.textContent = '';
      }
    }, 3200);
  };

  const showFlowStatus = (message: string) => {
    if (!flowStatus) return;
    flowStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (flowStatus.textContent === message) {
        flowStatus.textContent = '';
      }
    }, 3200);
  };

  const updateFlowUI = () => {
    if (!flowBtn) return;
    flowBtn.setAttribute('aria-pressed', String(flowActive));
    flowBtn.textContent = flowActive ? 'Flow mode on' : 'Flow mode';
  };

  const handleNextToy = async () => {
    if (!options.onNextToy || !nextBtn) return;
    nextBtn.disabled = true;
    nextBtn.setAttribute('aria-busy', 'true');
    showNextStatus('Loading next stim…');
    try {
      await options.onNextToy();
    } catch (_error) {
      showNextStatus('Unable to load next stim.');
    } finally {
      nextBtn.disabled = false;
      nextBtn.removeAttribute('aria-busy');
    }
  };

  nextBtn?.addEventListener('click', () => {
    void handleNextToy();
  });

  updateFlowUI();

  flowBtn?.addEventListener('click', () => {
    flowActive = !flowActive;
    updateFlowUI();
    options.onToggleFlow?.(flowActive);
    showFlowStatus(
      flowActive
        ? 'Flow mode enabled. We will keep switching stims.'
        : 'Flow mode paused.',
    );
  });

  const copyShareLink = async () => {
    const win = doc.defaultView ?? window;
    const url = win.location.href;
    showShareStatus('Copying link…');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const helper = doc.createElement('textarea');
        helper.value = url;
        helper.setAttribute('readonly', 'true');
        helper.style.position = 'fixed';
        helper.style.top = '-1000px';
        doc.body.appendChild(helper);
        helper.select();
        doc.execCommand('copy');
        helper.remove();
      }
      showShareStatus('Share link copied.');
    } catch (_error) {
      showShareStatus('Unable to copy link.');
    }
  };

  shareBtn?.addEventListener('click', () => {
    if (options.onShare) {
      options.onShare();
      return;
    }
    void copyShareLink();
  });

  setupPictureInPictureControls(container, doc);
}

function setupToyNavFloatingOffset(container: ToyNavContainer, doc: Document) {
  container.__toyNavOffsetCleanup?.();

  const root = doc.documentElement;
  const updateOffset = () => {
    const navBottom = Math.ceil(container.getBoundingClientRect().bottom);
    root.style.setProperty('--toy-nav-floating-offset', `${navBottom + 14}px`);
  };

  updateOffset();

  const win = doc.defaultView;
  const rafHandle = win?.requestAnimationFrame(() => {
    updateOffset();
  });
  const delayedUpdateHandle = win?.setTimeout(updateOffset, 120);

  const ResizeObserverCtor = win?.ResizeObserver;
  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(updateOffset)
    : null;
  resizeObserver?.observe(container);

  const MutationObserverCtor = win?.MutationObserver;
  const mutationObserver = MutationObserverCtor
    ? new MutationObserverCtor(updateOffset)
    : null;
  mutationObserver?.observe(container, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  win?.addEventListener('resize', updateOffset);
  win?.visualViewport?.addEventListener('resize', updateOffset);
  win?.visualViewport?.addEventListener('scroll', updateOffset);

  container.__toyNavOffsetCleanup = () => {
    if (typeof rafHandle === 'number') {
      win?.cancelAnimationFrame(rafHandle);
    }
    if (typeof delayedUpdateHandle === 'number') {
      win?.clearTimeout(delayedUpdateHandle);
    }
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    win?.removeEventListener('resize', updateOffset);
    win?.visualViewport?.removeEventListener('resize', updateOffset);
    win?.visualViewport?.removeEventListener('scroll', updateOffset);
  };
}

function setupPictureInPictureControls(container: HTMLElement, doc: Document) {
  const pipButton = container.querySelector<HTMLButtonElement>(
    '[data-toy-pip="true"]',
  );
  const pipStatus = container.querySelector<HTMLElement>(
    '.toy-nav__pip-status',
  );

  if (!pipButton || !pipStatus) return;

  const updateButtonState = () => {
    const active = isToyPictureInPictureActive(doc);
    pipButton.setAttribute('aria-pressed', String(active));
    pipButton.textContent = active
      ? 'Exit picture in picture'
      : 'Picture in picture';
  };

  const showStatus = (message: string) => {
    pipStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (pipStatus.textContent === message) {
        pipStatus.textContent = '';
      }
    }, 3200);
  };

  let pipPermanentlyDisabled = false;

  const disablePip = (message: string) => {
    pipButton.disabled = true;
    pipButton.setAttribute('aria-disabled', 'true');
    pipButton.setAttribute('title', message);
    pipButton.removeAttribute('aria-busy');
    showStatus(message);
    pipPermanentlyDisabled = true;
  };

  if (!isPictureInPictureSupported(doc)) {
    disablePip('Picture-in-picture is not available in this browser.');
    return;
  }

  updateButtonState();

  const video = getToyPictureInPictureVideo(doc);
  video.onenterpictureinpicture = () => updateButtonState();
  video.onleavepictureinpicture = () => updateButtonState();

  pipButton.addEventListener('click', async () => {
    const wasActive = isToyPictureInPictureActive(doc);
    pipButton.disabled = true;
    pipButton.setAttribute('aria-busy', 'true');
    showStatus(
      wasActive ? 'Closing picture in picture…' : 'Opening picture in picture…',
    );

    try {
      if (wasActive) {
        await exitToyPictureInPicture(doc);
      } else {
        await requestToyPictureInPicture(doc);
      }
      updateButtonState();
      showStatus(
        wasActive
          ? 'Picture in picture closed.'
          : 'Picture in picture enabled.',
      );
    } catch (_error) {
      const error = _error as Error | DOMException;
      const errorName = 'name' in error ? error.name : '';
      if (errorName === 'NotSupportedError') {
        disablePip('Picture-in-picture is not available in this browser.');
      } else {
        showStatus('Unable to use picture in picture.');
      }
      updateButtonState();
    } finally {
      if (!pipPermanentlyDisabled) {
        pipButton.disabled = false;
        pipButton.removeAttribute('aria-busy');
      }
    }
  });
}

function renderRendererStatus(
  container: HTMLElement,
  _doc: Document,
  status: NonNullable<NavOptions['rendererStatus']>,
) {
  const fallback = status.backend !== 'webgpu';
  const pillClass = fallback
    ? 'renderer-pill--fallback'
    : 'renderer-pill--success';
  const fallbackReason = status.fallbackReason
    ? escapeHtml(status.fallbackReason)
    : null;
  const titleText = escapeHtml(
    status.fallbackReason ??
      (fallback
        ? 'WebGPU unavailable, using WebGL.'
        : 'WebGPU renderer active.'),
  );

  container.innerHTML = `
    <div class="renderer-status">
      <span class="renderer-pill ${pillClass}" title="${titleText}">
        ${fallback ? 'WebGL fallback' : 'WebGPU'}
      </span>
      ${fallbackReason ? `<small class="renderer-pill__detail">${fallbackReason}</small>` : ''}
      ${status.shouldRetryWebGPU ? `<button type="button" class="renderer-pill__retry">${status.triedWebGPU ? 'Retry WebGPU' : 'Try WebGPU'}</button>` : ''}
    </div>
  `;

  const retryBtn = container.querySelector('.renderer-pill__retry');
  retryBtn?.addEventListener('click', () => status.onRetry?.());
}

function setupThemeToggle(container: HTMLElement) {
  const doc = container.ownerDocument;
  const toggle = container.querySelector('#theme-toggle');
  if (!toggle) return;

  const label = toggle.querySelector('[data-theme-label]');
  const icon = toggle.querySelector('.theme-toggle__icon');

  const updateUI = (theme: string) => {
    const isDark = theme === 'dark';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute(
      'aria-label',
      isDark ? 'Switch to light mode' : 'Switch to dark mode',
    );
    if (label) label.textContent = isDark ? 'Light mode' : 'Dark mode';
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  };

  // Initial state
  const root = doc.documentElement;
  const currentTheme = root.classList.contains('light') ? 'light' : 'dark';
  updateUI(currentTheme);

  toggle.addEventListener('click', () => {
    const isLight = root.classList.contains('light');
    const nextTheme = isLight ? 'dark' : 'light';
    const win = doc.defaultView ?? window;

    // Use the global helper if available
    if (win.__stimsTheme) {
      win.__stimsTheme.applyTheme(nextTheme, true);
    } else {
      if (nextTheme === 'light') {
        root.classList.add('light');
      } else {
        root.classList.remove('light');
      }
      try {
        win.localStorage.setItem('theme', nextTheme);
      } catch (_error) {
        // Ignore storage errors.
      }
    }

    updateUI(nextTheme);
  });
}
