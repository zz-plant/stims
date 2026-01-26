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
  container.innerHTML = `
    <p class="control-panel__description">
      Choose an audio source to drive the visuals.
    </p>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Microphone</span>
      </div>
      <button id="start-audio-btn" class="cta-button primary" type="button">
        Use microphone
      </button>
    </div>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Demo audio</span>
      </div>
      <button id="use-demo-audio" class="cta-button" type="button">Use demo audio</button>
    </div>

    ${
      options.onRequestTabAudio
        ? `
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Tab audio</span>
        <span class="control-panel__info-wrap">
          <button
            class="control-panel__info"
            type="button"
            aria-describedby="tab-audio-info"
          >
            More info
          </button>
          <span id="tab-audio-info" class="control-panel__info-text">
            Capture audio from the current browser tab. In the picker, choose “This tab” and
            enable Share audio.
          </span>
        </span>
      </div>
      <button id="use-tab-audio" class="cta-button" type="button">Capture tab audio</button>
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
        <span class="control-panel__info-wrap">
          <button
            class="control-panel__info"
            type="button"
            aria-describedby="youtube-audio-info"
          >
            More info
          </button>
          <span id="youtube-audio-info" class="control-panel__info-text">
            Paste a link, load the video, then start capture. In the picker, choose “This tab” and
            enable Share audio.
          </span>
        </span>
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
        <button id="load-youtube" class="cta-button" type="button">Load video</button>
      </div>
      <div id="recent-youtube" class="control-panel__recent" hidden>
        <span class="control-panel__label small">Recent</span>
        <div id="recent-list" class="control-panel__chip-list"></div>
      </div>
      <div class="control-panel__actions control-panel__actions--inline">
        <button id="use-youtube-audio" class="cta-button" type="button">
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

  const preferDemoAudio =
    options.preferDemoAudio ?? readStoredSource() === 'demo';

  if (preferDemoAudio && demoBtn instanceof HTMLButtonElement) {
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
    successMessage?: string,
  ) => {
    setPending(button, true);
    try {
      await action();
      if (successMessage) {
        updateStatus(successMessage, 'success');
      }
      options.onSuccess?.();
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
    );
  });

  if (options.onRequestYouTubeAudio) {
    setupYouTubeLogic(
      container,
      youtubeController,
      options.onRequestYouTubeAudio,
      updateStatus,
      options.onSuccess,
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
      youtubeReady = false;
      updateStatus('Loading player...', 'success');
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
