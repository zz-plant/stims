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

  container.className = 'control-panel';
  const hasAdvancedOptions =
    Boolean(options.onRequestTabAudio) ||
    Boolean(options.onRequestYouTubeAudio);
  const firstRunHint = options.firstRunHint?.trim();
  const gestureHints = (options.gestureHints ?? options.starterTips ?? [])
    .filter((tip) => /touch|drag|pinch|swipe|gesture|tap|rotate/i.test(tip))
    .slice(0, 2);

  container.innerHTML = `
    <p class="control-panel__description">
      Choose how this toy listens.
    </p>
    <p class="control-panel__stage-label">Step 1 · Start audio</p>
    <section class="control-panel__first-steps" data-first-steps role="note" aria-label="First steps">
      <div class="control-panel__first-steps-header">
        <span class="control-panel__label">First 10 seconds</span>
        <button type="button" class="control-panel__dismiss" data-dismiss-first-steps>Dismiss</button>
      </div>
      <ul class="control-panel__tips control-panel__tips--compact">
        <li data-first-step-source>Start with mic for live input, or demo for instant audio.</li>
        <li>Then open quality controls and pick <strong>Low motion</strong> if you want a calmer feel.</li>
        <li>${firstRunHint ?? 'Tap or drag in the canvas once audio starts to quickly feel the response.'}</li>
      </ul>
    </section>
    <p class="control-panel__comparison" data-audio-comparison>
      Mic reacts to your space right now. Demo starts instantly with no permissions.
    </p>
    ${
      gestureHints.length > 0
        ? `
    <section class="control-panel__gesture-hints" data-gesture-hints hidden aria-live="polite">
      <span class="control-panel__label">Touch gestures</span>
      <p class="control-panel__microcopy">Once audio starts, try these quick moves:</p>
      <ul class="control-panel__tips control-panel__tips--compact">
        ${gestureHints.map((tip) => `<li>${tip}</li>`).join('')}
      </ul>
    </section>
    `
        : ''
    }
    ${
      options.starterTips && options.starterTips.length > 0
        ? `
    <div class="control-panel__quickstart" data-quickstart-panel>
      <span class="control-panel__label">Quick start tips</span>
      <ul class="control-panel__tips">
        ${options.starterTips
          .slice(0, 3)
          .map((tip) => `<li>${tip}</li>`)
          .join('')}
      </ul>
    </div>
    `
        : ''
    }
    <div class="control-panel__row" data-audio-row="mic">
      <div class="control-panel__text">
        <span class="control-panel__label">Live mic</span>
        <span class="control-panel__pill" data-recommended-for="mic" hidden>Recommended first try</span>
        <span class="control-panel__subtext">Best for live instruments, voice, and ambient sound.</span>
        <span class="control-panel__microcopy">Reacts to your room in real time. Requires microphone permission.</span>
      </div>
      <button id="start-audio-btn" class="cta-button ghost" type="button">
        Start mic-reactive mode
      </button>
    </div>
    <div class="control-panel__row" data-audio-row="demo">
      <div class="control-panel__text">
        <span class="control-panel__label">Curated demo</span>
        <span class="control-panel__pill" data-recommended-for="demo" hidden>Recommended first try</span>
        <span class="control-panel__subtext">Fastest way to preview visuals without permissions.</span>
        <span class="control-panel__microcopy">Starts instantly with built-in audio. Great first try when privacy-sensitive.</span>
      </div>
      <button id="use-demo-audio" class="cta-button primary" type="button">Preview instantly with demo audio</button>
    </div>

    ${
      hasAdvancedOptions
        ? `
    <p class="control-panel__stage-label">Step 2 · Advanced capture (optional)</p>
    <div class="control-panel__row control-panel__row--advanced-toggle">
      <button
        type="button"
        class="control-panel__advanced-toggle"
        aria-expanded="false"
        data-advanced-toggle
      >
        <span class="control-panel__advanced-title">Advanced audio options</span>
        <span class="control-panel__advanced-hint">Tab or YouTube capture for media already playing</span>
      </button>
    </div>
    <p class="control-panel__advanced-helper">Use these when you want visuals to react to music or videos already playing in your browser.</p>
    <div class="control-panel__advanced" data-advanced-panel hidden>
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
              More info
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
              More info
            </button>
            <span id="youtube-audio-info" class="control-panel__info-text">
              Paste a link, load it, then capture. In the picker, choose “This tab” and enable
              Share audio.
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
        <div id="recent-youtube" class="control-panel__recent" hidden>
          <span class="control-panel__label small">Recent</span>
          <div id="recent-list" class="control-panel__chip-list"></div>
        </div>
        <div class="control-panel__actions control-panel__actions--inline">
          <button id="use-youtube-audio" class="cta-button" type="button">
            Capture YouTube
          </button>
        </div>
        <div id="youtube-player-container" class="control-panel__embed" hidden>
          <div id="youtube-player"></div>
        </div>
      </div>
      `
          : ''
      }
    </div>
    `
        : ''
    }

    <div id="audio-status" class="control-panel__status" role="status" aria-live="polite" hidden></div>
  `;

  const micBtn = container.querySelector('#start-audio-btn');
  const demoBtn = container.querySelector('#use-demo-audio');
  const tabBtn = container.querySelector('#use-tab-audio');
  const micRow = container.querySelector('[data-audio-row="mic"]');
  const demoRow = container.querySelector('[data-audio-row="demo"]');
  const statusEl = (options.statusElement ||
    container.querySelector('#audio-status')) as HTMLElement;
  const requestTabAudio = options.onRequestTabAudio;
  const advancedToggle = container.querySelector(
    '[data-advanced-toggle]',
  ) as HTMLButtonElement | null;
  const advancedPanel = container.querySelector(
    '[data-advanced-panel]',
  ) as HTMLElement | null;
  const ADVANCED_KEY = 'stims-audio-advanced-open';
  const FIRST_STEPS_KEY = 'stims-first-steps-dismissed';
  const GESTURE_HINT_KEY = 'stims-gesture-hints-dismissed';

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
        ? 'Start with mic for live response from your room in real time.'
        : 'Start with demo for instant sound with no permission prompts.';
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

  if (preferDemoAudio && demoBtn instanceof HTMLButtonElement) {
    setPreferredSource('demo');
  } else {
    setPreferredSource('microphone');
  }

  const firstStepsPanel = container.querySelector(
    '[data-first-steps]',
  ) as HTMLElement | null;
  const dismissFirstSteps = container.querySelector(
    '[data-dismiss-first-steps]',
  ) as HTMLButtonElement | null;

  if (firstStepsPanel) {
    let isDismissed = false;
    try {
      isDismissed = window.sessionStorage.getItem(FIRST_STEPS_KEY) === 'true';
    } catch (_error) {
      isDismissed = false;
    }

    const hideFirstSteps = () => {
      firstStepsPanel.hidden = true;
      try {
        window.sessionStorage.setItem(FIRST_STEPS_KEY, 'true');
      } catch (_error) {
        // Ignore storage errors.
      }
    };

    if (isDismissed) {
      firstStepsPanel.hidden = true;
    } else {
      window.setTimeout(() => {
        if (!firstStepsPanel.hidden) {
          hideFirstSteps();
        }
      }, 10000);
    }

    dismissFirstSteps?.addEventListener('click', hideFirstSteps);
  }

  const gestureHintsPanel = container.querySelector(
    '[data-gesture-hints]',
  ) as HTMLElement | null;
  const supportsTouchLikeInput =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches) ||
    navigator.maxTouchPoints > 0;

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
    const hideAfterInteractions = () => {
      interactionCount += 1;
      if (interactionCount < 2) return;
      gestureHintsPanel.hidden = true;
      window.removeEventListener('pointerdown', hideAfterInteractions);
      try {
        window.sessionStorage.setItem(GESTURE_HINT_KEY, 'true');
      } catch (_error) {
        // Ignore storage errors.
      }
    };

    window.addEventListener('pointerdown', hideAfterInteractions, {
      passive: true,
    });
  };

  const handleSuccess = () => {
    options.onSuccess?.();
    showGestureHints();
  };

  if (options.initialStatus) {
    updateStatus(
      options.initialStatus.message,
      options.initialStatus.variant ?? 'error',
    );
  }

  if (advancedToggle && advancedPanel) {
    let isOpen = false;
    try {
      isOpen = window.sessionStorage.getItem(ADVANCED_KEY) === 'true';
    } catch (_error) {
      isOpen = false;
    }
    advancedPanel.hidden = !isOpen;
    advancedToggle.setAttribute('aria-expanded', String(isOpen));
    advancedToggle.addEventListener('click', () => {
      const nextState = advancedPanel.hidden;
      advancedPanel.hidden = !nextState;
      advancedToggle.setAttribute('aria-expanded', String(nextState));
      try {
        window.sessionStorage.setItem(ADVANCED_KEY, String(nextState));
      } catch (_error) {
        // Ignore storage errors.
      }
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
        writeStoredSource('microphone');
      },
      'Microphone access failed.',
      (message) => {
        emphasizeDemoAudio();
        updateStatus(buildMicrophoneErrorMessage(message));
      },
      'Mic connected.',
      'Starting microphone…',
    );
  });

  demoBtn?.addEventListener('click', () => {
    void handleRequest(
      demoBtn,
      async () => {
        await options.onRequestDemoAudio();
        writeStoredSource('demo');
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
  const STORAGE_KEY = 'stims-youtube-url';
  let youtubeReady = false;
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
        loadVideo(v.id);
      });
      recentList.appendChild(chip);
    });
  };

  const loadVideo = async (id: string) => {
    try {
      playerContainer.hidden = false;
      youtubeReady = false;
      updateStatus('Loading player…', 'success');
      await controller.loadVideo('youtube-player', id, (state) => {
        if (state === 1) {
          // Playing
          updateStatus('Ready to capture audio.', 'success');
          youtubeReady = true;
        }
      });
      updateStatus('Video loaded.', 'success');
      updateRecentList();
    } catch (_err) {
      updateStatus('Failed to load YouTube player.');
      playerContainer.hidden = true;
      youtubeReady = false;
    }
  };

  updateRecentList();

  if (input) {
    const storedUrl = readStoredUrl();
    if (storedUrl) {
      input.value = storedUrl;
    }
    input.addEventListener('input', () => {
      writeStoredUrl(input.value);
      youtubeReady = false;
    });
  }

  loadBtn?.addEventListener('click', () => {
    const videoId = controller.parseVideoId(input.value);
    if (!videoId) {
      updateStatus('Paste a valid YouTube link.');
      youtubeReady = false;
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
