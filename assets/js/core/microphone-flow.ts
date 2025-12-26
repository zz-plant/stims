import {
  AudioAccessError,
  getMicrophonePermissionState,
} from '../utils/audio-handler';

type FlowMode = 'microphone' | 'sample';

type FlowStatus = 'info' | 'error' | 'success';

type FlowAnalytics = {
  track?: (event: string, detail?: Record<string, unknown>) => void;
  log?: (message: string, detail?: unknown) => void;
};

export type MicrophoneFlowOptions = {
  startButton?: HTMLButtonElement | null;
  fallbackButton?: HTMLButtonElement | null;
  statusElement?: HTMLElement | null;
  toastHost?: HTMLElement | null;
  timeoutMs?: number;
  requestMicrophone: () => Promise<unknown>;
  requestSampleAudio?: () => Promise<unknown>;
  analytics?: FlowAnalytics;
  onSuccess?: (mode: FlowMode) => void;
  onError?: (mode: FlowMode, error: unknown) => void;
};

function setStatus(
  element: HTMLElement | null | undefined,
  message: string,
  variant: FlowStatus = 'info'
) {
  if (!element) return;
  element.textContent = message;
  element.dataset.variant = variant;
  element.hidden = !message;
}

function toggleButtons(
  startButton: HTMLButtonElement | null | undefined,
  fallbackButton: HTMLButtonElement | null | undefined,
  disabled: boolean
) {
  if (startButton) startButton.disabled = disabled;
  if (fallbackButton) fallbackButton.disabled = disabled;
}

function describeError(error: unknown, mode: FlowMode) {
  if (error instanceof AudioAccessError) {
    if (error.reason === 'denied') {
      return 'Microphone access is blocked. Allow it in your browser or system privacy settings, then retry or load the demo audio.';
    }
    if (error.reason === 'timeout') {
      return 'Microphone request timed out. Re-open permissions and click retry, or load the demo audio fallback.';
    }
    if (error.reason === 'unsupported') {
      return 'This browser cannot capture microphone audio. Switch browsers or load the demo audio to keep exploring.';
    }
    return 'Microphone access is unavailable right now. Retry, or continue with the demo audio fallback.';
  }

  if (error instanceof Error && /timed out/i.test(error.message)) {
    return 'Microphone request timed out. Re-open permissions and click retry, or load the demo audio fallback.';
  }

  return mode === 'sample'
    ? 'Demo audio could not be loaded. Please retry.'
    : 'We could not access your microphone. Retry or load the demo audio.';
}

function track(
  analytics: FlowAnalytics | undefined,
  event: string,
  detail?: Record<string, unknown>
) {
  analytics?.track?.(event, detail);
  analytics?.log?.(event, detail);
}

function createToastHost(host: HTMLElement | null | undefined) {
  if (!host) return null;
  const toast = host.ownerDocument.createElement('div');
  toast.dataset.audioToast = 'true';
  toast.setAttribute('role', 'alert');
  toast.style.position = 'fixed';
  toast.style.bottom = '16px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.padding = '12px 14px';
  toast.style.maxWidth = '420px';
  toast.style.background = 'rgba(20, 24, 34, 0.95)';
  toast.style.border = '1px solid rgba(255, 82, 130, 0.8)';
  toast.style.borderRadius = '12px';
  toast.style.color = '#f9f9f9';
  toast.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.45)';
  toast.style.zIndex = '9999';
  toast.style.lineHeight = '1.4';
  toast.style.textAlign = 'center';
  return toast;
}

async function guardDeniedPermission() {
  const permissionState = await getMicrophonePermissionState();
  if (permissionState === 'denied') {
    throw new AudioAccessError(
      'denied',
      'Microphone access is blocked. Update permissions to continue.'
    );
  }

  return permissionState;
}

export function setupMicrophonePermissionFlow(options: MicrophoneFlowOptions) {
  const {
    startButton,
    fallbackButton,
    statusElement,
    toastHost = typeof document !== 'undefined' ? document.body : null,
    requestMicrophone,
    requestSampleAudio,
    analytics,
    timeoutMs = 8000,
    onSuccess,
    onError,
  } = options;

  let pending = false;
  const originalStartLabel = startButton?.textContent ?? null;
  const originalStartAriaLabel = startButton?.getAttribute('aria-label');
  let toastElement: HTMLElement | null = null;

  const showFallback = () => {
    if (fallbackButton) {
      fallbackButton.hidden = false;
    }
  };

  const showToast = (message: string, variant: FlowStatus = 'error') => {
    if (!toastHost) return;
    if (toastElement?.isConnected) toastElement.remove();
    toastElement = createToastHost(toastHost);
    if (!toastElement) return;
    toastElement.dataset.variant = variant;
    toastElement.textContent = message;
    toastHost.appendChild(toastElement);

    globalThis.setTimeout(() => {
      toastElement?.remove();
      toastElement = null;
    }, 7000);
  };

  const runRequest = async (mode: FlowMode) => {
    if (pending) return;
    pending = true;
    toggleButtons(startButton, fallbackButton, true);

    const timeoutError = new AudioAccessError(
      'timeout',
      'Microphone request timed out.'
    );

    const withTimeout = async (promise: Promise<unknown>) => {
      let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = globalThis.setTimeout(
          () => reject(timeoutError),
          timeoutMs
        );
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutHandle) globalThis.clearTimeout(timeoutHandle);
      }
    };

    let permissionState: PermissionState | undefined;

    try {
      permissionState =
        mode === 'microphone' ? await guardDeniedPermission() : undefined;

      track(analytics, 'microphone_request_started', {
        mode,
        permissionState: permissionState ?? 'unknown',
      });

      const request =
        mode === 'sample'
          ? (requestSampleAudio ?? requestMicrophone)
          : requestMicrophone;

      if (!request) {
        throw new Error('No audio request handler registered.');
      }

      setStatus(
        statusElement,
        mode === 'sample'
          ? 'Loading demo audio (no microphone needed)...'
          : 'Requesting microphone access...',
        'info'
      );

      await withTimeout(request());

      setStatus(
        statusElement,
        mode === 'sample'
          ? 'Demo audio connected. Visuals will react to the procedural track.'
          : 'Microphone connected! Enjoy the visuals.',
        'success'
      );

      if (mode === 'microphone' && fallbackButton) {
        fallbackButton.hidden = true;
      }

      if (startButton) {
        if (originalStartLabel !== null) {
          startButton.textContent = originalStartLabel;
        }
        if (originalStartAriaLabel === null) {
          startButton.removeAttribute('aria-label');
        } else {
          startButton.setAttribute('aria-label', originalStartAriaLabel);
        }
        delete startButton.dataset.state;
      }

      track(analytics, 'microphone_request_succeeded', {
        mode,
        permissionState: permissionState ?? 'unknown',
      });

      onSuccess?.(mode);
    } catch (error) {
      track(analytics, 'microphone_request_failed', {
        mode,
        permissionState: permissionState ?? 'unknown',
        message: error instanceof Error ? error.message : 'unknown',
      });

      setStatus(statusElement, describeError(error, mode), 'error');
      showFallback();

      if (startButton && mode === 'microphone') {
        startButton.textContent = 'Retry microphone access';
        startButton.dataset.state = 'retry';
        startButton.setAttribute(
          'aria-label',
          `${startButton.textContent}. Update site permissions, then click to try again.`
        );
      }

      if (mode === 'microphone') {
        showToast(
          'Microphone was blocked or timed out. Re-open permissions in your browser bar, then press Retry microphone or load the demo audio.',
          'error'
        );
      }
      onError?.(mode, error);
      throw error;
    } finally {
      pending = false;
      toggleButtons(startButton, fallbackButton, false);
    }
  };

  const handleStartClick = () => {
    void runRequest('microphone');
  };

  const handleFallbackClick = () => {
    void runRequest('sample');
  };

  startButton?.addEventListener('click', handleStartClick);
  fallbackButton?.addEventListener('click', handleFallbackClick);

  const dispose = () => {
    startButton?.removeEventListener('click', handleStartClick);
    fallbackButton?.removeEventListener('click', handleFallbackClick);
  };

  return {
    startMicrophoneRequest: () => runRequest('microphone'),
    startSampleAudio: () => runRequest('sample'),
    setStatus: (message: string, variant: FlowStatus = 'info') =>
      setStatus(statusElement, message, variant),
    dispose,
    teardown: dispose,
  };
}
