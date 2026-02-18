import { isMobileDevice } from '../utils/device-detect';
import {
  getActiveRenderPreferences,
  setRenderPreferences,
} from './render-preferences.ts';
import {
  getRendererCapabilities,
  getRenderingSupport,
} from './renderer-capabilities.ts';

export const PREFLIGHT_SESSION_DISMISS_KEY = 'stims:preflight-dismissed';

export type CapabilityPreflightResult = {
  rendering: {
    hasWebGL: boolean;
    rendererBackend: 'webgl' | 'webgpu' | null;
    webgpuFallbackReason: string | null;
    triedWebGPU: boolean;
    shouldRetryWebGPU: boolean;
  };
  microphone: {
    supported: boolean;
    state: PermissionState | 'unsupported' | 'error';
    reason: string | null;
  };
  environment: {
    secureContext: boolean;
    reducedMotion: boolean;
    hardwareConcurrency: number | null;
  };
  performance: {
    lowPower: boolean;
    reason: string | null;
    recommendedMaxPixelRatio: number;
    recommendedRenderScale: number;
  };
  blockingIssues: string[];
  warnings: string[];
  canProceed: boolean;
};

async function getMicrophonePermissionState() {
  if (typeof navigator === 'undefined') {
    return {
      supported: false,
      state: 'unsupported' as const,
      reason: 'Navigator unavailable in this environment.',
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      state: 'unsupported' as const,
      reason: 'This browser cannot capture microphone audio.',
    };
  }

  if (!navigator.permissions?.query) {
    return {
      supported: true,
      state: 'prompt' as const,
      reason: null,
    };
  }

  try {
    const result = await navigator.permissions.query({
      // Firefox throws unless this is cast to PermissionName.
      name: 'microphone' as PermissionName,
    });
    return {
      supported: true,
      state: result.state,
      reason:
        result.state === 'denied'
          ? 'Microphone access is blocked for this site.'
          : null,
    };
  } catch (error) {
    console.warn('Microphone permission probe failed', error);
    return {
      supported: true,
      state: 'error' as const,
      reason:
        'Unable to read microphone permission state. The browser will still prompt when needed.',
    };
  }
}

const isMobileUserAgent = isMobileDevice();

function getPerformanceProfile() {
  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null)
      : null;
  const hardwareConcurrency =
    typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency ?? null)
      : null;
  const reducedMotionQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const reasons: string[] = [];
  if (isMobileUserAgent) reasons.push('mobile device detected');
  if (reducedMotionQuery) reasons.push('reduced motion preference');
  if (deviceMemory !== null && deviceMemory <= 4) {
    reasons.push('limited device memory');
  }
  if (hardwareConcurrency !== null && hardwareConcurrency <= 4) {
    reasons.push('limited CPU cores');
  }

  const lowPower = reasons.length > 0;

  return {
    lowPower,
    reason: reasons.length ? reasons.join(', ') : null,
    reducedMotion: reducedMotionQuery,
  };
}

export async function runCapabilityPreflight(): Promise<CapabilityPreflightResult> {
  const [capabilities, microphone] = await Promise.all([
    getRendererCapabilities().catch((error) => {
      console.warn('Renderer capability probe failed', error);
      return null;
    }),
    getMicrophonePermissionState(),
  ]);

  const { hasWebGL } = getRenderingSupport();

  const renderingBackend =
    capabilities?.preferredBackend ?? (hasWebGL ? 'webgl' : null);
  const webgpuFallbackReason = capabilities?.fallbackReason ?? null;

  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!renderingBackend) {
    blockingIssues.push('Graphics acceleration is unavailable (WebGL/WebGPU).');
  } else if (renderingBackend === 'webgl' && webgpuFallbackReason) {
    warnings.push(webgpuFallbackReason);
  }

  if (!microphone.supported) {
    warnings.push('Microphone APIs are unavailable in this browser.');
  } else if (microphone.state === 'denied') {
    warnings.push(
      'Microphone access is blocked; visuals will fall back to demo audio.',
    );
  }

  const performanceProfile = getPerformanceProfile();

  const environment = {
    secureContext:
      typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    reducedMotion: performanceProfile.reducedMotion,
    hardwareConcurrency:
      typeof navigator !== 'undefined'
        ? (navigator.hardwareConcurrency ?? null)
        : null,
  };

  const performance = {
    lowPower: performanceProfile.lowPower,
    reason: performanceProfile.reason,
    recommendedMaxPixelRatio: 1.25,
    recommendedRenderScale: 0.9,
  };

  if (performance.lowPower) {
    warnings.push(
      'Performance mode recommended for smoother visuals on this device.',
    );
  }

  const canProceed = blockingIssues.length === 0;

  return {
    rendering: {
      hasWebGL,
      rendererBackend: renderingBackend,
      webgpuFallbackReason,
      triedWebGPU: capabilities?.triedWebGPU ?? false,
      shouldRetryWebGPU: capabilities?.shouldRetryWebGPU ?? false,
    },
    microphone,
    environment,
    performance,
    blockingIssues,
    warnings,
    canProceed,
  };
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
      value: 'Microphone is blocked',
      note: 'Update site permissions or continue with alternate audio.',
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
    value: 'Microphone will prompt on start',
    note: 'Grant access when asked, or use alternate audio.',
    variant: 'warn',
  };
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
      label: 'Performance check',
      summary: getPerformanceCheckSummary(result),
      className: 'preflight-status--primary',
    },
    {
      label: 'Audio input',
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
    items.push('WebGPU is available for the highest fidelity visuals.');
  } else if (result.rendering.rendererBackend === 'webgl') {
    items.push(
      result.rendering.webgpuFallbackReason
        ? `WebGPU fallback reason: ${result.rendering.webgpuFallbackReason}`
        : 'WebGPU is unavailable, so WebGL is used for compatibility.',
    );
  } else {
    items.push('No GPU acceleration detected; try another browser or device.');
  }

  if (!result.microphone.supported) {
    items.push(
      'Microphone capture is unavailable; use demo, tab, or YouTube audio.',
    );
  } else if (result.microphone.state === 'denied') {
    items.push(
      'Microphone access is blocked; update permissions or use demo audio.',
    );
  } else if (result.microphone.state === 'error') {
    items.push(
      'Permission state could not be read; the browser will still prompt when needed.',
    );
  } else if (result.microphone.state === 'prompt') {
    items.push('You will be prompted for microphone access when starting.');
  } else {
    items.push('Microphone permission is granted for live audio.');
  }

  if (!result.environment.secureContext) {
    items.push(
      'This page is not in a secure context, so some APIs may be limited.',
    );
  } else {
    items.push('Secure browsing mode is active, so modern features can run.');
  }

  items.push(
    result.environment.reducedMotion
      ? 'Reduced motion preference is enabled; effects will soften.'
      : 'No reduced-motion preference detected in system settings.',
  );

  if (result.performance.lowPower) {
    items.push(
      `Performance mode is recommended due to ${result.performance.reason ?? 'lower-power hardware'}.`,
    );
  } else {
    items.push('Device should handle full-quality rendering.');
  }

  const list = document.createElement('ul');
  list.className = 'preflight-panel__details-list';
  items.forEach((item) => {
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
      'This device cannot access WebGL/WebGPU, so 3D visuals cannot render. Try a supported browser or jump back to toys that can run with demo audio.';
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
    fallbackLink.href = 'index.html?filters=capability:demoAudio';
    fallbackLink.textContent = 'Browse demo-audio toys';
    fallbackItem.appendChild(fallbackLink);
    linkList.appendChild(fallbackItem);

    support.appendChild(linkList);
    container.appendChild(support);
  }
}

export function attachCapabilityPreflight({
  host = document.body,
  heading = 'Quick system check',
  backHref,
  onComplete,
  onRetry,
  openOnAttach = true,
  allowCloseWhenBlocked = false,
  showCloseButton = false,
}: {
  host?: HTMLElement;
  heading?: string;
  backHref?: string;
  onComplete?: (result: CapabilityPreflightResult) => void;
  onRetry?: (result: CapabilityPreflightResult) => void;
  openOnAttach?: boolean;
  allowCloseWhenBlocked?: boolean;
  showCloseButton?: boolean;
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
  const openPanel = () => {
    if (isPanelOpen()) return;
    rememberToggle.checked = readRememberPreference();
    if (typeof panel.showModal === 'function') {
      panel.showModal();
    } else {
      panel.setAttribute('open', 'true');
    }
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
    focusCleanup?.();
    focusCleanup = null;
  };

  const title = document.createElement('div');
  title.className = 'control-panel__heading';
  title.textContent = heading;
  panel.appendChild(title);

  const description = document.createElement('p');
  description.className = 'control-panel__description';
  description.textContent = 'One short performance check before audio setup.';
  panel.appendChild(description);

  const sequenceHint = document.createElement('p');
  sequenceHint.className = 'control-panel__microcopy';
  sequenceHint.textContent = 'Tip: demo audio is usually the fastest start.';
  panel.appendChild(sequenceHint);

  const statusContainer = document.createElement('div');
  statusContainer.className = 'preflight-panel__statuses';
  panel.appendChild(statusContainer);

  const issueContainer = document.createElement('div');
  issueContainer.className = 'preflight-panel__issues-container';
  panel.appendChild(issueContainer);

  const details = document.createElement('details');
  details.className = 'preflight-panel__details';
  const summary = document.createElement('summary');
  summary.className = 'preflight-panel__details-summary';
  summary.textContent = 'Check details';
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
  rememberLabel.textContent = 'Skip this check for this session';
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
  performanceButton.className = 'cta-button ghost';
  performanceButton.type = 'button';
  performanceButton.textContent = 'Enable lighter visual mode';
  performanceButton.hidden = true;
  actions.appendChild(performanceButton);
  let backLink: HTMLAnchorElement | null = null;
  if (backHref) {
    backLink = document.createElement('a');
    backLink.className = 'cta-button ghost';
    backLink.href = backHref;
    backLink.textContent = 'Browse ready-to-run toys';
    backLink.hidden = true;
    actions.appendChild(backLink);
  }
  panel.appendChild(actions);

  const retryButton = document.createElement('button');
  retryButton.className = 'text-link preflight-retry-link';
  retryButton.type = 'button';
  retryButton.textContent = 'Check again';
  panel.appendChild(retryButton);

  let latestResult: CapabilityPreflightResult | null = null;

  const applyActionPriority = (result: CapabilityPreflightResult | null) => {
    if (!result) {
      if (closeButton) closeButton.hidden = false;
      performanceButton.hidden = true;
      if (backLink) backLink.hidden = true;
      return;
    }

    if (result.canProceed) {
      if (backLink) backLink.hidden = true;
      if (closeButton) {
        closeButton.hidden = false;
        closeButton.textContent = 'Start audio options';
      }
      performanceButton.hidden = !result.performance.lowPower;
      return;
    }

    if (closeButton) {
      closeButton.textContent = 'Close';
    }
    performanceButton.hidden = true;
    if (backLink) {
      backLink.hidden = false;
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
    const result = await runCapabilityPreflight();
    panel.dataset.state = result.canProceed ? 'ready' : 'blocked';
    retryButton.disabled = false;
    applyActionPriority(result);
    updateStatusList(statusContainer, result);
    renderIssueList(issueContainer, result);
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
    open: (trigger?: HTMLElement | null) => {
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
      void run();
    },
    destroy: () => {
      window.removeEventListener('popstate', handlePopState);
      closingFromHistory = true;
      closePanel();
      panel.remove();
      const params = new URLSearchParams(window.location.search);
      if (params.get(MODAL_PARAM) === MODAL_VALUE) {
        updateModalParam(null, false);
      }
    },
  };
}
