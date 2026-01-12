import { YouTubeController } from './youtube-controller';

export interface AudioControlsOptions {
  onRequestMicrophone: () => Promise<void>;
  onRequestDemoAudio: () => Promise<void>;
  onRequestYouTubeAudio?: (stream: MediaStream) => Promise<void>;
  onSuccess?: () => void;
  statusElement?: HTMLElement;
}

export function initAudioControls(
  container: HTMLElement,
  options: AudioControlsOptions,
) {
  const doc = container.ownerDocument;
  const youtubeController = new YouTubeController();

  container.className = 'control-panel';
  container.innerHTML = `
    <div class="control-panel__heading">Audio controls</div>
    <p class="control-panel__description">
      Choose how to feed audio: use your microphone for live input, or load
      our demo track to preview instantly.
    </p>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Microphone</span>
        <small>Uses your device mic for the most responsive visuals.</small>
      </div>
      <button id="start-audio-btn" class="cta-button primary">
        Use microphone
      </button>
    </div>
    <div class="control-panel__row">
      <div class="control-panel__text">
        <span class="control-panel__label">Demo audio</span>
        <small>No mic needed—start with a built-in track.</small>
      </div>
      <button id="use-demo-audio" class="cta-button">Use demo audio</button>
    </div>
    
    ${
      options.onRequestYouTubeAudio
        ? `
    <div class="control-panel__row control-panel__row--stacked">
      <div class="control-panel__text">
        <span class="control-panel__label">YouTube audio</span>
        <small>
          Paste a YouTube link to load a video. When you start audio, choose
          “This tab” and enable audio sharing.
        </small>
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
    
    <div id="audio-status" class="control-panel__status" role="status" hidden></div>
  `;

  const micBtn = container.querySelector('#start-audio-btn');
  const demoBtn = container.querySelector('#use-demo-audio');
  const statusEl = (options.statusElement ||
    container.querySelector('#audio-status')) as HTMLElement;

  const updateStatus = (
    message: string,
    variant: 'success' | 'error' = 'error',
  ) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.dataset.variant = variant;
    statusEl.textContent = message;
  };

  micBtn?.addEventListener('click', async () => {
    try {
      await options.onRequestMicrophone();
      options.onSuccess?.();
    } catch (err) {
      updateStatus(
        err instanceof Error ? err.message : 'Microphone access failed.',
      );
    }
  });

  demoBtn?.addEventListener('click', async () => {
    try {
      await options.onRequestDemoAudio();
      options.onSuccess?.();
    } catch (err) {
      updateStatus(
        err instanceof Error ? err.message : 'Demo audio failed to load.',
      );
    }
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
  const playerContainer = container.querySelector('#youtube-player-container') as HTMLElement;
  const recentContainer = container.querySelector('#recent-youtube') as HTMLElement;
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
        if (state === 1) { // Playing
           updateStatus('Video playing. Ready to capture audio.', 'success');
           useBtn.disabled = false;
        }
      });
      updateStatus('Video loaded. Press play to start.', 'success');
      updateRecentList();
    } catch (err) {
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
    } catch (err) {
      updateStatus('YouTube audio capture failed.');
    }
  });
}
