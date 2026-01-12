import WebGL from 'three/examples/jsm/capabilities/WebGL.js';
import { getRendererCapabilities } from './renderer-capabilities.ts';

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

function checkWebGLAvailability() {
  const hasWebGL =
    typeof WebGL !== 'undefined' &&
    (WebGL as { isWebGLAvailable?: () => boolean }).isWebGLAvailable?.();

  return Boolean(hasWebGL);
}

export async function runCapabilityPreflight(): Promise<CapabilityPreflightResult> {
  const [capabilities, microphone] = await Promise.all([
    getRendererCapabilities().catch((error) => {
      console.warn('Renderer capability probe failed', error);
      return null;
    }),
    getMicrophonePermissionState(),
  ]);

  const hasWebGL = checkWebGLAvailability();

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

  const reducedMotionQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const environment = {
    secureContext:
      typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    reducedMotion: reducedMotionQuery,
    hardwareConcurrency:
      typeof navigator !== 'undefined'
        ? (navigator.hardwareConcurrency ?? null)
        : null,
  };

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

function updateStatusList(
  container: HTMLElement,
  result: CapabilityPreflightResult,
) {
  container.innerHTML = '';

  const rendererStatus = buildStatusBadge(
    'Rendering',
    result.rendering.rendererBackend === 'webgpu'
      ? 'Ready (WebGPU)'
      : result.rendering.rendererBackend === 'webgl'
        ? 'WebGL fallback'
        : 'Unavailable',
    result.rendering.rendererBackend
      ? result.rendering.rendererBackend === 'webgpu'
        ? 'ok'
        : 'warn'
      : 'error',
  );

  const rendererNote = document.createElement('p');
  rendererNote.className = 'preflight-status__note';
  rendererNote.textContent =
    result.rendering.rendererBackend === 'webgpu'
      ? 'Enabled.'
      : result.rendering.rendererBackend === 'webgl'
        ? (result.rendering.webgpuFallbackReason ?? 'Using WebGL.')
        : 'GPU acceleration not detected.';
  rendererStatus.appendChild(rendererNote);

  const microphoneStatus = buildStatusBadge(
    'Microphone',
    !result.microphone.supported
      ? 'Unavailable'
      : result.microphone.state === 'granted'
        ? 'Ready'
        : result.microphone.state === 'denied'
          ? 'Blocked'
          : 'Will prompt on start',
    !result.microphone.supported || result.microphone.state === 'denied'
      ? 'warn'
      : result.microphone.state === 'granted'
        ? 'ok'
        : 'warn',
  );

  const microphoneNote = document.createElement('p');
  microphoneNote.className = 'preflight-status__note';
  microphoneNote.textContent =
    result.microphone.reason ??
    (result.microphone.state === 'granted'
      ? 'Ready.'
      : 'The browser will prompt for access.');
  microphoneStatus.appendChild(microphoneNote);

  const environmentStatus = buildStatusBadge(
    'Environment',
    result.environment.secureContext ? 'Secure context' : 'Insecure context',
    result.environment.secureContext ? 'ok' : 'warn',
  );

  const environmentNote = document.createElement('p');
  environmentNote.className = 'preflight-status__note';
  environmentNote.textContent = result.environment.reducedMotion
    ? 'Reduced motion active.'
    : 'Full effects enabled.';
  environmentStatus.appendChild(environmentNote);

  [rendererStatus, microphoneStatus, environmentStatus].forEach((status) => {
    container.appendChild(status);
  });
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
    ? 'Action needed before loading'
    : 'Heads up';
  container.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'preflight-panel__issues';
  issues.forEach((issue) => {
    const item = document.createElement('li');
    item.textContent = issue;
    list.appendChild(item);
  });
  container.appendChild(list);
}

export function attachCapabilityPreflight({
  host = document.body,
  heading = 'Quick system check',
  onComplete,
  onRetry,
}: {
  host?: HTMLElement;
  heading?: string;
  onComplete?: (result: CapabilityPreflightResult) => void;
  onRetry?: (result: CapabilityPreflightResult) => void;
} = {}) {
  const panel = document.createElement('section');
  panel.className = 'control-panel control-panel--floating preflight-panel';
  panel.setAttribute('aria-live', 'polite');

  const title = document.createElement('div');
  title.className = 'control-panel__heading';
  title.textContent = heading;
  panel.appendChild(title);

  const description = document.createElement('p');
  description.className = 'control-panel__description';
  description.textContent = 'Quick check for graphics and microphone support.';
  panel.appendChild(description);

  const statusContainer = document.createElement('div');
  statusContainer.className = 'preflight-panel__statuses';
  panel.appendChild(statusContainer);

  const issueContainer = document.createElement('div');
  issueContainer.className = 'preflight-panel__issues-container';
  panel.appendChild(issueContainer);

  const actions = document.createElement('div');
  actions.className = 'control-panel__actions control-panel__actions--inline';
  const retryButton = document.createElement('button');
  retryButton.className = 'cta-button';
  retryButton.type = 'button';
  retryButton.textContent = 'Retry checks';
  actions.appendChild(retryButton);
  panel.appendChild(actions);

  const run = async (isRetry = false) => {
    panel.dataset.state = 'running';
    retryButton.disabled = true;
    const result = await runCapabilityPreflight();
    panel.dataset.state = result.canProceed ? 'ready' : 'blocked';
    retryButton.disabled = false;
    updateStatusList(statusContainer, result);
    renderIssueList(issueContainer, result);
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

  const attach = () => host.appendChild(panel);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }

  void run();

  return {
    run,
    destroy: () => panel.remove(),
  };
}
