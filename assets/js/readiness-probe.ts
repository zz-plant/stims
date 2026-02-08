import { getRenderingSupport } from './utils/rendering-support';

const STATUS = {
  success: 'success',
  warn: 'warn',
  error: 'error',
};

type StatusKey = 'render' | 'mic' | 'motion' | 'reduced';
type StatusState = (typeof STATUS)[keyof typeof STATUS];
type StatusResult = {
  state: StatusState;
  message: string;
  detail?: string;
};

const STATUS_LABELS = {
  render: 'Graphics acceleration',
  mic: 'Microphone input',
  motion: 'Motion controls',
  reduced: 'Reduced motion preference',
};

const selectStatusNodes = () => ({
  dots: {
    render: document.querySelector('[data-status-dot="render"]'),
    mic: document.querySelector('[data-status-dot="mic"]'),
    motion: document.querySelector('[data-status-dot="motion"]'),
    reduced: document.querySelector('[data-status-dot="reduced"]'),
  },
  notes: {
    render: document.querySelector('[data-status-note="render"]'),
    mic: document.querySelector('[data-status-note="mic"]'),
    motion: document.querySelector('[data-status-note="motion"]'),
    reduced: document.querySelector('[data-status-note="reduced"]'),
  },
});

const applyStatus = (
  key: StatusKey,
  state: StatusState,
  message: string,
  detail?: string,
) => {
  const { dots, notes } = selectStatusNodes();
  const dot = dots[key];
  const note = notes[key];
  const label = STATUS_LABELS[key];
  const HTMLElementCtor = globalThis.HTMLElement;
  const ariaMessage = detail
    ? `${label}: ${message}. ${detail}`
    : `${label}: ${message}`;

  if (HTMLElementCtor && dot instanceof HTMLElementCtor) {
    dot.dataset.status = state;
    dot.setAttribute('aria-label', ariaMessage);
    if (detail) {
      dot.setAttribute('title', detail);
    } else {
      dot.removeAttribute('title');
    }
  }

  if (HTMLElementCtor && note instanceof HTMLElementCtor) {
    note.textContent = message;
    note.setAttribute('aria-label', ariaMessage);
    if (detail) {
      note.setAttribute('title', detail);
    } else {
      note.removeAttribute('title');
    }
  }
};

const probeMicrophone = async () => {
  const hasMediaDevices =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  if (!hasMediaDevices) {
    return {
      state: STATUS.error,
      message: 'Microphone not detected for live audio.',
      detail: 'Use demo audio, tab audio, or YouTube audio before starting.',
    };
  }

  if (typeof navigator.permissions?.query !== 'function') {
    return {
      state: STATUS.success,
      message: 'Microphone ready; permission requested later.',
      detail:
        'Grant microphone access when a toy asks, or use demo/tab/YouTube audio.',
    };
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });

    if (status.state === 'denied') {
      return {
        state: STATUS.error,
        message: 'Microphone blocked; use alternate audio.',
        detail:
          'Update permissions or use demo, tab, or YouTube audio instead.',
      };
    }

    if (status.state === 'granted') {
      return {
        state: STATUS.success,
        message: 'Microphone ready for live audio.',
        detail: 'Audio-reactive toys can start immediately.',
      };
    }
  } catch (error) {
    console.warn('Microphone permission probe failed', error);
    return {
      state: STATUS.warn,
      message: 'Microphone status unclear; allow access.',
      detail: 'Allow access if prompted, or use demo, tab, or YouTube audio.',
    };
  }

  return {
    state: STATUS.success,
    message: 'Microphone ready; permission requested later.',
    detail:
      'Grant microphone access when a toy asks, or use demo/tab/YouTube audio.',
  };
};

export const getRenderCompatibilitySummary = () => {
  const { hasWebGPU, hasWebGL } = getRenderingSupport();

  if (hasWebGPU) {
    return {
      state: STATUS.success,
      label: 'WebGPU ready',
    };
  }

  if (hasWebGL) {
    return {
      state: STATUS.warn,
      label: 'WebGL fallback active',
    };
  }

  return {
    state: STATUS.error,
    label: 'Graphics acceleration unavailable',
  };
};

const probeRendering = () => {
  const { hasWebGPU, hasWebGL } = getRenderingSupport();

  if (hasWebGPU) {
    return {
      state: STATUS.success,
      message: 'WebGPU ready for best visuals.',
      detail: 'WebGPU provides the highest fidelity visuals.',
    };
  }

  if (hasWebGL) {
    return {
      state: STATUS.warn,
      message: 'WebGL fallback for compatible visuals.',
      detail:
        'WebGPU not detected. Toys will use the WebGL fallback for compatibility.',
    };
  }

  return {
    state: STATUS.error,
    message: 'Graphics acceleration unavailable on this device.',
    detail: 'Try another browser or device.',
  };
};

const probeMotion = () => {
  const supportsMotion =
    typeof window !== 'undefined' &&
    ('DeviceMotionEvent' in window || 'LinearAccelerationSensor' in window);

  if (!supportsMotion) {
    return {
      state: STATUS.error,
      message: 'Motion sensors unavailable on this device.',
      detail: 'Try on mobile or enable motion access.',
    };
  }

  const requiresPermission =
    typeof window !== 'undefined' &&
    typeof (
      window.DeviceMotionEvent as
        | (typeof DeviceMotionEvent & {
            requestPermission?: () => Promise<PermissionState>;
          })
        | undefined
    )?.requestPermission === 'function';

  if (requiresPermission) {
    return {
      state: STATUS.warn,
      message: 'Motion access needs permission after prompt.',
      detail: 'Allow access after the prompt when starting.',
    };
  }

  return {
    state: STATUS.success,
    message: 'Motion controls available on this device.',
    detail: 'Effects adapt when you move or tilt.',
  };
};

const initReducedMotionStatus = (update: (result: StatusResult) => void) => {
  if (typeof window.matchMedia !== 'function') {
    update({
      state: STATUS.warn,
      message: 'Motion preference unavailable on this device.',
      detail: 'Full motion will be used by default.',
    });
    return;
  }

  const query = window.matchMedia('(prefers-reduced-motion: reduce)');

  const applyPreference = (event: MediaQueryListEvent | MediaQueryList) => {
    if (event.matches) {
      update({
        state: STATUS.success,
        message: 'Reduced motion preference is active.',
        detail: 'Animations will soften to match your preference.',
      });
      return;
    }

    update({
      state: STATUS.success,
      message: 'Full motion effects are enabled.',
      detail: 'Toggle reduced motion in your OS to soften effects.',
    });
  };

  applyPreference(query);
  query.addEventListener('change', applyPreference);
};

export const initReadinessProbe = () => {
  const applyRenderStatus = () => {
    const result = probeRendering();
    applyStatus('render', result.state, result.message, result.detail);
  };

  const applyMicStatus = async () => {
    const result = await probeMicrophone();
    applyStatus('mic', result.state, result.message, result.detail);
  };

  const applyMotionStatus = () => {
    const result = probeMotion();
    applyStatus('motion', result.state, result.message, result.detail);
  };

  const applyReducedMotionStatus = () => {
    initReducedMotionStatus((result) => {
      applyStatus('reduced', result.state, result.message, result.detail);
    });
  };

  applyRenderStatus();
  applyMicStatus();
  applyMotionStatus();
  applyReducedMotionStatus();
};
