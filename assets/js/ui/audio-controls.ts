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
}

export function initAudioControls(
  container: HTMLElement,
  options: AudioControlsOptions,
) {
  const _doc = container.ownerDocument;
  const youtubeController = new YouTubeController();

  container.className = 'control-panel';
  container.innerHTML = `
    <p class="control-panel__description">
      Choose an audio source to drive the visuals.
    </p>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Microphone</span>
      </div>
      <button id="start-audio-btn" class="cta-button primary">
        Use microphone
      </button>
    </div>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Demo audio</span>
      </div>
      <button id="use-demo-audio" class="cta-button">Use demo audio</button>
    </div>

    ${
      options.onRequestTabAudio
        ? `
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Tab audio</span>
        <small>Capture audio from the current browser tab.</small>
      </div>
      <button id="use-tab-audio" class="cta-button">Capture tab audio</button>
    </div>
    `
        : ''
    }
    
    ${
      options.onRequestYouTubeAudio
        ? `
    <div class="control-panel__row control-panel__row--stacked">
      <div class="control-panel__text">
        <span class="control-panel__label">YouTube audio</span>
        <small>Paste a link and enable audio sharing during capture.</small>
      </div>
      <div class="control-panel__field">
        <label class="sr-only" for="youtube-url">YouTube URL</label>
        <input
          id="youtube-url"
          class="control-panel__input"
          type="url"
          placeholder="https://www.youtube.com/watch?v=..."
          autocomplete="off"
          inputmode="url"
        />
        <button id="load-youtube" class="cta-button">Load video</button>
      </div>
      <div id="recent-youtube" class="control-panel__recent" hidden>
        <span class="control-panel__label small">Recent</span>
        <div id="recent-list" class="control-panel__chip-list"></div>
      </div>
      <div class="control-panel__actions control-panel__actions--inline">
        <button id="use-youtube-audio" class="cta-button" disabled>
          Use YouTube audio
        </button>
      </div>
      <div id="youtube-player-container" class="control-panel__embed" hidden>
        <div id="youtube-player"></div>
      </div>
    </div>
    `
        : ''
    }
    
    <div id="audio-status" class="control-panel__status" role="status" aria-live="polite" hidden></div>
  `;

  const micBtn = container.querySelector('#start-audio-btn');
  const demoBtn = container.querySelector('#use-demo-audio');
  const tabBtn = container.querySelector('#use-tab-audio');
  const statusEl = (options.statusElement ||
    container.querySelector('#audio-status')) as HTMLElement;
  const requestTabAudio = options.onRequestTabAudio;

  const setPending = (button: Element | null, pending: boolean) => {
    if (!(button instanceof HTMLElement)) return;
    button.toggleAttribute('data-loading', pending);
    button.setAttribute('aria-busy', pending ? 'true' : 'false');
  };

  const setButtonsDisabled = (disabled: boolean) => {
    [micBtn, demoBtn, tabBtn].forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = disabled;
      }
    });
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
    if (demoBtn instanceof HTMLButtonElement) {
      demoBtn.classList.add('primary');
    }
    if (micBtn instanceof HTMLButtonElement) {
      micBtn.classList.remove('primary');
    }
  };

  const buildMicrophoneErrorMessage = (message: string) => {
    if (!message) {
      return 'Microphone access failed. Use demo audio to keep exploring.';
    }

    if (/demo audio/i.test(message)) {
      return message;
    }

    if (/microphone|audio/i.test(message)) {
      return `${message} Use demo audio to keep exploring.`;
    }

    return `${message} Use demo audio to keep exploring.`;
  };

  if (options.preferDemoAudio && demoBtn instanceof HTMLButtonElement) {
    demoBtn.classList.add('primary');
    if (micBtn instanceof HTMLButtonElement) {
      micBtn.classList.remove('primary');
    }
  }

  if (options.initialStatus) {
    updateStatus(
      options.initialStatus.message,
      options.initialStatus.variant ?? 'error',
    );
  }

  const handleRequest = async (
    button: Element | null,
    action: () => Promise<void>,
    errorMessage: string,
    onError?: (message: string) => void,
  ) => {
    setButtonsDisabled(true);
    setPending(button, true);
    try {
      await action();
      options.onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : errorMessage;
      updateStatus(message);
      onError?.(message);
    } finally {
      setPending(button, false);
      setButtonsDisabled(false);
    }
  };

  micBtn?.addEventListener('click', () => {
    void handleRequest(
      micBtn,
      options.onRequestMicrophone,
      'Microphone access failed.',
      (message) => {
        emphasizeDemoAudio();
        updateStatus(buildMicrophoneErrorMessage(message));
      },
    );
  });

  demoBtn?.addEventListener('click', () => {
    void handleRequest(
      demoBtn,
      options.onRequestDemoAudio,
      'Demo audio failed to load.',
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
        updateStatus('Choose “This tab” and enable audio sharing.', 'success');
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error('No audio track detected. Enable “Share audio”.');
        }
        await requestTabAudio(stream);
      },
      'Tab audio capture failed.',
    );
  });

  if (options.onRequestYouTubeAudio) {
    setupYouTubeLogic(
      container,
      youtubeController,
      options.onRequestYouTubeAudio,
      updateStatus,
      options.onSuccess,
      setButtonsDisabled,
    );
  }
}

function setupYouTubeLogic(
  container: HTMLElement,
  controller: YouTubeController,
  onUse: (stream: MediaStream) => Promise<void>,
  updateStatus: (msg: string, v?: 'success' | 'error') => void,
  onSuccess?: () => void,
  setButtonsDisabled?: (disabled: boolean) => void,
) {
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

  const updateRecentList = () => {
    const recent = controller.getRecentVideos();
    if (recent.length === 0) {
      recentContainer.hidden = true;
      return;
    }
    recentContainer.hidden = false;
    recentList.innerHTML = '';
    recent.forEach((v) => {
      const chip = document.createElement('button');
      chip.className = 'control-panel__chip';
      chip.textContent = v.id;
      chip.title = `Load video ${v.id}`;
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
      updateStatus('Loading player...', 'success');
      await controller.loadVideo('youtube-player', id, (state) => {
        if (state === 1) {
          // Playing
          updateStatus('Ready to capture audio.', 'success');
          useBtn.disabled = false;
        }
      });
      updateStatus('Video loaded.', 'success');
      updateRecentList();
    } catch (_err) {
      updateStatus('Failed to load YouTube player.');
      playerContainer.hidden = true;
    }
  };

  updateRecentList();

  loadBtn?.addEventListener('click', () => {
    const videoId = controller.parseVideoId(input.value);
    if (!videoId) {
      updateStatus('Paste a valid YouTube link.');
      useBtn.disabled = true;
      return;
    }
    loadVideo(videoId);
  });

  useBtn?.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      updateStatus('Screen capture unavailable.');
      return;
    }

    try {
      setButtonsDisabled?.(true);
      useBtn.disabled = true;
      useBtn.toggleAttribute('data-loading', true);
      useBtn.setAttribute('aria-busy', 'true');
      updateStatus('Choose “This tab” and enable audio sharing.', 'success');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        updateStatus('No audio track detected. Enable “Share audio”.');
        return;
      }
      await onUse(stream);
      onSuccess?.();
    } catch (_err) {
      updateStatus('YouTube audio capture failed.');
    } finally {
      useBtn.disabled = false;
      useBtn.toggleAttribute('data-loading', false);
      useBtn.setAttribute('aria-busy', 'false');
      setButtonsDisabled?.(false);
    }
  });
}
