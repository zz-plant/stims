import { getRenderingSupport } from './utils/rendering-support.ts';

const STATUS = {
  success: 'success',
  warn: 'warn',
  error: 'error',
};

type StatusKey = 'render' | 'mic' | 'motion' | 'reduced';
type StatusState = (typeof STATUS)[keyof typeof STATUS];

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

const applyStatus = (key: StatusKey, state: StatusState, message: string) => {
  const { dots, notes } = selectStatusNodes();
  const dot = dots[key];
  const note = notes[key];
  const label = STATUS_LABELS[key];
  const HTMLElementCtor = globalThis.HTMLElement;

  if (HTMLElementCtor && dot instanceof HTMLElementCtor) {
    dot.dataset.status = state;
    dot.setAttribute('aria-label', `${label}: ${message}`);
  }

  if (HTMLElementCtor && note instanceof HTMLElementCtor) {
    note.textContent = message;
    note.setAttribute('aria-label', `${label}: ${message}`);
  }
};

const probeMicrophone = async () => {
  const hasMediaDevices =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  if (!hasMediaDevices) {
    return {
      state: STATUS.error,
      message:
        'No microphone detected. Use demo audio, tab audio, or YouTube audio before starting.',
    };
  }

  if (typeof navigator.permissions?.query !== 'function') {
    return {
      state: STATUS.success,
      message:
        'Live audio available — grant mic access when a toy asks, or use demo/tab/YouTube audio.',
    };
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });

    if (status.state === 'denied') {
      return {
        state: STATUS.error,
        message:
          'Microphone is blocked. Update permissions or use demo/tab/YouTube audio.',
      };
    }

    if (status.state === 'granted') {
      return {
        state: STATUS.success,
        message: 'Mic ready — audio-reactive toys can start immediately.',
      };
    }
  } catch (error) {
    console.warn('Microphone permission probe failed', error);
    return {
      state: STATUS.warn,
      message:
        'Mic support detected, but permission status is unclear. Allow access if prompted, or use demo/tab/YouTube audio.',
    };
  }

  return {
    state: STATUS.success,
    message:
      'Live audio available — grant mic access when a toy asks, or use demo/tab/YouTube audio.',
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
      message: 'WebGPU ready — you get the highest fidelity visuals.',
    };
  }

  if (hasWebGL) {
    return {
      state: STATUS.warn,
      message:
        'WebGPU not detected. Toys will use the WebGL fallback for compatibility.',
    };
  }

  return {
    state: STATUS.error,
    message:
      'Graphics acceleration is unavailable. Try another browser or device.',
  };
};

const probeMotion = () => {
  const supportsMotion =
    typeof window !== 'undefined' &&
    ('DeviceMotionEvent' in window || 'LinearAccelerationSensor' in window);

  if (!supportsMotion) {
    return {
      state: STATUS.error,
      message:
        'Motion controls unavailable or locked down. Try on mobile or enable motion access.',
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
      message:
        'Motion available, but you’ll need to allow access after a prompt when starting.',
    };
  }

  return {
    state: STATUS.success,
    message:
      'Motion/tilt supported — effects will adapt when you move your device.',
  };
};

const initReducedMotionStatus = (
  update: (result: { state: StatusState; message: string }) => void,
) => {
  if (typeof window.matchMedia !== 'function') {
    update({
      state: STATUS.warn,
      message:
        'Unable to detect motion comfort settings. Full motion will be used by default.',
    });
    return;
  }

  const query = window.matchMedia('(prefers-reduced-motion: reduce)');

  const applyPreference = (event: MediaQueryListEvent | MediaQueryList) => {
    if (event.matches) {
      update({
        state: STATUS.success,
        message: 'Animations will soften because you prefer reduced motion.',
      });
      return;
    }

    update({
      state: STATUS.success,
      message:
        'Full motion is enabled. Toggle reduced motion in your OS to soften effects.',
    });
  };

  applyPreference(query);
  query.addEventListener('change', applyPreference);
};

export const initReadinessProbe = () => {
  const applyRenderStatus = () => {
    const result = probeRendering();
    applyStatus('render', result.state, result.message);
  };

  const applyMicStatus = async () => {
    const result = await probeMicrophone();
    applyStatus('mic', result.state, result.message);
  };

  const applyMotionStatus = () => {
    const result = probeMotion();
    applyStatus('motion', result.state, result.message);
  };

  const applyReducedMotionStatus = () => {
    initReducedMotionStatus((result) => {
      applyStatus('reduced', result.state, result.message);
    });
  };

  applyRenderStatus();
  applyMicStatus();
  applyMotionStatus();
  applyReducedMotionStatus();
};
