import { setMilkdropCapturedVideoStream } from '../core/services/captured-video-texture.ts';
import {
  type MicrophonePermissionState,
  queryMicrophonePermissionState,
} from '../core/services/microphone-permission-service.ts';
import { setQualityPresetById } from '../core/settings-panel.ts';
import {
  captureDisplayAudioStream,
  renderAdvancedAudioSources,
  setupYouTubeAudioControls,
} from './audio-advanced-sources.ts';
import {
  resolveTouchGestureHints,
  supportsTouchLikeInput,
} from './audio-control-policy.ts';

export { resolveTouchGestureHints } from './audio-control-policy.ts';

export interface AudioControlsOptions {
  onRequestMicrophone: () => Promise<void>;
  onRequestDemoAudio: () => Promise<void>;
  onRequestYouTubeAudio?: (stream: MediaStream) => Promise<void>;
  onRequestTabAudio?: (stream: MediaStream) => Promise<void>;
  onSuccess?: () => void;
  statusElement?: HTMLElement;
  initialStatus?: { message: string; variant?: 'success' | 'error' };
  preferDemoAudio?: boolean;
  starterTips?: string[];
  firstRunHint?: string;
  gestureHints?: string[];
  desktopHints?: string[];
  touchHints?: string[];
  starterPresetLabel?: string;
  starterPresetId?: string;
  wowControl?: string;
  recommendedCapability?: 'demoAudio' | 'microphone' | 'motion' | 'touch';
  onApplyStarterPreset?: () => void;
  onPrepareYouTubeContext?: () => Promise<void> | void;
  autoStartMicrophoneWhenGranted?: boolean;
  autoStartSource?: 'demo';
  initialShortcut?: 'tab' | 'youtube';
}

export function buildTryThisFirstRecommendation({
  recommendedCapability,
  starterPresetLabel,
  wowControl,
  firstRunHint,
}: {
  recommendedCapability?: AudioControlsOptions['recommendedCapability'];
  starterPresetLabel?: string;
  wowControl?: string;
  firstRunHint?: string;
}) {
  const steps: string[] = [];

  if (recommendedCapability === 'microphone') {
    steps.push('Start with live mic for the most responsive visuals.');
  } else if (recommendedCapability === 'demoAudio') {
    steps.push('Start with demo audio for the fastest first look.');
  } else if (recommendedCapability === 'touch') {
    steps.push(
      'Start audio, then use touch gestures to bend, scale, and twist the scene.',
    );
  }

  if (starterPresetLabel?.trim()) {
    steps.push(`Try ${starterPresetLabel.trim()} once the visualizer opens.`);
  }

  if (wowControl?.trim()) {
    steps.push(`Then explore ${wowControl.trim()}.`);
  }

  if (steps.length === 0 && firstRunHint?.trim()) {
    steps.push(firstRunHint.trim());
  }

  const summary =
    steps[0] ??
    'Start with demo audio or live mic, then shape the session once the visual opens.';
  const detail =
    steps.length > 1
      ? steps.slice(1).join(' ')
      : firstRunHint?.trim() && firstRunHint.trim() !== summary
        ? firstRunHint.trim()
        : '';

  return { summary, detail };
}

export function initAudioControls(
  container: HTMLElement,
  options: AudioControlsOptions,
) {
  const STORAGE_KEY = 'stims-audio-source';
  const readStoredSource = () => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  };
  const writeStoredSource = (source: 'microphone' | 'demo') => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, source);
    } catch (_error) {
      // Ignore storage errors.
    }
  };

  const preserveFloatingLayout = container.classList.contains(
    'control-panel--floating',
  );
  container.className = preserveFloatingLayout
    ? 'control-panel control-panel--audio control-panel--floating'
    : 'control-panel control-panel--audio';
  const touchLikeInputSupported = supportsTouchLikeInput();
  const firstRunHint = options.firstRunHint?.trim();
  const touchHints = resolveTouchGestureHints(options);
  const desktopHints = (options.desktopHints ?? [])
    .map((tip) => tip.trim())
    .filter(Boolean)
    .slice(0, 6);

  const starterPresetLabel =
    options.starterPresetLabel?.trim() || 'calm starter preset';
  const starterPresetId = options.starterPresetId?.trim() || 'low-motion';

  container.innerHTML = `
	    <p class="control-panel__eyebrow">Start</p>
	    <div class="control-panel__heading">Pick your input</div>
	    ${renderPrimaryAudioChoice()}
	    ${renderAdvancedAudioSources(options)}
	    <div id="audio-status" class="control-panel__status" role="status" aria-live="polite" hidden></div>
	    ${renderPostStartGuidance({
        firstRunHint,
        desktopHints,
        touchHints,
        supportsTouchLikeInput: touchLikeInputSupported,
        starterTips: options.starterTips,
        starterPresetLabel,
        showStarterPresetAction: true,
      })}
  `;

  const micBtn = container.querySelector('#start-audio-btn');
  const demoBtn = container.querySelector('#use-demo-audio');
  const tabBtn = container.querySelector(
    '#use-tab-audio',
  ) as HTMLButtonElement | null;
  const micRow = container.querySelector('[data-audio-row="mic"]');
  const demoRow = container.querySelector('[data-audio-row="demo"]');
  const statusEl = (options.statusElement ||
    container.querySelector('#audio-status')) as HTMLElement;
  const requestTabAudio = options.onRequestTabAudio;
  let microphonePermissionState: MicrophonePermissionState = 'unknown';
  const advancedInputs = container.querySelector(
    '[data-advanced-inputs]',
  ) as HTMLDetailsElement | null;
  const ADVANCED_KEY = 'stims-audio-advanced-open';
  const GESTURE_HINT_KEY = 'stims-gesture-hints-dismissed';
  const QUICK_START_PRESET_KEY = 'stims-quick-start-preset';

  const setPrimaryRow = (row: Element | null, isPrimary: boolean): void => {
    row?.classList.toggle('control-panel__row--primary', isPrimary);
  };

  const setRecommendedBadge = (
    source: 'microphone' | 'demo',
    isVisible: boolean,
  ): void => {
    const badge = container.querySelector(
      `[data-recommended-for="${source === 'microphone' ? 'mic' : 'demo'}"]`,
    );
    if (!(badge instanceof HTMLElement)) return;
    badge.hidden = !isVisible;
  };

  const setPreferredSource = (source: 'microphone' | 'demo'): void => {
    setPrimaryRow(micRow, source === 'microphone');
    setPrimaryRow(demoRow, source === 'demo');
    setRecommendedBadge('microphone', source === 'microphone');
    setRecommendedBadge('demo', source === 'demo');
    const firstStepSource = container.querySelector('[data-first-step-source]');
    if (!(firstStepSource instanceof HTMLElement)) return;
    firstStepSource.textContent =
      source === 'microphone'
        ? 'Use mic for room audio, voice, or instruments.'
        : 'Demo is the fastest start.';
  };

  const setPending = (button: Element | null, pending: boolean) => {
    if (!(button instanceof HTMLElement)) return;
    button.toggleAttribute('data-loading', pending);
    button.setAttribute('aria-busy', pending ? 'true' : 'false');
    button.setAttribute('aria-disabled', pending ? 'true' : 'false');
    if (button instanceof HTMLButtonElement) {
      button.disabled = pending;
    }
  };

  const setMicrophoneButtonState = () => {
    if (!(micBtn instanceof HTMLButtonElement)) return;

    if (microphonePermissionState === 'granted') {
      micBtn.textContent = 'Use mic';
      return;
    }

    if (microphonePermissionState === 'denied') {
      micBtn.textContent = 'Retry mic';
      return;
    }

    if (microphonePermissionState === 'unsupported') {
      micBtn.textContent = 'Mic unavailable';
      micBtn.disabled = true;
      return;
    }

    micBtn.textContent = 'Use mic';
  };

  const updateStatus = (
    message: string,
    variant: 'success' | 'error' = 'error',
  ) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.dataset.variant = variant;
    statusEl.textContent = message;
  };

  const emphasizeDemoAudio = () => {
    setPreferredSource('demo');
  };

  const buildMicrophoneErrorMessage = (message: string) => {
    const helperText = 'Use the demo track to keep moving.';
    if (!message) {
      return `Microphone access failed. ${helperText}`;
    }

    if (/demo audio/i.test(message)) {
      return message;
    }

    if (/microphone|audio/i.test(message)) {
      return `${message} ${helperText}`;
    }

    return `${message} ${helperText}`;
  };

  const preferDemoAudio =
    options.preferDemoAudio ?? readStoredSource() === 'demo';
  const autoStartMicrophoneWhenGranted =
    options.autoStartMicrophoneWhenGranted ?? true;
  let hasStartedAudio = false;

  if (preferDemoAudio && demoBtn instanceof HTMLButtonElement) {
    setPreferredSource('demo');
  } else {
    setPreferredSource('microphone');
  }

  void queryMicrophonePermissionState().then((state) => {
    microphonePermissionState = state;
    setMicrophoneButtonState();
    if (state === 'denied' && !hasStartedAudio) {
      updateStatus(
        'Microphone is currently blocked. Start with demo now, then re-enable mic permissions when you are ready.',
      );
      emphasizeDemoAudio();
    }
    if (state === 'unsupported' && !hasStartedAudio) {
      updateStatus(
        'Microphone is unavailable in this browser. Start with demo now.',
      );
      emphasizeDemoAudio();
    }

    maybeAutoStartMicrophone();
  });

  const postStartGuidance = container.querySelector(
    '[data-post-start-guidance]',
  ) as HTMLElement | null;
  const showPostStartGuidance = () => {
    if (postStartGuidance) {
      postStartGuidance.hidden = false;
    }
  };

  const quickStartPresetButton = container.querySelector(
    '[data-apply-starter-preset]',
  ) as HTMLButtonElement | null;
  quickStartPresetButton?.addEventListener('click', () => {
    if (typeof options.onApplyStarterPreset === 'function') {
      options.onApplyStarterPreset();
      updateStatus(`${starterPresetLabel} applied.`, 'success');
      return;
    }

    const appliedPreset = setQualityPresetById(starterPresetId);
    if (!appliedPreset) {
      updateStatus('Starter preset unavailable in this visualizer.', 'error');
      return;
    }

    try {
      window.sessionStorage.setItem(QUICK_START_PRESET_KEY, appliedPreset.id);
    } catch (_error) {
      // Ignore storage errors.
    }
    updateStatus(`${starterPresetLabel} applied.`, 'success');
  });

  const gestureHintsPanel = container.querySelector(
    '[data-gesture-hints]',
  ) as HTMLElement | null;

  const showGestureHints = () => {
    if (!gestureHintsPanel || !touchLikeInputSupported) return;

    let isDismissed = false;
    try {
      isDismissed = window.sessionStorage.getItem(GESTURE_HINT_KEY) === 'true';
    } catch (_error) {
      isDismissed = false;
    }

    if (isDismissed) {
      gestureHintsPanel.hidden = true;
      return;
    }

    gestureHintsPanel.hidden = false;

    let interactionCount = 0;
    const dismissGestureHints = () => {
      gestureHintsPanel.hidden = true;
      window.removeEventListener('pointerdown', hideAfterInteractions);
      try {
        window.sessionStorage.setItem(GESTURE_HINT_KEY, 'true');
      } catch (_error) {
        // Ignore storage errors.
      }
    };

    const dismissGestureHintsButton = gestureHintsPanel.querySelector(
      '[data-dismiss-gesture-hints]',
    ) as HTMLButtonElement | null;
    dismissGestureHintsButton?.addEventListener('click', dismissGestureHints, {
      once: true,
    });

    const hideAfterInteractions = () => {
      interactionCount += 1;
      if (interactionCount < 2) return;
      dismissGestureHints();
    };

    window.addEventListener('pointerdown', hideAfterInteractions, {
      passive: true,
    });
  };

  const handleSuccess = () => {
    hasStartedAudio = true;
    options.onSuccess?.();
    showGestureHints();
    showPostStartGuidance();
  };

  if (options.initialStatus) {
    updateStatus(
      options.initialStatus.message,
      options.initialStatus.variant ?? 'error',
    );
  }

  const persistAdvancedState = (nextState: boolean) => {
    if (!advancedInputs) return;
    advancedInputs.open = nextState;
    try {
      window.sessionStorage.setItem(ADVANCED_KEY, String(nextState));
    } catch (_error) {
      // Ignore storage errors.
    }
  };

  if (advancedInputs) {
    let isOpen = false;
    try {
      isOpen = window.sessionStorage.getItem(ADVANCED_KEY) === 'true';
    } catch (_error) {
      isOpen = false;
    }

    persistAdvancedState(isOpen);

    advancedInputs.addEventListener('toggle', () => {
      persistAdvancedState(advancedInputs.open);
    });
  }

  const maybeAutoStartMicrophone = () => {
    if (
      !autoStartMicrophoneWhenGranted ||
      preferDemoAudio ||
      hasStartedAudio ||
      microphonePermissionState !== 'granted' ||
      !(micBtn instanceof HTMLButtonElement)
    ) {
      return;
    }

    void handleRequest(
      micBtn,
      async () => {
        await options.onRequestMicrophone();
        writeStoredSource('microphone');
        setPreferredSource('microphone');
      },
      'Microphone access failed.',
      (message) => {
        emphasizeDemoAudio();
        updateStatus(buildMicrophoneErrorMessage(message));
      },
      'Live mic connected.',
      'Starting live mic…',
    );
  };

  if (options.initialShortcut === 'tab') {
    persistAdvancedState(true);
    updateStatus(
      'Tab audio is ready below. Choose Capture tab to continue.',
      'success',
    );
    requestAnimationFrame(() => {
      tabBtn?.focus();
    });
  } else if (options.initialShortcut === 'youtube') {
    persistAdvancedState(true);
    updateStatus(
      'YouTube audio is ready below. Paste a link or load a recent video to continue.',
      'success',
    );
    requestAnimationFrame(() => {
      const youtubeField = container.querySelector(
        '#youtube-url',
      ) as HTMLInputElement | null;
      youtubeField?.focus();
    });
  }

  const handleRequest = async (
    button: Element | null,
    action: () => Promise<void>,
    errorMessage: string,
    onError?: (message: string) => void,
    successMessage?: string,
    pendingMessage?: string,
  ) => {
    if (pendingMessage) {
      updateStatus(pendingMessage, 'success');
    }
    setPending(button, true);
    try {
      await action();
      if (successMessage) {
        updateStatus(successMessage, 'success');
      }
      handleSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : errorMessage;
      updateStatus(message);
      onError?.(message);
    } finally {
      setPending(button, false);
    }
  };

  const startDemoAudio = () =>
    handleRequest(
      demoBtn,
      async () => {
        await options.onRequestDemoAudio();
        writeStoredSource('demo');
        setPreferredSource('demo');
      },
      'Demo audio failed to load.',
      undefined,
      'Demo audio started.',
      'Starting demo audio…',
    );

  micBtn?.addEventListener('click', () => {
    void handleRequest(
      micBtn,
      async () => {
        await options.onRequestMicrophone();
        microphonePermissionState = 'granted';
        setMicrophoneButtonState();
        writeStoredSource('microphone');
        setPreferredSource('microphone');
      },
      'Microphone access failed.',
      (message) => {
        emphasizeDemoAudio();
        updateStatus(buildMicrophoneErrorMessage(message));
      },
      'Live mic connected.',
      microphonePermissionState === 'granted'
        ? 'Starting live mic…'
        : 'Requesting microphone access…',
    );
  });

  demoBtn?.addEventListener('click', () => {
    void startDemoAudio();
  });

  if (options.autoStartSource === 'demo') {
    void startDemoAudio();
  }

  tabBtn?.addEventListener('click', () => {
    if (!requestTabAudio) return;
    void handleRequest(
      tabBtn,
      async () => {
        updateStatus('Select tab to capture audio.', 'success');
        const stream = await captureDisplayAudioStream({
          unavailableMessage: 'Tab audio capture unavailable.',
        });
        await setMilkdropCapturedVideoStream(stream);
        await requestTabAudio(stream);
      },
      'Tab audio capture failed.',
      undefined,
      'Tab video is feeding the preset.',
      'Starting tab audio…',
    );
  });

  if (options.onRequestYouTubeAudio) {
    setupYouTubeAudioControls(
      container,
      options.onRequestYouTubeAudio,
      updateStatus,
      handleSuccess,
      options.onPrepareYouTubeContext,
    );
  }
}

function renderPrimaryAudioChoice() {
  return `
    <div class="control-panel__row" data-audio-row="demo">
      <div class="control-panel__text">
        <span class="control-panel__label">Demo</span>
        <span class="control-panel__subtext">Built-in audio.</span>
      </div>
      <button id="use-demo-audio" class="cta-button primary" type="button">Start demo</button>
    </div>
    <div class="control-panel__row" data-audio-row="mic">
      <div class="control-panel__text">
        <span class="control-panel__label">Live mic</span>
        <span class="control-panel__subtext">Room, voice, or instrument.</span>
      </div>
      <button id="start-audio-btn" class="cta-button ghost" type="button">Use mic</button>
    </div>
  `;
}

function renderPostStartGuidance({
  firstRunHint,
  desktopHints,
  touchHints,
  supportsTouchLikeInput,
  starterTips,
  starterPresetLabel,
  showStarterPresetAction,
}: {
  firstRunHint?: string;
  desktopHints: string[];
  touchHints: string[];
  supportsTouchLikeInput: boolean;
  starterTips?: string[];
  starterPresetLabel: string;
  showStarterPresetAction: boolean;
}) {
  return `
    <section class="control-panel__post-start" data-post-start-guidance hidden aria-label="Next steps">
      <div class="control-panel__first-steps-header">
        <span class="control-panel__label">After start</span>
        ${
          showStarterPresetAction
            ? `<button type="button" class="control-panel__dismiss" data-apply-starter-preset>Use ${starterPresetLabel}</button>`
            : ''
        }
      </div>
      <p class="control-panel__comparison">You are in. Keep exploring, or stop here if it already feels right.</p>
      ${
        firstRunHint
          ? `<p class="control-panel__microcopy">${firstRunHint}</p>`
          : ''
      }
      ${
        desktopHints.length > 0 && !supportsTouchLikeInput
          ? `
      <section class="control-panel__gesture-hints" data-desktop-hints aria-live="polite">
        <div class="control-panel__first-steps-header">
          <span class="control-panel__label">Controls</span>
        </div>
        <p class="control-panel__microcopy">On desktop:</p>
        <ul class="control-panel__tips control-panel__tips--compact">
          ${desktopHints.map((tip) => `<li>${tip}</li>`).join('')}
        </ul>
      </section>
      `
          : ''
      }
      ${
        touchHints.length > 0
          ? `
      <section class="control-panel__gesture-hints" data-gesture-hints hidden aria-live="polite">
        <div class="control-panel__first-steps-header">
          <span class="control-panel__label">Touch</span>
          <button type="button" class="control-panel__dismiss" data-dismiss-gesture-hints>Got it</button>
        </div>
        <p class="control-panel__microcopy">After audio starts:</p>
        <ul class="control-panel__tips control-panel__tips--compact">
          ${touchHints.map((tip) => `<li>${tip}</li>`).join('')}
        </ul>
      </section>
      `
          : ''
      }
      ${
        starterTips && starterTips.length > 0
          ? `
      <section class="control-panel__gesture-hints" aria-live="polite">
        <div class="control-panel__first-steps-header">
          <span class="control-panel__label">Presets</span>
        </div>
        <ul class="control-panel__tips control-panel__tips--compact">
          ${starterTips
            .slice(0, 2)
            .map((tip) => `<li>${tip}</li>`)
            .join('')}
        </ul>
      </section>
      `
          : ''
      }
    </section>
  `;
}
