import {
  renderPreflightIssueList,
  updatePreflightNextStep,
  updatePreflightStatusList,
  updatePreflightWhyDetails,
} from './capability-preflight-content.ts';
import { bindLibraryBackLink } from './library-back-navigation.ts';
import {
  getFocusableElements,
  restoreFocusIfPresent,
  updateModalQueryParam,
} from './modal-utils.ts';
import {
  getActiveRenderPreferences,
  setRenderPreferences,
} from './render-preferences.ts';
import {
  type CapabilityPreflightResult,
  runCapabilityProbe,
} from './services/capability-probe-service.ts';

export type { CapabilityPreflightResult } from './services/capability-probe-service.ts';

export const PREFLIGHT_SESSION_DISMISS_KEY = 'stims:preflight-dismissed';

export async function runCapabilityPreflight(): Promise<CapabilityPreflightResult> {
  return runCapabilityProbe();
}

function focusAfterClose(
  target: string,
  options: { expandSelector?: string } = {},
) {
  const win = typeof window !== 'undefined' ? window : null;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!win || !doc) return;
  win.requestAnimationFrame(() => {
    if (options.expandSelector) {
      const expandable = doc.querySelector(options.expandSelector);
      if (expandable instanceof HTMLDetailsElement) {
        expandable.open = true;
      }
    }
    const element = doc.querySelector(target);
    if (element instanceof HTMLElement) {
      element.focus();
    }
  });
}

export function attachCapabilityPreflight({
  host = document.body,
  heading = 'Quick check',
  backHref,
  onComplete,
  onRetry,
  openOnAttach = true,
  allowCloseWhenBlocked = false,
  showCloseButton = false,
  runPreflight = runCapabilityPreflight,
}: {
  host?: HTMLElement;
  heading?: string;
  backHref?: string;
  onComplete?: (result: CapabilityPreflightResult) => void;
  onRetry?: (result: CapabilityPreflightResult) => void;
  openOnAttach?: boolean;
  allowCloseWhenBlocked?: boolean;
  showCloseButton?: boolean;
  runPreflight?: () => Promise<CapabilityPreflightResult>;
} = {}) {
  const panel = document.createElement('dialog');
  panel.className =
    'control-panel control-panel--floating preflight-panel preflight-dialog';
  panel.setAttribute('aria-live', 'polite');

  const MODAL_PARAM = 'modal';
  const MODAL_VALUE = 'capability-check';

  let restoreFocusTarget: HTMLElement | null = null;
  let closingFromHistory = false;
  let isAttached = false;

  const updateModalParam = (nextValue: string | null, usePush = true) => {
    updateModalQueryParam({
      modalParam: MODAL_PARAM,
      nextValue,
      usePush,
    });
  };

  const isPanelOpen = () => panel.open || panel.hasAttribute('open');
  const setPreflightOpenState = (open: boolean) => {
    if (open) {
      document.documentElement.dataset.preflightOpen = 'true';
    } else {
      delete document.documentElement.dataset.preflightOpen;
    }
  };

  const openPanel = () => {
    if (isPanelOpen()) return;
    rememberToggle.checked = readRememberPreference();
    if (typeof panel.show === 'function') {
      panel.show();
    } else if (typeof panel.showModal === 'function') {
      panel.showModal();
    } else {
      panel.setAttribute('open', 'true');
    }
    setPreflightOpenState(true);
    const focusables = getFocusableElements(panel);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      panel.focus();
    }
  };
  const closePanel = () => {
    if (!isPanelOpen()) return;
    if (typeof panel.close === 'function') {
      panel.close();
    } else {
      panel.removeAttribute('open');
    }
    setPreflightOpenState(false);
  };

  const title = document.createElement('div');
  title.className = 'control-panel__heading';
  title.textContent = heading;
  panel.appendChild(title);

  const description = document.createElement('p');
  description.className = 'control-panel__description';
  description.textContent =
    'We check whether visuals and audio can start here.';
  panel.appendChild(description);

  const sequenceHint = document.createElement('p');
  sequenceHint.className = 'control-panel__microcopy';
  sequenceHint.textContent =
    'If something is blocked, we will point you to the fastest fallback.';
  panel.appendChild(sequenceHint);

  const statusContainer = document.createElement('div');
  statusContainer.className = 'preflight-panel__statuses';
  panel.appendChild(statusContainer);

  const issueContainer = document.createElement('div');
  issueContainer.className = 'preflight-panel__issues-container';
  panel.appendChild(issueContainer);

  const nextStepContainer = document.createElement('div');
  nextStepContainer.className = 'preflight-panel__issues-container';
  panel.appendChild(nextStepContainer);

  const details = document.createElement('details');
  details.className = 'preflight-panel__details';
  const summary = document.createElement('summary');
  summary.className = 'preflight-panel__details-summary';
  summary.textContent = 'Technical details';
  details.appendChild(summary);
  const detailsContent = document.createElement('div');
  detailsContent.className = 'preflight-panel__details-content';
  details.appendChild(detailsContent);
  panel.appendChild(details);

  const rememberWrap = document.createElement('label');
  rememberWrap.className = 'preflight-panel__remember';
  const rememberToggle = document.createElement('input');
  rememberToggle.type = 'checkbox';
  rememberToggle.name = 'preflight-remember';
  rememberToggle.className = 'preflight-panel__remember-toggle';
  const rememberLabel = document.createElement('span');
  rememberLabel.textContent = "Don't show this again this session";
  rememberWrap.append(rememberToggle, rememberLabel);
  panel.appendChild(rememberWrap);

  const setRememberPreference = (enabled: boolean) => {
    try {
      if (enabled) {
        window.sessionStorage.setItem(PREFLIGHT_SESSION_DISMISS_KEY, '1');
      } else {
        window.sessionStorage.removeItem(PREFLIGHT_SESSION_DISMISS_KEY);
      }
    } catch (_error) {
      // Ignore session storage errors.
    }
  };

  const readRememberPreference = () => {
    try {
      return (
        window.sessionStorage.getItem(PREFLIGHT_SESSION_DISMISS_KEY) === '1'
      );
    } catch (_error) {
      return false;
    }
  };

  const actions = document.createElement('div');
  actions.className = 'control-panel__actions control-panel__actions--inline';
  const continueButton = document.createElement('button');
  continueButton.className = 'cta-button primary';
  continueButton.type = 'button';
  continueButton.dataset.preflightPrimaryAction = 'true';
  continueButton.textContent = 'Choose audio';
  continueButton.hidden = true;
  continueButton.addEventListener('click', () => {
    setRememberPreference(rememberToggle.checked);
    closePanel();
  });
  actions.appendChild(continueButton);

  const demoButton = document.createElement('button');
  demoButton.className = 'cta-button ghost';
  demoButton.type = 'button';
  demoButton.textContent = 'Start with demo';
  demoButton.hidden = true;
  demoButton.addEventListener('click', () => {
    setRememberPreference(rememberToggle.checked);
    closePanel();
    focusAfterClose('#use-demo-audio');
  });
  actions.appendChild(demoButton);

  const browserAudioButton = document.createElement('button');
  browserAudioButton.className = 'cta-button ghost';
  browserAudioButton.type = 'button';
  browserAudioButton.textContent = 'Open browser audio';
  browserAudioButton.hidden = true;
  browserAudioButton.addEventListener('click', () => {
    setRememberPreference(rememberToggle.checked);
    closePanel();
    focusAfterClose('#use-tab-audio', {
      expandSelector: '[data-advanced-inputs]',
    });
  });
  actions.appendChild(browserAudioButton);

  let closeButton: HTMLButtonElement | null = null;
  if (showCloseButton) {
    closeButton = document.createElement('button');
    closeButton.className = 'cta-button ghost';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => {
      setRememberPreference(rememberToggle.checked);
      closePanel();
    });
    actions.appendChild(closeButton);
  }
  const performanceButton = document.createElement('button');
  performanceButton.className = 'text-link preflight-secondary-link';
  performanceButton.type = 'button';
  performanceButton.textContent = 'Enable lighter visual mode';
  performanceButton.hidden = true;
  actions.appendChild(performanceButton);
  let backLink: HTMLAnchorElement | null = null;
  if (backHref) {
    backLink = document.createElement('a');
    backLink.className = 'cta-button ghost';
    backLink.href = backHref;
    backLink.textContent = 'Back to Stims';
    bindLibraryBackLink(backLink, { backHref });
    backLink.hidden = true;
    actions.appendChild(backLink);
  }
  panel.appendChild(actions);

  const retryButton = document.createElement('button');
  retryButton.className = 'text-link preflight-retry-link';
  retryButton.type = 'button';
  retryButton.textContent = 'Rerun checks';
  panel.appendChild(retryButton);

  let latestResult: CapabilityPreflightResult | null = null;

  const applyActionPriority = (result: CapabilityPreflightResult | null) => {
    if (!result) {
      continueButton.hidden = true;
      demoButton.hidden = true;
      browserAudioButton.hidden = true;
      if (closeButton) closeButton.hidden = false;
      performanceButton.hidden = true;
      if (backLink) {
        backLink.hidden = true;
        backLink.classList.add('ghost');
        backLink.classList.remove('primary');
      }
      return;
    }

    if (result.canProceed) {
      const hasInlineAudioPanel =
        document.querySelector('#use-demo-audio') instanceof HTMLElement ||
        document.querySelector('#start-audio-btn') instanceof HTMLElement;
      const canShowBrowserAudioShortcut =
        hasInlineAudioPanel &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
        (document.querySelector('#use-tab-audio') instanceof HTMLElement ||
          document.querySelector('#youtube-url') instanceof HTMLElement);
      continueButton.hidden = false;
      continueButton.textContent =
        result.microphone.state === 'granted'
          ? 'Use mic or demo'
          : 'Choose audio';
      demoButton.hidden = !hasInlineAudioPanel;
      browserAudioButton.hidden = !canShowBrowserAudioShortcut;
      if (backLink) {
        backLink.hidden = true;
        backLink.classList.add('ghost');
        backLink.classList.remove('primary');
      }
      if (closeButton) {
        closeButton.hidden = false;
        closeButton.textContent = 'Close';
      }
      performanceButton.hidden = !result.performance.lowPower;
      return;
    }

    if (closeButton) {
      closeButton.textContent = 'Close';
    }
    continueButton.hidden = true;
    demoButton.hidden = true;
    browserAudioButton.hidden = true;
    performanceButton.hidden = true;
    if (backLink) {
      backLink.hidden = false;
      backLink.classList.add('primary');
      backLink.classList.remove('ghost');
      if (closeButton) closeButton.hidden = true;
    } else if (closeButton) {
      closeButton.hidden = false;
    }
  };

  const updatePerformanceButton = (result: CapabilityPreflightResult) => {
    latestResult = result;
    if (!result.canProceed || !result.performance.lowPower) {
      performanceButton.hidden = true;
      performanceButton.disabled = false;
      performanceButton.textContent = 'Enable lighter visual mode';
      return;
    }

    performanceButton.hidden = false;

    const preferences = getActiveRenderPreferences();
    const performanceEnabled =
      (preferences.maxPixelRatio !== null &&
        preferences.maxPixelRatio <=
          result.performance.recommendedMaxPixelRatio) ||
      (preferences.renderScale !== null &&
        preferences.renderScale <= result.performance.recommendedRenderScale);

    if (performanceEnabled) {
      performanceButton.textContent = 'Performance mode enabled';
      performanceButton.disabled = true;
    } else {
      performanceButton.textContent = 'Enable lighter visual mode';
      performanceButton.disabled = false;
    }
  };

  performanceButton.addEventListener('click', () => {
    if (!latestResult) return;
    setRenderPreferences({
      maxPixelRatio: latestResult.performance.recommendedMaxPixelRatio,
      renderScale: latestResult.performance.recommendedRenderScale,
    });
    updatePerformanceButton(latestResult);
  });

  const run = async (isRetry = false) => {
    panel.dataset.state = 'running';
    applyActionPriority(null);
    retryButton.disabled = true;
    const result = await runPreflight();
    panel.dataset.state = result.canProceed ? 'ready' : 'blocked';
    retryButton.disabled = false;
    applyActionPriority(result);
    updatePreflightStatusList(statusContainer, result);
    renderPreflightIssueList(issueContainer, result);
    updatePreflightNextStep(nextStepContainer, result, () => {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((track) => track.stop());
          retryButton.disabled = true;
          await run(true);
        } catch (_error) {
          // Prompt dismissed or blocked; keep existing status and allow retry.
        } finally {
          retryButton.disabled = false;
        }
      })();
    });
    updatePreflightWhyDetails(detailsContent, result);
    updatePerformanceButton(result);
    if (isRetry) {
      onRetry?.(result);
    } else {
      onComplete?.(result);
    }
    return result;
  };

  retryButton.addEventListener('click', () => {
    void run(true);
  });

  panel.addEventListener('cancel', (event) => {
    if (!latestResult?.canProceed && !allowCloseWhenBlocked) {
      event.preventDefault();
    }
  });

  panel.addEventListener('close', () => {
    restoreFocusIfPresent(restoreFocusTarget, panel.ownerDocument);
    if (closingFromHistory) {
      closingFromHistory = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get(MODAL_PARAM) === MODAL_VALUE) {
      window.history.back();
    }
  });

  const handlePopState = () => {
    const params = new URLSearchParams(window.location.search);
    const shouldBeOpen = params.get(MODAL_PARAM) === MODAL_VALUE;
    if (!shouldBeOpen && isPanelOpen()) {
      closingFromHistory = true;
      closePanel();
      return;
    }
    if (shouldBeOpen && !isPanelOpen()) {
      openPanel();
      void run();
    }
  };

  const attach = () => {
    if (isAttached) return;
    host.appendChild(panel);
    isAttached = true;
    if (openOnAttach) {
      restoreFocusTarget =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      openPanel();
      void run();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  const syncOpenState = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(MODAL_PARAM) === MODAL_VALUE && !isPanelOpen()) {
      openPanel();
      void run();
    }
  };

  window.addEventListener('popstate', handlePopState);
  if (openOnAttach) {
    const params = new URLSearchParams(window.location.search);
    if (params.get(MODAL_PARAM) !== MODAL_VALUE) {
      updateModalParam(MODAL_VALUE, true);
    } else {
      updateModalParam(MODAL_VALUE, false);
    }
  } else {
    syncOpenState();
  }

  return {
    run,
    open: (trigger?: HTMLElement | null, { rerun = true } = {}) => {
      restoreFocusTarget =
        trigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      if (!isAttached) {
        attach();
      }
      openPanel();
      const params = new URLSearchParams(window.location.search);
      if (params.get(MODAL_PARAM) !== MODAL_VALUE) {
        updateModalParam(MODAL_VALUE, true);
      } else {
        updateModalParam(MODAL_VALUE, false);
      }
      if (rerun) {
        void run();
      }
    },
    destroy: () => {
      window.removeEventListener('popstate', handlePopState);
      closingFromHistory = true;
      closePanel();
      setPreflightOpenState(false);
      panel.remove();
      const params = new URLSearchParams(window.location.search);
      if (params.get(MODAL_PARAM) === MODAL_VALUE) {
        updateModalParam(null, false);
      }
    },
  };
}
