import {
  type MicrophonePermissionState,
  queryMicrophonePermissionState,
} from '../core/services/microphone-permission-service.ts';
import { setQualityPresetById } from '../core/settings-panel.ts';
import { YouTubeController } from './youtube-controller';

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
  autoStartMicrophoneWhenGranted?: boolean;
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
    steps.push('Start with live mic for the most responsive version.');
  } else if (recommendedCapability === 'demoAudio') {
    steps.push('Start with demo audio for the fastest first run.');
  }

  if (starterPresetLabel?.trim()) {
    steps.push(`Try ${starterPresetLabel.trim()} once the toy opens.`);
  }

  if (wowControl?.trim()) {
    steps.push(`Then explore ${wowControl.trim()}.`);
  }

  if (steps.length === 0 && firstRunHint?.trim()) {
    steps.push(firstRunHint.trim());
  }

  const summary =
    steps[0] ??
    'Start with demo audio or live mic, then interact with the canvas once sound begins.';
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
  const youtubeController = new YouTubeController();
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
  const supportsTouchLikeInput =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches) ||
    navigator.maxTouchPoints > 0;
  const firstRunHint = options.firstRunHint?.trim();
  const touchHints = (
    options.touchHints ??
    options.gestureHints ??
    options.starterTips ??
    []
  )
    .filter((tip) => /touch|drag|pinch|swipe|gesture|tap|rotate/i.test(tip))
    .slice(0, 2);
  const desktopHints = (options.desktopHints ?? [])
    .map((tip) => tip.trim())
    .filter(Boolean)
    .slice(0, 6);

  const starterPresetLabel =
    options.starterPresetLabel?.trim() || 'calm starter preset';
  const starterPresetId = options.starterPresetId?.trim() || 'low-motion';
  const tryThisFirst = buildTryThisFirstRecommendation({
    recommendedCapability: options.recommendedCapability,
    starterPresetLabel: options.starterPresetLabel,
    wowControl: options.wowControl,
    firstRunHint,
  });

  container.innerHTML = `
    <p class="control-panel__eyebrow">Start</p>
    <div class="control-panel__heading">Pick an input</div>
    <p class="control-panel__description">Start instantly with demo, or switch to mic when you want live response.</p>
    ${renderPrimaryAudioChoice()}
    ${renderQuickstartSpotlight({
      summary: tryThisFirst.summary,
      detail: tryThisFirst.detail,
      starterPresetLabel,
      showStarterPresetAction: true,
    })}
    ${renderSourceShortcuts(options)}
    ${renderOnboardingHelp({
      firstRunHint,
      desktopHints,
      touchHints,
      supportsTouchLikeInput,
      starterTips: options.starterTips,
    })}
    ${renderAdvancedSources(options)}
    <div id="audio-status" class="control-panel__status" role="status" aria-live="polite" hidden></div>
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
  const revealTabAudioBtn = container.querySelector(
    '[data-reveal-tab-audio]',
  ) as HTMLButtonElement | null;
  const revealYouTubeAudioBtn = container.querySelector(
    '[data-reveal-youtube-audio]',
  ) as HTMLButtonElement | null;
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
        ? 'Mic is best for room audio, voice, and instruments.'
        : 'Demo is best for the fastest first run.';
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

    micBtn.textContent = 'Allow mic';
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
    if (state === 'denied') {
      updateStatus(
        'Microphone is currently blocked. Start with demo audio now, then allow mic in site permissions when ready.',
      );
      emphasizeDemoAudio();
    }
    if (state === 'unsupported') {
      updateStatus(
        'Microphone is unavailable in this browser. Start with demo audio now.',
      );
      emphasizeDemoAudio();
    }

    maybeAutoStartMicrophone();
  });

  const quickstartSpotlight = container.querySelector(
    '[data-quickstart-spotlight]',
  ) as HTMLElement | null;
  const hideFirstSteps = () => {
    if (quickstartSpotlight) {
      quickstartSpotlight.hidden = true;
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
      updateStatus('Starter preset unavailable on this toy.', 'error');
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
    if (!gestureHintsPanel || !supportsTouchLikeInput) return;

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
    hideFirstSteps();
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

  revealTabAudioBtn?.addEventListener('click', () => {
    persistAdvancedState(true);
    tabBtn?.focus();
  });

  revealYouTubeAudioBtn?.addEventListener('click', () => {
    persistAdvancedState(true);
    const youtubeField = container.querySelector(
      '#youtube-url',
    ) as HTMLInputElement | null;
    youtubeField?.focus();
  });

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
        : 'Requesting microphone permission…',
    );
  });

  demoBtn?.addEventListener('click', () => {
    void handleRequest(
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
  });

  tabBtn?.addEventListener('click', () => {
    if (!requestTabAudio) return;
    void handleRequest(
      tabBtn,
      async () => {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          throw new Error('Tab audio capture unavailable.');
        }
        updateStatus('Select tab to capture audio.', 'success');
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error('No audio track detected.');
        }
        await requestTabAudio(stream);
      },
      'Tab audio capture failed.',
      undefined,
      'Tab audio connected.',
      'Starting tab audio…',
    );
  });

  if (options.onRequestYouTubeAudio) {
    setupYouTubeLogic(
      container,
      youtubeController,
      options.onRequestYouTubeAudio,
      updateStatus,
      handleSuccess,
    );
  }
}

function renderPrimaryAudioChoice() {
  return `
    <div class="control-panel__row" data-audio-row="mic">
      <div class="control-panel__text">
        <span class="control-panel__label">Mic</span>
        <span class="control-panel__pill" data-recommended-for="mic" hidden>Recommended</span>
        <span class="control-panel__subtext">Room, voice, or instrument.</span>
        <span class="control-panel__microcopy">Needs microphone permission.</span>
      </div>
      <button id="start-audio-btn" class="cta-button ghost" type="button">Use mic</button>
    </div>
    <div class="control-panel__row" data-audio-row="demo">
      <div class="control-panel__text">
        <span class="control-panel__label">Demo</span>
        <span class="control-panel__pill" data-recommended-for="demo" hidden>Recommended</span>
        <span class="control-panel__subtext">Built-in soundtrack.</span>
        <span class="control-panel__microcopy">No permission prompt.</span>
      </div>
      <button id="use-demo-audio" class="cta-button primary" type="button">Use demo</button>
    </div>
  `;
}

function renderSourceShortcuts(options: AudioControlsOptions) {
  if (!options.onRequestTabAudio && !options.onRequestYouTubeAudio) {
    return '';
  }

  return `
    <section class="control-panel__source-shortcuts" aria-label="More audio entry points">
      <p class="control-panel__label">Browser audio</p>
      <p class="control-panel__advanced-helper">
        Use these when you want the visuals to react to music or videos already playing in your browser.
      </p>
      <div class="control-panel__shortcut-actions">
        ${
          options.onRequestTabAudio
            ? '<button type="button" class="cta-button ghost" data-reveal-tab-audio>Tab audio</button>'
            : ''
        }
        ${
          options.onRequestYouTubeAudio
            ? '<button type="button" class="cta-button ghost" data-reveal-youtube-audio>YouTube</button>'
            : ''
        }
      </div>
    </section>
  `;
}

function renderQuickstartSpotlight({
  summary,
  detail,
  starterPresetLabel,
  showStarterPresetAction,
}: {
  summary: string;
  detail: string;
  starterPresetLabel: string;
  showStarterPresetAction: boolean;
}) {
  return `
    <section class="control-panel__quickstart-spotlight" data-quickstart-spotlight role="note" aria-label="Start here">
      <div class="control-panel__first-steps-header">
        <span class="control-panel__label">Start here</span>
        <div class="control-panel__first-steps-actions">
          ${
            showStarterPresetAction
              ? `<button type="button" class="control-panel__dismiss" data-apply-starter-preset>Apply ${starterPresetLabel}</button>`
              : ''
          }
        </div>
      </div>
      <p class="control-panel__comparison" data-audio-comparison>${summary}</p>
      ${detail ? `<p class="control-panel__microcopy">${detail}</p>` : ''}
      <ul class="control-panel__tips control-panel__tips--compact">
        <li data-first-step-source>Demo is the fastest path. Mic is best once you want live response.</li>
      </ul>
    </section>
  `;
}

function renderOnboardingHelp({
  firstRunHint,
  desktopHints,
  touchHints,
  supportsTouchLikeInput,
  starterTips,
}: {
  firstRunHint?: string;
  desktopHints: string[];
  touchHints: string[];
  supportsTouchLikeInput: boolean;
  starterTips?: string[];
}) {
  return `
    <details class="control-panel__details" data-onboarding-help>
      <summary class="control-panel__label">How to interact</summary>
      <p class="control-panel__comparison" data-audio-comparison>
        Mic is responsive. Demo is instant.
      </p>
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
          <span class="control-panel__label">Desktop controls</span>
        </div>
        <p class="control-panel__microcopy">Laptop play is tuned as a live performance surface:</p>
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
          <span class="control-panel__label">Touch gestures</span>
          <button type="button" class="control-panel__dismiss" data-dismiss-gesture-hints>Got it</button>
        </div>
        <p class="control-panel__microcopy">Once audio starts, try these quick moves:</p>
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
          <span class="control-panel__label">What changes first</span>
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
    </details>
  `;
}

function renderAdvancedSources(options: AudioControlsOptions) {
  if (!options.onRequestTabAudio && !options.onRequestYouTubeAudio) {
    return '';
  }

  return `
    <details class="control-panel__details" data-advanced-inputs>
      <summary class="control-panel__label">More audio sources</summary>
      <p class="control-panel__advanced-helper">Use these when you want visuals to react to music or videos already playing in your browser.</p>
      <div id="advanced-audio-panel" class="control-panel__advanced" data-advanced-panel>
        ${
          options.onRequestTabAudio
            ? `
        <div class="control-panel__row">
          <div class="control-panel__text">
            <span class="control-panel__label">Tab capture</span>
            <span class="control-panel__info-wrap">
              <button
                class="control-panel__info"
                type="button"
                aria-describedby="tab-audio-info"
              >
                Tab tips
              </button>
              <span id="tab-audio-info" class="control-panel__info-text">
                Capture sound from the current tab. In the picker, choose “This tab” and enable
                Share audio.
              </span>
            </span>
          </div>
          <button id="use-tab-audio" class="cta-button" type="button">Capture tab</button>
        </div>
        `
            : ''
        }
        ${
          options.onRequestYouTubeAudio
            ? `
        <div class="control-panel__row control-panel__row--stacked">
          <div class="control-panel__text">
            <span class="control-panel__label">YouTube capture</span>
            <span class="control-panel__info-wrap">
              <button
                class="control-panel__info"
                type="button"
                aria-describedby="youtube-audio-info"
              >
                YouTube tips
              </button>
              <span id="youtube-audio-info" class="control-panel__info-text">
                Paste a link, load it, then capture. In the picker, choose “This tab” and enable
                Share audio. The embedded video keeps playing with sound here while it drives the toy.
              </span>
            </span>
          </div>
          <div class="control-panel__field">
            <label class="sr-only" for="youtube-url">YouTube URL</label>
            <input
              id="youtube-url"
              class="control-panel__input"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              autocomplete="off"
              inputmode="url"
            />
            <button id="load-youtube" class="cta-button" type="button">Load</button>
          </div>
          <p id="youtube-url-feedback" class="control-panel__microcopy" data-youtube-url-feedback role="status" aria-live="polite">Paste a full YouTube link to enable Load.</p>
          <div id="recent-youtube" class="control-panel__recent" hidden>
            <span class="control-panel__label small">Recent</span>
            <div id="recent-list" class="control-panel__chip-list"></div>
          </div>
          <div class="control-panel__actions control-panel__actions--inline">
            <button id="use-youtube-audio" class="cta-button" type="button">Capture YouTube</button>
          </div>
          <div id="youtube-player-container" class="control-panel__embed" hidden>
            <div id="youtube-player"></div>
          </div>
        </div>
        `
            : ''
        }
      </div>
    </details>
  `;
}

function setupYouTubeLogic(
  container: HTMLElement,
  controller: YouTubeController,
  onUse: (stream: MediaStream) => Promise<void>,
  updateStatus: (msg: string, v?: 'success' | 'error') => void,
  onSuccess?: () => void,
) {
  const doc = container.ownerDocument;
  const input = container.querySelector('#youtube-url') as HTMLInputElement;
  const loadBtn = container.querySelector('#load-youtube');
  const useBtn = container.querySelector(
    '#use-youtube-audio',
  ) as HTMLButtonElement;
  const playerContainer = container.querySelector(
    '#youtube-player-container',
  ) as HTMLElement;
  const recentContainer = container.querySelector(
    '#recent-youtube',
  ) as HTMLElement;
  const recentList = container.querySelector('#recent-list') as HTMLElement;
  const urlFeedback = container.querySelector(
    '[data-youtube-url-feedback]',
  ) as HTMLElement | null;
  const STORAGE_KEY = 'stims-youtube-url';
  let youtubeReady = false;

  const setUseButtonReadyState = () => {
    if (!useBtn) return;
    useBtn.disabled = !youtubeReady;
    useBtn.setAttribute('aria-disabled', String(!youtubeReady));
  };

  const setLoadButtonValidityState = () => {
    if (!input || !(loadBtn instanceof HTMLButtonElement)) return;
    const value = input.value.trim();
    const videoId = controller.parseVideoId(input.value);
    const isValid = Boolean(videoId);
    loadBtn.disabled = !isValid;
    loadBtn.setAttribute('aria-disabled', String(!isValid));
    input.setAttribute('aria-invalid', value ? String(!isValid) : 'false');
    if (urlFeedback) {
      if (!value) {
        urlFeedback.textContent = 'Paste a full YouTube link to enable Load.';
      } else if (!isValid) {
        urlFeedback.textContent =
          'That link was not recognized. Try a full youtube.com/watch URL.';
      } else {
        urlFeedback.textContent = 'Link looks good. Press Load to continue.';
      }
    }
  };
  const readStoredUrl = () => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  };
  const writeStoredUrl = (value: string) => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch (_error) {
      // Ignore storage errors.
    }
  };

  const updateRecentList = () => {
    const recent = controller.getRecentVideos();
    if (recent.length === 0) {
      recentContainer.hidden = true;
      return;
    }
    recentContainer.hidden = false;
    recentList.innerHTML = '';
    recent.forEach((v) => {
      const chip = doc.createElement('button');
      chip.className = 'control-panel__chip';
      chip.textContent = v.id;
      chip.title = `Load video ${v.id}`;
      chip.type = 'button';
      chip.setAttribute('aria-label', `Load video ${v.id}`);
      chip.addEventListener('click', () => {
        input.value = `https://www.youtube.com/watch?v=${v.id}`;
        writeStoredUrl(input.value);
        setLoadButtonValidityState();
        loadVideo(v.id);
      });
      recentList.appendChild(chip);
    });
  };

  const loadVideo = async (id: string) => {
    try {
      playerContainer.hidden = false;
      youtubeReady = false;
      setUseButtonReadyState();
      updateStatus('Loading player…', 'success');
      await controller.loadVideo('youtube-player', id, (state) => {
        if (state === 1) {
          // Playing
          updateStatus('Ready to capture audio.', 'success');
          youtubeReady = true;
          setUseButtonReadyState();
        }
      });
      updateStatus('Video loaded.', 'success');
      updateRecentList();
    } catch (_err) {
      updateStatus('Failed to load YouTube player.');
      playerContainer.hidden = true;
      youtubeReady = false;
      setUseButtonReadyState();
    }
  };

  if (input) {
    input.setAttribute('aria-describedby', 'youtube-url-feedback');
  }
  setUseButtonReadyState();
  setLoadButtonValidityState();
  updateRecentList();

  if (input) {
    const storedUrl = readStoredUrl();
    if (storedUrl) {
      input.value = storedUrl;
      setLoadButtonValidityState();
    }
    input.addEventListener('input', () => {
      writeStoredUrl(input.value);
      youtubeReady = false;
      setUseButtonReadyState();
      setLoadButtonValidityState();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (loadBtn instanceof HTMLButtonElement && loadBtn.disabled) return;
      loadBtn?.dispatchEvent(new Event('click'));
    });
  }

  loadBtn?.addEventListener('click', () => {
    const videoId = controller.parseVideoId(input.value);
    if (!videoId) {
      updateStatus('Paste a valid YouTube link.');
      youtubeReady = false;
      setUseButtonReadyState();
      input.focus();
      return;
    }
    loadVideo(videoId);
  });

  useBtn?.addEventListener('click', async () => {
    if (!youtubeReady) {
      updateStatus('Load a YouTube video first.');
      input.focus();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      updateStatus('Screen capture unavailable.');
      return;
    }

    try {
      useBtn.disabled = true;
      useBtn.toggleAttribute('data-loading', true);
      useBtn.setAttribute('aria-busy', 'true');
      updateStatus('Select tab to capture audio.', 'success');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        updateStatus('No audio track detected.');
        return;
      }
      await onUse(stream);
      onSuccess?.();
      updateStatus('YouTube audio connected.', 'success');
    } catch (_err) {
      updateStatus('YouTube audio capture failed.');
    } finally {
      useBtn.disabled = false;
      useBtn.toggleAttribute('data-loading', false);
      useBtn.setAttribute('aria-busy', 'false');
    }
  });
}
