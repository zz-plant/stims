const STATUS = {
  success: 'success',
  warn: 'warn',
  error: 'error',
};

const STATUS_LABELS = {
  mic: 'Microphone input',
  motion: 'Motion controls',
  reduced: 'Reduced motion preference',
};

const selectStatusNodes = () => ({
  dots: {
    mic: document.querySelector('[data-status-dot="mic"]'),
    motion: document.querySelector('[data-status-dot="motion"]'),
    reduced: document.querySelector('[data-status-dot="reduced"]'),
  },
  notes: {
    mic: document.querySelector('[data-status-note="mic"]'),
    motion: document.querySelector('[data-status-note="motion"]'),
    reduced: document.querySelector('[data-status-note="reduced"]'),
  },
});

const applyStatus = (key, state, message) => {
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
        'No microphone detected. Use demo audio or plug in a mic before starting.',
    };
  }

  if (typeof navigator.permissions?.query !== 'function') {
    return {
      state: STATUS.success,
      message: 'Live audio available — grant mic access when a toy asks.',
    };
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });

    if (status.state === 'denied') {
      return {
        state: STATUS.error,
        message:
          'Microphone is blocked. Update site permissions to re-enable live audio.',
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
        'Mic support detected, but permission status is unclear. Allow access if prompted.',
    };
  }

  return {
    state: STATUS.success,
    message: 'Live audio available — grant mic access when a toy asks.',
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
    typeof window.DeviceMotionEvent?.requestPermission === 'function';

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

const initReducedMotionStatus = (update) => {
  if (typeof window.matchMedia !== 'function') {
    update({
      state: STATUS.warn,
      message:
        'Unable to detect motion comfort settings. Full motion will be used by default.',
    });
    return;
  }

  const query = window.matchMedia('(prefers-reduced-motion: reduce)');

  const applyPreference = (event) => {
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

  applyMicStatus();
  applyMotionStatus();
  applyReducedMotionStatus();
};
