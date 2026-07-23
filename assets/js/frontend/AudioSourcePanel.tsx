import { useId } from 'react';
import { isMobileDevice } from '../utils/device-detect.ts';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

type AudioSourcePanelProps = {
  showHelp?: boolean;
};

export function AudioSourcePanel({ showHelp = true }: AudioSourcePanelProps) {
  const sourcePanelId = useId();
  const sourceHeadingId = `${sourcePanelId}-source-heading`;
  const engineStatusId = `${sourcePanelId}-engine-status`;
  const youtubeInputId = `${sourcePanelId}-youtube-url`;
  const youtubeFeedbackId = `${sourcePanelId}-youtube-feedback`;
  const youtubeContainerId = `${sourcePanelId}-youtube-player-container`;
  const disabledDescription = engineStatusId;
  const { ui, engine } = useWorkspace();
  const engineReady = engine.engineReady;
  const onAudioStart = (source: 'demo' | 'microphone' | 'tab' | 'youtube') =>
    engine.handleAudioStart(source);
  const onLoadRecentYouTubeVideo = (videoId: string) =>
    engine.loadRecentYouTubeVideo(videoId, () => onAudioStart('youtube'));
  const onYoutubeUrlChange = ui.setYoutubeUrl;
  const onYoutubeUrlKeyDown = engine.handleYoutubeUrlKeyDown;
  const recentYouTubeVideos = ui.recentYouTubeVideos;
  const youtubeCanLoad = ui.youtubeCanLoad;
  const youtubeFeedback = ui.youtubeFeedback;
  const youtubeInputInvalid = ui.youtubeInputInvalid;
  const youtubeLoading = ui.youtubeLoading;
  const youtubePreviewRef = ui.youtubePreviewRef;
  const youtubeReady = ui.youtubeReady;
  const youtubeUrl = ui.youtubeUrl;

  // Tab-audio capture relies on getDisplayMedia, which mobile browsers don't
  // implement (and even where the API exists on tablets, audio sharing is
  // unavailable). Hide the card rather than offer an action that always fails.
  const canCaptureTabAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !isMobileDevice();

  const handlePlayYouTube = () => {
    if (youtubeReady) {
      void onAudioStart('youtube');
    } else {
      void engine.loadYouTubePreview(youtubeUrl, () => onAudioStart('youtube'));
    }
  };

  return (
    <section
      className="stims-shell__source-panel"
      aria-labelledby={sourceHeadingId}
      aria-busy={!engineReady}
    >
      <div className="stims-shell__source-heading">
        <h2 id={sourceHeadingId} className="stims-shell__section-label">
          YouTube playback
        </h2>
      </div>
      {!engineReady ? (
        <p
          id={engineStatusId}
          className="stims-shell__meta-copy"
          aria-live="polite"
        >
          Audio engine is starting. Sources will unlock in a moment.
        </p>
      ) : null}
      <div className="stims-shell__youtube stims-shell__youtube-primary">
        <label className="stims-shell__field-label" htmlFor={youtubeInputId}>
          YouTube link
        </label>
        <div className="stims-shell__youtube-row">
          <input
            id={youtubeInputId}
            className="stims-shell__input"
            type="url"
            placeholder="Paste a YouTube link..."
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
            data-youtube-url-input="true"
            aria-describedby={
              !engineReady
                ? `${youtubeFeedbackId} ${disabledDescription}`
                : youtubeFeedbackId
            }
            aria-invalid={youtubeInputInvalid}
            value={youtubeUrl}
            onChange={(event) => onYoutubeUrlChange(event.target.value)}
            onKeyDown={(e) =>
              onYoutubeUrlKeyDown(e, () => onAudioStart('youtube'))
            }
          />
          <button
            id="load-youtube"
            className="cta-button primary"
            type="button"
            disabled={!engineReady || !youtubeCanLoad || youtubeLoading}
            aria-disabled={!engineReady || !youtubeCanLoad || youtubeLoading}
            aria-describedby={!engineReady ? disabledDescription : undefined}
            aria-busy={youtubeLoading}
            onClick={handlePlayYouTube}
          >
            {youtubeLoading ? (
              <>
                <UiIcon name="spinner" className="stims-shell__button-icon" />
                Loading…
              </>
            ) : youtubeReady ? (
              'Start capture'
            ) : (
              'Load'
            )}
          </button>
        </div>
        <p
          id={youtubeFeedbackId}
          className="stims-shell__youtube-feedback"
          data-state={
            youtubeInputInvalid ? 'invalid' : youtubeReady ? 'ready' : 'idle'
          }
          aria-live="polite"
          aria-atomic="true"
        >
          {youtubeFeedback}
        </p>
        {recentYouTubeVideos.length > 0 ? (
          <div className="stims-shell__youtube-recent">
            <div className="stims-shell__youtube-recent-header">
              <p className="stims-shell__field-label">Recent videos</p>
              <button
                type="button"
                className="stims-shell__clear-filters stims-shell__clear-filters--compact"
                onClick={engine.clearRecentYouTubeVideos}
              >
                Clear history
              </button>
            </div>
            <div className="stims-shell__chip-list">
              {recentYouTubeVideos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  className="stims-shell__chip"
                  onClick={() => onLoadRecentYouTubeVideo(video.id)}
                >
                  <span className="stims-shell__chip-copy">
                    <strong>{video.title}</strong>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          id={youtubeContainerId}
          ref={youtubePreviewRef}
          className="stims-shell__youtube-preview"
          hidden
        >
          <div id="workspace-youtube-player"></div>
        </div>
      </div>
      <div className="stims-shell__source-grid">
        <button
          id="start-audio-btn"
          type="button"
          className="stims-shell__source-card"
          disabled={!engineReady}
          aria-describedby={!engineReady ? disabledDescription : undefined}
          onClick={() => onAudioStart('microphone')}
        >
          <span className="stims-shell__source-card-kicker">Live source</span>
          <strong>Microphone</strong>
          <span>Live mic input</span>
        </button>
        {canCaptureTabAudio ? (
          <button
            type="button"
            id="use-tab-audio"
            className="stims-shell__source-card"
            disabled={!engineReady}
            aria-describedby={!engineReady ? disabledDescription : undefined}
            onClick={() => onAudioStart('tab')}
          >
            <span className="stims-shell__source-card-kicker">
              Browser audio
            </span>
            <strong>This tab</strong>
            <span>Audio from this browser tab</span>
          </button>
        ) : null}
      </div>
      {showHelp ? (
        <details className="stims-shell__settings-advanced">
          <summary className="stims-shell__settings-summary">
            <span>Audio help</span>
            <span className="stims-shell__meta-copy">
              Permissions and capture
            </span>
          </summary>
          <div className="stims-shell__settings-advanced-body">
            <p className="stims-shell__meta-copy">
              Allow microphone access in site permissions. For tab audio and
              YouTube, share the browser tab with audio enabled.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
