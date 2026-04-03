import { setMilkdropCapturedVideoStream } from '../core/services/captured-video-texture.ts';
import type { AudioControlsOptions } from './audio-controls.ts';
import { YouTubeController } from './youtube-controller';
import {
  hideYouTubeStageLayer,
  mountYouTubeStageLayer,
  syncYouTubeStagePreview,
} from './youtube-stage-layer.ts';

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
      <summary class="control-panel__label">Browser audio</summary>
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
          <p id="youtube-url-feedback" class="control-panel__microcopy" data-youtube-url-feedback role="status" aria-live="polite">Paste a YouTube link or video ID to load it.</p>
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
  onPrepareContext?: () => Promise<void> | void,
) {
  type ValidYouTubeReference = NonNullable<
    ReturnType<YouTubeController['parseVideoReference']>
  >;

  const controller = new YouTubeController();
  const doc = container.ownerDocument;
  let input = container.querySelector('#youtube-url') as HTMLInputElement;
  let loadBtn = container.querySelector('#load-youtube');
  let useBtn = container.querySelector(
    '#use-youtube-audio',
  ) as HTMLButtonElement;
  let playerContainer = container.querySelector(
    '#youtube-player-container',
  ) as HTMLElement;
  let recentContainer = container.querySelector(
    '#recent-youtube',
  ) as HTMLElement;
  let recentList = container.querySelector('#recent-list') as HTMLElement;
  let urlFeedback = container.querySelector(
    '[data-youtube-url-feedback]',
  ) as HTMLElement | null;
  const STORAGE_KEY = 'stims-youtube-url';
  let youtubeReady = false;
  let isLoadingVideo = false;
  let loadedVideoKey: string | null = null;

  const refreshElements = () => {
    input = container.querySelector('#youtube-url') as HTMLInputElement;
    loadBtn = container.querySelector('#load-youtube');
    useBtn = container.querySelector('#use-youtube-audio') as HTMLButtonElement;
    playerContainer = (doc.getElementById('youtube-player-container') ??
      container.querySelector('#youtube-player-container')) as HTMLElement;
    recentContainer = container.querySelector('#recent-youtube') as HTMLElement;
    recentList = container.querySelector('#recent-list') as HTMLElement;
    urlFeedback = container.querySelector(
      '[data-youtube-url-feedback]',
    ) as HTMLElement | null;
  };

  const setUseButtonReadyState = () => {
    if (!useBtn) return;
    useBtn.disabled = !youtubeReady;
    useBtn.setAttribute('aria-disabled', String(!youtubeReady));
  };

  const setLoadButtonPendingState = (pending: boolean) => {
    if (!(loadBtn instanceof HTMLButtonElement)) return;
    loadBtn.disabled = pending;
    loadBtn.toggleAttribute('data-loading', pending);
    loadBtn.setAttribute('aria-busy', pending ? 'true' : 'false');
    loadBtn.setAttribute('aria-disabled', pending ? 'true' : 'false');
  };

  const setLoadButtonValidityState = () => {
    if (!input || !(loadBtn instanceof HTMLButtonElement)) return;
    const value = input.value.trim();
    const reference = controller.parseVideoReference(input.value);
    const isValid = Boolean(reference);
    loadBtn.disabled = isLoadingVideo || !isValid;
    loadBtn.setAttribute('aria-disabled', String(isLoadingVideo || !isValid));
    input.setAttribute('aria-invalid', value ? String(!isValid) : 'false');
    if (urlFeedback) {
      if (!value) {
        urlFeedback.textContent =
          'Paste a YouTube link or video ID to load it.';
      } else if (!isValid) {
        urlFeedback.textContent =
          'That link or ID was not recognized. Try a YouTube watch/share link or an 11-character video ID.';
      } else if (loadedVideoKey && reference?.canonicalUrl === loadedVideoKey) {
        urlFeedback.textContent =
          'Video is ready. Choose Capture YouTube to continue.';
      } else if (isLoadingVideo) {
        urlFeedback.textContent = 'Loading the embedded player…';
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
      const title = video.title.trim() || video.id;
      const titleLabel = doc.createElement('span');
      titleLabel.className = 'control-panel__chip-title';
      titleLabel.textContent = title;
      const metaLabel = doc.createElement('span');
      metaLabel.className = 'control-panel__chip-meta';
      metaLabel.textContent = video.id;
      chip.append(titleLabel, metaLabel);
      chip.title = `Load ${title}`;
      chip.type = 'button';
      chip.setAttribute('aria-label', `Load ${title}`);
      chip.addEventListener('click', () => {
        input.value = `https://www.youtube.com/watch?v=${video.id}`;
        writeStoredUrl(input.value);
        setLoadButtonValidityState();
        void loadVideo(video.id);
      });
      recentList.appendChild(chip);
    });
  };

  const loadVideo = async (video: string | ValidYouTubeReference) => {
    const reference =
      typeof video === 'string' ? controller.parseVideoReference(video) : video;
    if (!reference) {
      updateStatus('Paste a valid YouTube link.');
      youtubeReady = false;
      loadedVideoKey = null;
      hideYouTubeStageLayer(doc);
      setUseButtonReadyState();
      setLoadButtonValidityState();
      input.focus();
      return;
    }

    try {
      await onPrepareContext?.();
      refreshElements();
      playerContainer.hidden = false;
      isLoadingVideo = true;
      youtubeReady = false;
      loadedVideoKey = null;
      setLoadButtonPendingState(true);
      setUseButtonReadyState();
      setLoadButtonValidityState();
      updateStatus('Loading player…', 'success');
      await controller.loadVideo('youtube-player', reference, (state) => {
        if (state === 1) {
          youtubeReady = true;
          setUseButtonReadyState();
        }
      });
      mountYouTubeStageLayer(playerContainer);
      loadedVideoKey = reference.canonicalUrl;
      updateStatus('Ready to capture audio.', 'success');
      setLoadButtonValidityState();
      updateRecentList();
    } catch (_err) {
      updateStatus('Failed to load YouTube player.');
      playerContainer.hidden = true;
      loadedVideoKey = null;
      youtubeReady = false;
      hideYouTubeStageLayer(doc);
      setUseButtonReadyState();
      setLoadButtonValidityState();
    } finally {
      isLoadingVideo = false;
      setLoadButtonPendingState(false);
      setLoadButtonValidityState();
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
      loadedVideoKey = null;
      hideYouTubeStageLayer(doc);
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
    const reference = controller.parseVideoReference(input.value);
    if (!reference) {
      updateStatus('Paste a valid YouTube link.');
      youtubeReady = false;
      loadedVideoKey = null;
      hideYouTubeStageLayer(doc);
      setUseButtonReadyState();
      setLoadButtonValidityState();
      input.focus();
      return;
    }
    void loadVideo(reference);
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
      await setMilkdropCapturedVideoStream(stream, {
        cropTarget: playerContainer,
      });
      syncYouTubeStagePreview(doc);
      await onUse(stream);
      onSuccess?.();
      updateStatus('YouTube video is feeding the preset.', 'success');
    } catch (_err) {
      updateStatus('YouTube audio capture failed.');
    } finally {
      useBtn.disabled = false;
      useBtn.toggleAttribute('data-loading', false);
      useBtn.setAttribute('aria-busy', 'false');
    }
  });
}
