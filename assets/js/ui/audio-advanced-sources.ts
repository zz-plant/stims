import type { AudioControlsOptions } from './audio-controls.ts';
import { YouTubeController } from './youtube-controller';

function renderSourceHelpDisclosure({
  sourceLabelId,
  summaryId,
  panelId,
  summary,
  content,
}: {
  sourceLabelId: string;
  summaryId: string;
  panelId: string;
  summary: string;
  content: string;
}) {
  return `
    <details class="control-panel__info-wrap control-panel__info-disclosure">
      <summary
        id="${summaryId}"
        class="control-panel__info"
        aria-controls="${panelId}"
      >
        ${summary}
      </summary>
      <div
        id="${panelId}"
        class="control-panel__info-text"
        role="note"
        aria-labelledby="${sourceLabelId} ${summaryId}"
      >
        ${content}
      </div>
    </details>
  `;
}

export function renderAdvancedAudioSources(
  options: Pick<
    AudioControlsOptions,
    'onRequestTabAudio' | 'onRequestYouTubeAudio'
  >,
) {
  if (!options.onRequestTabAudio && !options.onRequestYouTubeAudio) {
    return '';
  }

  return `
    <details class="control-panel__details" data-advanced-inputs>
      <summary class="control-panel__label">More sources</summary>
      <p class="control-panel__advanced-helper">Use these for audio already playing in your browser.</p>
      <div id="advanced-audio-panel" class="control-panel__advanced" data-advanced-panel>
        ${
          options.onRequestTabAudio
            ? `
        <div class="control-panel__row">
          <div class="control-panel__text">
            <span id="tab-audio-label" class="control-panel__label">Tab capture</span>
            ${renderSourceHelpDisclosure({
              sourceLabelId: 'tab-audio-label',
              summaryId: 'tab-audio-summary',
              panelId: 'tab-audio-info',
              summary: 'Tab tips',
              content:
                'Capture sound from the current tab. In the picker, choose “This tab” and enable Share audio.',
            })}
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
            <span id="youtube-audio-label" class="control-panel__label">YouTube capture</span>
            ${renderSourceHelpDisclosure({
              sourceLabelId: 'youtube-audio-label',
              summaryId: 'youtube-audio-summary',
              panelId: 'youtube-audio-info',
              summary: 'YouTube tips',
              content:
                'Paste a link, load it, then capture. In the picker, choose “This tab” and enable Share audio. The embedded video keeps playing with sound here while it drives the visualizer.',
            })}
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
          <p id="youtube-url-feedback" class="control-panel__microcopy" data-youtube-url-feedback role="status" aria-live="polite">Paste a full YouTube link to load it.</p>
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

export async function captureDisplayAudioStream({
  unavailableMessage,
  missingAudioMessage = 'No audio track detected.',
}: {
  unavailableMessage: string;
  missingAudioMessage?: string;
}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(unavailableMessage);
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(missingAudioMessage);
  }
  return stream;
}

export function setupYouTubeAudioControls(
  container: HTMLElement,
  onUse: (stream: MediaStream) => Promise<void>,
  updateStatus: (msg: string, v?: 'success' | 'error') => void,
  onSuccess?: () => void,
) {
  const controller = new YouTubeController();
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
        urlFeedback.textContent = 'Paste a full YouTube link to load it.';
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
    recent.forEach((video) => {
      const chip = doc.createElement('button');
      chip.className = 'control-panel__chip';
      chip.textContent = video.id;
      chip.title = `Load video ${video.id}`;
      chip.type = 'button';
      chip.setAttribute('aria-label', `Load video ${video.id}`);
      chip.addEventListener('click', () => {
        input.value = `https://www.youtube.com/watch?v=${video.id}`;
        writeStoredUrl(input.value);
        setLoadButtonValidityState();
        void loadVideo(video.id);
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
    void loadVideo(videoId);
  });

  useBtn?.addEventListener('click', async () => {
    if (!youtubeReady) {
      updateStatus('Load a YouTube video first.');
      input.focus();
      return;
    }

    try {
      useBtn.disabled = true;
      useBtn.toggleAttribute('data-loading', true);
      useBtn.setAttribute('aria-busy', 'true');
      updateStatus('Select tab to capture audio.', 'success');
      const stream = await captureDisplayAudioStream({
        unavailableMessage: 'Screen capture unavailable.',
      });
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
