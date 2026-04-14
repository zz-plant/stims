import {
  BREAKPOINTS,
  getMediaQueryList,
  isBelowBreakpoint,
  maxWidthQuery,
} from '../utils/breakpoints';
import { shareOrCopyLink } from '../utils/share-link.ts';
import { renderIconSvg, replaceIconContents } from './icon-library.ts';
import { setupPictureInPictureControls } from './nav-picture-in-picture.ts';
import { renderRendererStatus } from './nav-renderer-status.ts';
import { escapeHtml, renderIconLabel } from './nav-shared.ts';
import { setupThemeToggle } from './nav-theme-toggle.ts';

export interface NavOptions {
  mode: 'library' | 'toy';
  title?: string;
  slug?: string;
  sectionLinks?: Array<{
    href: string;
    label: string;
  }>;
  utilityLink?: {
    href: string;
    label: string;
  } | null;
  onBack?: () => void;
  onShare?: () => void;
  onNextToy?: () => void | Promise<void>;
  onToggleHaptics?: (active: boolean) => void;
  hapticsActive?: boolean;
  hapticsSupported?: boolean;
  rendererStatus?: {
    backend: 'webgl' | 'webgpu';
    fallbackReason?: string | null;
    actionLabel?: string;
    onAction?: () => void;
  } | null;
}

type ToyNavContainer = HTMLElement & {
  __toyNavOffsetCleanup?: () => void;
  __toyNavChromeCleanup?: () => void;
  __toyNavDetachCleanup?: () => void;
  __libraryNavCleanup?: () => void;
};

export function initNavigation(container: HTMLElement, options: NavOptions) {
  const doc = container.ownerDocument;
  resetNavigationState(container as ToyNavContainer);

  if (options.mode === 'library') {
    renderLibraryNav(container, doc, options);
  } else {
    renderToyNav(container, doc, options);
  }

  setupThemeToggle(container);
}

function resetNavigationState(container: ToyNavContainer) {
  container.__toyNavOffsetCleanup?.();
  container.__toyNavOffsetCleanup = undefined;
  container.__toyNavChromeCleanup?.();
  container.__toyNavChromeCleanup = undefined;
  container.__toyNavDetachCleanup?.();
  container.__toyNavDetachCleanup = undefined;
  container.__libraryNavCleanup?.();
  container.__libraryNavCleanup = undefined;
  container.ownerDocument.documentElement.style.removeProperty(
    '--toy-nav-floating-offset',
  );
  container.ownerDocument.documentElement.removeAttribute(
    'data-toy-controls-expanded',
  );
}

function renderLibraryNav(
  container: HTMLElement,
  _doc: Document,
  options: NavOptions,
) {
  const compactLandscapeQuery =
    '(max-height: 520px) and (orientation: landscape)';
  const toyContainer = container as ToyNavContainer;
  const actionsId = 'nav-actions';
  const sectionLinks = options.sectionLinks ?? [
    { href: '#experience', label: 'Surfaces' },
    { href: '#presets', label: 'Presets' },
    { href: '#structure', label: 'Structure' },
  ];
  const utilityLink = options.utilityLink ?? {
    href: '/milkdrop/',
    label: 'Open setup',
  };
  const resolvedUtilityLink =
    options.utilityLink === undefined ? utilityLink : options.utilityLink;

  container.innerHTML = `
    <nav class="top-nav" data-top-nav aria-label="Primary" data-nav-expanded="false">
      <div class="brand">
        <span class="brand-mark"></span>
        <div class="brand-copy">
          <p class="eyebrow">Stims</p>
          <p class="brand-title">Stims ✦</p>
        </div>
      </div>
      <button
        class="nav-toggle"
        type="button"
        aria-expanded="false"
        aria-controls="${actionsId}"
      >
        <span data-nav-toggle-label>Menu</span>
        <span class="nav-toggle__icon stims-icon-slot stims-icon-slot--md" data-nav-toggle-icon aria-hidden="true">${renderIconSvg('menu', { title: 'Menu' })}</span>
      </button>
      <div class="nav-actions" id="${actionsId}">
        <div class="nav-section nav-section--primary nav-section--jump" aria-label="Page sections">
          ${sectionLinks
            .map(
              (link) =>
                `<a class="nav-link nav-link--section" data-section-link href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
            )
            .join('')}
          <a class="nav-link" href="https://github.com/zz-plant/stims" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <div class="nav-section nav-section--utilities" aria-label="Site actions">
          ${
            resolvedUtilityLink
              ? `<a class="nav-link nav-link--launch" href="${escapeHtml(resolvedUtilityLink.href)}">${escapeHtml(resolvedUtilityLink.label)}</a>`
              : ''
          }
          <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false" aria-label="Switch to dark mode">
            <span class="theme-toggle__icon stims-icon-slot" aria-hidden="true">${renderIconSvg('moon', { title: 'Dark mode' })}</span>
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
  const actions = container.querySelector(
    `#${actionsId}`,
  ) as HTMLElement | null;
  const mediaQuery = getMediaQueryList(maxWidthQuery(BREAKPOINTS.xs));
  const compactLandscapeMediaQuery = getMediaQueryList(compactLandscapeQuery);
  const onResize = () => syncWithViewport();
  const supportsPopover = false;
  let isExpanded = false;
  const isCompactViewport = () =>
    isBelowBreakpoint(BREAKPOINTS.xs) ||
    Boolean(compactLandscapeMediaQuery?.matches);

  const syncToggleUi = (expanded: boolean) => {
    if (!nav || !toggle) return;
    nav.dataset.navExpanded = expanded ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      expanded ? 'Close navigation menu' : 'Open navigation menu',
    );
    if (label) {
      label.textContent = expanded ? 'Close menu' : 'Menu';
    }
    if (icon) {
      replaceIconContents(icon, expanded ? 'close' : 'menu', {
        title: expanded ? 'Close menu' : 'Menu',
      });
    }
  };

  const applyFallbackState = (expanded: boolean) => {
    if (!actions) return;
    actions.hidden = !expanded;
    actions.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    if (expanded) {
      actions.removeAttribute('inert');
    } else {
      actions.setAttribute('inert', '');
    }
  };

  const isPopoverOpen = () => Boolean(actions?.matches?.(':popover-open'));

  const syncWithViewport = () => {
    const compactViewport = isCompactViewport();

    if (!actions) {
      syncToggleUi(!compactViewport);
      return;
    }

    if (supportsPopover) {
      if (compactViewport) {
        actions.setAttribute('popover', 'auto');
        if (!isPopoverOpen()) {
          actions.setAttribute('aria-hidden', 'true');
          actions.setAttribute('inert', '');
        }
        isExpanded = isPopoverOpen();
      } else {
        if (isPopoverOpen()) {
          (actions as HTMLElement & { hidePopover: () => void }).hidePopover();
        }
        actions.removeAttribute('popover');
        actions.hidden = false;
        actions.setAttribute('aria-hidden', 'false');
        actions.removeAttribute('inert');
        isExpanded = true;
      }
    } else {
      actions.hidden = false;
      if (compactViewport) {
        applyFallbackState(isExpanded);
      } else {
        isExpanded = true;
        applyFallbackState(true);
      }
    }

    syncToggleUi(compactViewport ? isExpanded : true);
  };

  const onToggle = () => {
    if (!supportsPopover || !isCompactViewport()) return;
    isExpanded = isPopoverOpen();
    if (actions) {
      actions.setAttribute('aria-hidden', isExpanded ? 'false' : 'true');
      if (isExpanded) {
        actions.removeAttribute('inert');
      } else {
        actions.setAttribute('inert', '');
      }
    }
    syncToggleUi(isExpanded);
  };

  syncWithViewport();

  if (!supportsPopover) {
    toggle?.addEventListener('click', () => {
      if (!isCompactViewport()) return;
      isExpanded = !isExpanded;
      applyFallbackState(isExpanded);
      syncToggleUi(isExpanded);
    });
  } else {
    actions?.addEventListener('toggle', onToggle);
  }

  if (mediaQuery) {
    mediaQuery.addEventListener('change', syncWithViewport);
    compactLandscapeMediaQuery?.addEventListener('change', syncWithViewport);
  } else {
    window.addEventListener('resize', onResize);
  }

  container
    .querySelectorAll('.nav-link, .nav-link--section, .theme-toggle')
    .forEach((link) => {
      link.addEventListener('click', () => {
        if (!isCompactViewport()) return;
        if (supportsPopover) {
          if (isPopoverOpen()) {
            (
              actions as (HTMLElement & { hidePopover: () => void }) | null
            )?.hidePopover();
          }
          return;
        }
        isExpanded = false;
        applyFallbackState(false);
        syncToggleUi(false);
      });
    });

  toyContainer.__libraryNavCleanup = () => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', syncWithViewport);
      compactLandscapeMediaQuery?.removeEventListener(
        'change',
        syncWithViewport,
      );
    } else {
      window.removeEventListener('resize', onResize);
    }
    actions?.removeEventListener('toggle', onToggle);
  };
}

function renderToyNav(
  container: HTMLElement,
  doc: Document,
  options: NavOptions,
) {
  const safeTitle = escapeHtml(options.title ?? 'Stims');
  container.className = 'active-toy-nav';
  container.innerHTML = `
    <div class="active-toy-nav__content">
      <p class="active-toy-nav__title">${safeTitle}</p>
      <div class="active-toy-nav__mobile-actions">
        <button
          type="button"
          class="toy-nav__back-quick"
          data-back-to-library-quick="true"
        >
          ${renderIconLabel('arrow-left', 'Back to Stims')}
        </button>
      </div>
    </div>
    <div class="active-toy-nav__actions" id="toy-nav-actions" data-toy-actions-expanded="false">
      <div class="active-toy-nav__actions-primary">
        <div class="renderer-status-container"></div>
        <button
          type="button"
          class="toy-nav__mobile-toggle toy-nav__session-toggle"
          data-toy-actions-toggle="true"
          aria-controls="toy-nav-secondary-actions"
          aria-expanded="false"
        >
          ${renderIconLabel('sliders', 'Controls')}
        </button>
      </div>
      <div
        class="active-toy-nav__actions-secondary"
        id="toy-nav-secondary-actions"
      >
      ${
        options.onNextToy
          ? `<div class="toy-nav__next-wrapper">
              <button type="button" class="toy-nav__next" data-next-toy="true">
                ${renderIconLabel('arrow-right', 'Next preset')}
              </button>
              <span class="toy-nav__next-status" role="status" aria-live="polite"></span>
            </div>`
          : ''
      }
      <div class="toy-nav__share-wrapper">
        <button type="button" class="toy-nav__share" data-share-toy="true">
          ${renderIconLabel('link', 'Copy link')}
        </button>
        <span class="toy-nav__share-status" role="status" aria-live="polite"></span>
      </div>
      ${
        options.onToggleHaptics && options.hapticsSupported
          ? `<div class="toy-nav__flow-wrapper">
              <button type="button" class="toy-nav__flow" data-haptics-toggle="true" aria-pressed="${options.hapticsActive ? 'true' : 'false'}">
                ${renderIconLabel('pulse', options.hapticsActive ? 'Pulse on' : 'Pulse')}
              </button>
              <span class="toy-nav__flow-status" data-haptics-status role="status" aria-live="polite"></span>
            </div>`
          : ''
      }
      <div class="toy-nav__pip-wrapper">
        <button type="button" class="toy-nav__pip" data-toy-pip="true" aria-pressed="false">
          ${renderIconLabel('picture-in-picture', 'Mini player')}
        </button>
        <span class="toy-nav__pip-status" role="status" aria-live="polite"></span>
      </div>
      <button type="button" class="toy-nav__back" data-back-to-library="true">
        ${renderIconLabel('arrow-left', 'Back to Stims')}
      </button>
      </div>
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
  const secondaryActionsContainer = container.querySelector(
    '.active-toy-nav__actions-secondary',
  ) as HTMLElement | null;
  const actionsToggleBtn = container.querySelector(
    '[data-toy-actions-toggle="true"]',
  ) as HTMLButtonElement | null;
  let actionsExpanded = false;
  let hideChromeTimeoutId: number | null = null;
  const root = doc.documentElement;

  const isImmersiveSession = () =>
    root.dataset.sessionDisplayMode === 'immersive';
  const isToolsSession = () => root.dataset.sessionDisplayMode === 'tools';
  const isOverlayOpen = () =>
    Boolean(doc.querySelector('.milkdrop-overlay.is-open'));
  const hasFocusedControls = () =>
    container.contains(doc.activeElement) ||
    Boolean(doc.querySelector('.milkdrop-overlay.is-open :focus'));
  const shouldKeepChromeVisible = () =>
    actionsExpanded ||
    isToolsSession() ||
    isOverlayOpen() ||
    hasFocusedControls() ||
    root.dataset.preflightOpen === 'true';
  const setChromeVisibility = (visibility: 'visible' | 'hidden') => {
    if (root.dataset.sessionChrome === visibility) {
      return;
    }
    root.dataset.sessionChrome = visibility;
  };
  const clearHideChromeTimeout = () => {
    if (hideChromeTimeoutId !== null) {
      const win = doc.defaultView ?? window;
      win.clearTimeout(hideChromeTimeoutId);
      hideChromeTimeoutId = null;
    }
  };
  const scheduleChromeHide = () => {
    clearHideChromeTimeout();
    if (!isImmersiveSession() || shouldKeepChromeVisible()) {
      setChromeVisibility('visible');
      return;
    }
    const win = doc.defaultView ?? window;
    hideChromeTimeoutId = win.setTimeout(() => {
      if (!shouldKeepChromeVisible() && isImmersiveSession()) {
        setChromeVisibility('hidden');
      }
      hideChromeTimeoutId = null;
    }, 2200);
  };
  const revealChrome = () => {
    setChromeVisibility('visible');
    scheduleChromeHide();
  };

  const applyActionsState = (expanded: boolean) => {
    actionsContainer?.setAttribute(
      'data-toy-actions-expanded',
      expanded ? 'true' : 'false',
    );
    if (secondaryActionsContainer) {
      secondaryActionsContainer.hidden = !expanded;
      secondaryActionsContainer.setAttribute(
        'aria-hidden',
        expanded ? 'false' : 'true',
      );
      if (!expanded) {
        secondaryActionsContainer.setAttribute('inert', '');
      } else {
        secondaryActionsContainer.removeAttribute('inert');
      }
    }
    doc.documentElement.setAttribute(
      'data-toy-controls-expanded',
      expanded ? 'true' : 'false',
    );
    actionsToggleBtn?.setAttribute(
      'aria-expanded',
      expanded ? 'true' : 'false',
    );
    if (actionsToggleBtn) {
      const toggleIcon = actionsToggleBtn.querySelector(
        '.toy-nav__button-icon',
      );
      const toggleLabel = actionsToggleBtn.querySelector(
        '.toy-nav__button-label',
      );
      replaceIconContents(toggleIcon, expanded ? 'close' : 'sliders', {
        title: expanded ? 'Hide controls' : 'Controls',
      });
      if (toggleLabel) {
        toggleLabel.textContent = expanded ? 'Hide controls' : 'Controls';
      }
    }
    if (expanded) {
      setChromeVisibility('visible');
    }
    scheduleChromeHide();
  };

  const syncActionsForViewport = () => {
    applyActionsState(actionsExpanded);
  };

  syncActionsForViewport();

  actionsToggleBtn?.addEventListener('click', () => {
    actionsExpanded = !actionsExpanded;
    applyActionsState(actionsExpanded);
  });

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
  let hapticsActive = Boolean(options.hapticsActive);
  const hapticsBtn = container.querySelector(
    '[data-haptics-toggle="true"]',
  ) as HTMLButtonElement | null;
  const hapticsStatus = container.querySelector(
    '[data-haptics-status]',
  ) as HTMLElement | null;

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
  const showHapticsStatus = (message: string) => {
    if (!hapticsStatus) return;
    hapticsStatus.textContent = message;
    if (!message) return;
    const win = doc.defaultView ?? window;
    win.setTimeout(() => {
      if (hapticsStatus.textContent === message) {
        hapticsStatus.textContent = '';
      }
    }, 3200);
  };

  const updateHapticsUI = () => {
    if (!hapticsBtn) return;
    hapticsBtn.setAttribute('aria-pressed', String(hapticsActive));
    const label = hapticsBtn.querySelector('.toy-nav__button-label');
    if (label) {
      label.textContent = hapticsActive
        ? 'Pulse feedback on'
        : 'Pulse feedback';
    }
  };

  const handleNextToy = async () => {
    if (!options.onNextToy || !nextBtn) return;
    nextBtn.disabled = true;
    nextBtn.setAttribute('aria-busy', 'true');
    showNextStatus('Loading next preset…');
    try {
      await options.onNextToy();
    } catch (_error) {
      showNextStatus('Unable to load the next preset.');
    } finally {
      nextBtn.disabled = false;
      nextBtn.removeAttribute('aria-busy');
    }
  };

  nextBtn?.addEventListener('click', () => {
    void handleNextToy();
  });
  hapticsBtn?.addEventListener('click', () => {
    hapticsActive = !hapticsActive;
    updateHapticsUI();
    options.onToggleHaptics?.(hapticsActive);
    showHapticsStatus(
      hapticsActive ? 'Pulse feedback on.' : 'Pulse feedback off.',
    );
  });

  const copyShareLink = async () => {
    const win = doc.defaultView ?? window;
    const url = win.location.href;
    showShareStatus('Preparing share…');
    const result = await shareOrCopyLink(url, {
      doc,
      title: doc.title || 'Stims',
      text: 'Open this Stims visualizer view.',
    });

    if (result === 'shared') {
      showShareStatus('Link shared.');
      return;
    }

    if (result === 'copied') {
      showShareStatus('Link copied.');
      return;
    }

    if (result === 'cancelled') {
      showShareStatus('Share cancelled.');
      return;
    }

    showShareStatus('Unable to share link.');
  };

  shareBtn?.addEventListener('click', () => {
    if (options.onShare) {
      options.onShare();
      return;
    }
    void copyShareLink();
  });

  const revealChromeEvents = [
    'pointermove',
    'pointerdown',
    'focusin',
    'keydown',
  ];
  const revealChromeHandler = () => revealChrome();
  revealChromeEvents.forEach((eventName) => {
    doc.addEventListener(eventName, revealChromeHandler);
  });
  const MutationObserverCtor = doc.defaultView?.MutationObserver;
  const mutationObserver = MutationObserverCtor
    ? new MutationObserverCtor(() => {
        if (shouldKeepChromeVisible()) {
          setChromeVisibility('visible');
        }
        scheduleChromeHide();
      })
    : null;
  mutationObserver?.observe(root, {
    attributes: true,
    attributeFilter: [
      'data-session-display-mode',
      'data-session-chrome',
      'data-preflight-open',
    ],
  });
  mutationObserver?.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  scheduleChromeHide();

  (container as ToyNavContainer).__toyNavChromeCleanup = () => {
    clearHideChromeTimeout();
    revealChromeEvents.forEach((eventName) => {
      doc.removeEventListener(eventName, revealChromeHandler);
    });
    mutationObserver?.disconnect();
  };

  setupPictureInPictureControls(container, doc);
  installToyNavDetachCleanup(container as ToyNavContainer, doc);
}

function installToyNavDetachCleanup(container: ToyNavContainer, doc: Document) {
  container.__toyNavDetachCleanup?.();

  const MutationObserverCtor = doc.defaultView?.MutationObserver;
  let observer: MutationObserver | undefined;
  if (MutationObserverCtor) {
    const detachObserver = new MutationObserverCtor(() => {
      if (container.isConnected) {
        return;
      }
      container.__toyNavChromeCleanup?.();
      container.__toyNavChromeCleanup = undefined;
      container.__toyNavOffsetCleanup?.();
      container.__toyNavOffsetCleanup = undefined;
      detachObserver.disconnect();
      container.__toyNavDetachCleanup = undefined;
    });
    observer = detachObserver;
  }

  observer?.observe(doc.body, {
    childList: true,
    subtree: true,
  });

  container.__toyNavDetachCleanup = () => {
    observer?.disconnect();
  };
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
