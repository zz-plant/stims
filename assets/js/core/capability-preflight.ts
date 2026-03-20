import { bindLibraryBackLink } from '../utils/library-back-navigation.ts';
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

function buildStatusBadge(
  label: string,
  value: string,
  variant: 'ok' | 'warn' | 'error',
) {
  const badge = document.createElement('div');
  badge.className = 'preflight-status';
  badge.dataset.variant = variant;

  const title = document.createElement('p');
  title.className = 'preflight-status__label';
  title.textContent = label;
  badge.appendChild(title);

  const state = document.createElement('p');
  state.className = 'preflight-status__value';
  state.textContent = value;
  badge.appendChild(state);

  return badge;
}

type StatusCardSummary = {
  value: string;
  note: string;
  variant: 'ok' | 'warn' | 'error';
};

function getPerformanceCheckSummary(
  result: CapabilityPreflightResult,
): StatusCardSummary {
  if (!result.rendering.rendererBackend) {
    return {
      value: 'Unavailable on this device',
      note: 'Graphics acceleration was not detected.',
      variant: 'error',
    };
  }

  if (result.performance.lowPower) {
    return {
      value: 'Recommended: lighter visuals',
      note: 'Use reduced quality for smoother playback on this device.',
      variant: 'warn',
    };
  }

  if (result.performance.recommendedQualityPresetId === 'hi-fi') {
    return {
      value: 'Ready for hi-fi visuals',
      note: 'This GPU can handle the richer WebGPU preset by default.',
      variant: 'ok',
    };
  }

  if (result.rendering.rendererBackend === 'webgl') {
    return {
      value: 'Ready in compatibility mode',
      note: 'WebGL is active and optimized for compatibility.',
      variant: 'warn',
    };
  }

  return {
    value: 'Ready for full visuals',
    note: 'WebGPU is available for best-quality rendering.',
    variant: 'ok',
  };
}

function getAudioInputSummary(
  result: CapabilityPreflightResult,
): StatusCardSummary {
  if (!result.microphone.supported) {
    return {
      value: 'Use demo, tab, or YouTube audio',
      note: 'Microphone APIs are unavailable in this browser.',
      variant: 'warn',
    };
  }

  if (result.microphone.state === 'denied') {
    return {
      value: 'Continue with demo audio now',
      note: 'You can keep going with demo audio, then enable microphone access in site settings anytime.',
      variant: 'warn',
    };
  }

  if (result.microphone.state === 'granted') {
    return {
      value: 'Microphone ready',
      note: 'Live audio can start immediately.',
      variant: 'ok',
    };
  }

  return {
    value: 'Microphone permission check pending',
    note: 'You can grant access from this panel, or use alternate audio.',
    variant: 'warn',
  };
}

type NextStepContent = {
  title: string;
  steps: string[];
  showGrantAction: boolean;
};

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

function getNextStepContent(
  result: CapabilityPreflightResult,
): NextStepContent {
  if (!result.canProceed) {
    return {
      title: 'Best next step',
      steps: result.blockingIssues.length
        ? [
            'Use a browser or device with graphics acceleration enabled.',
            'Or head back to Stims to review the browser requirements first.',
          ]
        : ['Review the guidance below before continuing.'],
      showGrantAction: false,
    };
  }

  if (!result.microphone.supported) {
    return {
      title: 'Best next step',
      steps: [
        'Continue to audio setup.',
        'Start with demo audio, tab audio, or YouTube audio.',
      ],
      showGrantAction: false,
    };
  }

  if (result.microphone.state === 'granted') {
    return {
      title: 'Best next step',
      steps: ['Continue to audio setup.', 'Mic mode is ready immediately.'],
      showGrantAction: false,
    };
  }

  if (result.microphone.state === 'denied') {
    return {
      title: 'Best next step',
      steps: [
        'Continue with demo audio now.',
        'Turn microphone access back on in site settings whenever you want live input.',
      ],
      showGrantAction: false,
    };
  }

  return {
    title: 'Best next step',
    steps: [
      'Continue to audio setup.',
      'Allow microphone access there, or skip it and start with demo audio.',
    ],
    showGrantAction: true,
  };
}

function updateNextStep(
  container: HTMLElement,
  result: CapabilityPreflightResult,
  onGrantMicrophone: (() => void) | null,
) {
  container.innerHTML = '';

  const content = getNextStepContent(result);

  const heading = document.createElement('p');
  heading.className = 'preflight-panel__eyebrow';
  heading.textContent = content.title;
  container.appendChild(heading);

  const list = document.createElement('ol');
  list.className = 'preflight-panel__issues';

  const addStep = (label: string) => {
    const item = document.createElement('li');
    item.textContent = label;
    list.appendChild(item);
  };

  content.steps.forEach(addStep);

  container.appendChild(list);

  if (onGrantMicrophone && content.showGrantAction) {
    const grantButton = document.createElement('button');
    grantButton.type = 'button';
    grantButton.className = 'cta-button ghost';
    grantButton.textContent = 'Grant microphone access';
    grantButton.addEventListener('click', onGrantMicrophone);
    container.appendChild(grantButton);
  }
}

function updateStatusList(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';

  const cards: Array<{
    label: string;
    summary: StatusCardSummary;
    className: string;
  }> = [
    {
      label: 'Visuals',
      summary: getPerformanceCheckSummary(result),
      className: 'preflight-status--primary',
    },
    {
      label: 'Audio',
      summary: getAudioInputSummary(result),
      className: 'preflight-status--supporting',
    },
  ];

  cards.forEach(({ label, summary, className }) => {
    const status = buildStatusBadge(label, summary.value, summary.variant);
    status.classList.add(className);

    const note = document.createElement('p');
    note.className = 'preflight-status__note';
    note.textContent = summary.note;
    status.appendChild(note);

    container.appendChild(status);
  });
}

function updateWhyDetails(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';

  const items: string[] = [];

  if (result.rendering.rendererBackend === 'webgpu') {
    items.push('High-fidelity visuals are available on this device.');
  } else if (result.rendering.rendererBackend === 'webgl') {
    items.push(
      result.rendering.webgpuFallbackReason
        ? `Compatibility mode is active because ${result.rendering.webgpuFallbackReason}.`
        : 'Compatibility mode is active for broader browser support.',
    );
  } else {
    items.push('Graphics acceleration was not detected on this device.');
  }

  if (!result.microphone.supported) {
    items.push(
      'Microphone capture is unavailable here, so alternate audio options are recommended.',
    );
  } else if (result.microphone.state === 'denied') {
    items.push(
      'Microphone access is off right now; demo audio is the easiest fallback.',
    );
  } else if (
    result.microphone.state === 'prompt' ||
    result.microphone.state === 'unknown'
  ) {
    items.push(
      'Microphone access has not been confirmed yet and may prompt on start.',
    );
  } else {
    items.push('Microphone access is already available for live input.');
  }

  if (!result.environment.secureContext) {
    items.push(
      'This page is not running in a secure browser context, so some features may stay limited.',
    );
  }

  items.push(
    result.environment.reducedMotion
      ? 'Reduced motion preference is enabled; effects will soften.'
      : 'Standard motion effects are enabled.',
  );

  items.push(
    result.performance.recommendedQualityPresetId === 'hi-fi'
      ? 'Hi-fi visuals are recommended for this device.'
      : result.performance.recommendedQualityPresetId === 'performance'
        ? 'Lighter visuals are recommended for smoother playback.'
        : 'Balanced visuals are recommended for this device.',
  );

  const list = document.createElement('ul');
  list.className = 'preflight-panel__details-list';
  items.slice(0, 4).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
  container.appendChild(list);
}

function renderIssueList(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';
  const issues = result.blockingIssues.length
    ? result.blockingIssues
    : result.warnings;
  if (!issues.length) {
    const success = document.createElement('p');
    success.className = 'preflight-panel__success';
    success.textContent = 'System check passed.';
    container.appendChild(success);
    return;
  }

  const heading = document.createElement('p');
  heading.className = 'preflight-panel__eyebrow';
  heading.textContent = result.blockingIssues.length
    ? 'Action required'
    : 'Before you continue';
  container.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'preflight-panel__issues';
  issues.forEach((issue) => {
    const item = document.createElement('li');
    item.textContent = issue;
    list.appendChild(item);
  });
  container.appendChild(list);

  if (result.blockingIssues.length) {
    const support = document.createElement('div');
    support.className = 'preflight-panel__support';

    const supportTitle = document.createElement('p');
    supportTitle.className = 'preflight-panel__support-title';
    supportTitle.textContent = 'Why this won’t run here';
    support.appendChild(supportTitle);

    const supportText = document.createElement('p');
    supportText.className = 'preflight-panel__support-text';
    supportText.textContent =
      'This device cannot access WebGL/WebGPU, so 3D visuals cannot render. Try a supported browser or head back to Stims for the browser requirements and launch notes.';
    support.appendChild(supportText);

    const linkList = document.createElement('ul');
    linkList.className = 'preflight-panel__support-links';

    const browserItem = document.createElement('li');
    const browserLink = document.createElement('a');
    browserLink.href = 'https://webglreport.com/';
    browserLink.target = '_blank';
    browserLink.rel = 'noreferrer';
    browserLink.textContent = 'Check supported browsers (WebGL report)';
    browserItem.appendChild(browserLink);
    linkList.appendChild(browserItem);

    const fallbackItem = document.createElement('li');
    const fallbackLink = document.createElement('a');
    fallbackLink.href = '/#experience';
    fallbackLink.textContent = 'Review supported-browser guidance';
    fallbackItem.appendChild(fallbackLink);
    linkList.appendChild(fallbackItem);

    support.appendChild(linkList);
    container.appendChild(support);
  }
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
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const getFocusableElements = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('aria-hidden'));

  const trapFocus = (container: HTMLElement) => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = getFocusableElements(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = container.ownerDocument.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || container.contains(event.target)) {
        return;
      }
      const items = getFocusableElements(container);
      if (items.length > 0) {
        items[0].focus();
      } else {
        container.focus();
      }
    };

    container.addEventListener('keydown', handleKeydown);
    container.ownerDocument.addEventListener('focusin', handleFocusIn);

    return () => {
      container.removeEventListener('keydown', handleKeydown);
      container.ownerDocument.removeEventListener('focusin', handleFocusIn);
    };
  };

  let restoreFocusTarget: HTMLElement | null = null;
  let focusCleanup: (() => void) | null = null;
  let closingFromHistory = false;
  let isAttached = false;

  const resolvePathname = () => {
    if (window.location?.pathname) return window.location.pathname;
    if (window.location?.href) {
      try {
        return new URL(window.location.href).pathname;
      } catch (_error) {
        return '/';
      }
    }
    return '/';
  };

  const updateModalParam = (nextValue: string | null, usePush = true) => {
    const params = new URLSearchParams(window.location.search);
    if (nextValue) {
      params.set(MODAL_PARAM, nextValue);
    } else {
      params.delete(MODAL_PARAM);
    }
    const nextUrl = `${resolvePathname()}${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    try {
      if (usePush) {
        window.history.pushState({ modal: nextValue }, '', nextUrl);
      } else {
        window.history.replaceState({ modal: nextValue }, '', nextUrl);
      }
    } catch (_error) {
      // Ignore history errors in non-browser environments.
    }
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
    if (typeof panel.showModal === 'function') {
      panel.showModal();
    } else {
      panel.setAttribute('open', 'true');
    }
    setPreflightOpenState(true);
    focusCleanup?.();
    focusCleanup = trapFocus(panel);
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
    focusCleanup?.();
    focusCleanup = null;
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
    updateStatusList(statusContainer, result);
    renderIssueList(issueContainer, result);
    updateNextStep(nextStepContainer, result, () => {
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
    updateWhyDetails(detailsContent, result);
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
    if (
      restoreFocusTarget &&
      panel.ownerDocument.contains(restoreFocusTarget)
    ) {
      restoreFocusTarget.focus();
    }
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
