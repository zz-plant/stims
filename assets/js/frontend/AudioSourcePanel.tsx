import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function AudioSourcePanel() {
  const { ui, engine } = useWorkspace();
  const engineReady = engine.engineReady;
  const onAudioStart = (source: 'demo' | 'microphone' | 'tab' | 'youtube') =>
    engine.handleAudioStart(source);
  const onLoadRecentYouTubeVideo = engine.loadRecentYouTubeVideo;
  const onLoadYouTube = () => engine.loadYouTubePreview();
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

  return (
    <section
      className="stims-shell__source-panel"
      aria-labelledby="stims-source-heading"
    >
      <div className="stims-shell__source-heading">
        <h2 id="stims-source-heading" className="stims-shell__section-label">
          Use my music
        </h2>
      </div>
      <div className="stims-shell__source-grid">
        <button
          id="start-audio-btn"
          type="button"
          className="stims-shell__source-card"
          disabled={!engineReady}
          onClick={() => onAudioStart('microphone')}
        >
          <strong>Microphone</strong>
          <span>Live mic input</span>
        </button>
        <button
          type="button"
          id="use-tab-audio"
          className="stims-shell__source-card"
          disabled={!engineReady}
          onClick={() => onAudioStart('tab')}
        >
          <strong>This tab</strong>
          <span>Audio from this browser tab</span>
        </button>
      </div>
      <div className="stims-shell__youtube">
        <label className="stims-shell__field-label" htmlFor="youtube-url">
          YouTube link
        </label>
        <div className="stims-shell__youtube-row">
          <input
            id="youtube-url"
            className="stims-shell__input"
            type="url"
            placeholder="https://youtube.com/watch?v=..."
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
            aria-describedby="youtube-url-feedback"
            aria-invalid={youtubeInputInvalid}
            value={youtubeUrl}
            onChange={(event) => onYoutubeUrlChange(event.target.value)}
            onKeyDown={onYoutubeUrlKeyDown}
          />
          <button
            id="load-youtube"
            className="cta-button"
            type="button"
            disabled={!engineReady || !youtubeCanLoad}
            aria-disabled={!engineReady || !youtubeCanLoad}
            aria-busy={youtubeLoading}
            onClick={onLoadYouTube}
          >
            {youtubeLoading ? (
              <>
                <UiIcon name="spinner" className="stims-shell__button-icon" />
                Loading…
              </>
            ) : (
              'Load'
            )}
          </button>
          <button
            id="use-youtube-audio"
            className="cta-button"
            type="button"
            disabled={!engineReady || !youtubeReady}
            onClick={() => onAudioStart('youtube')}
          >
            Start capture
          </button>
        </div>
        <p
          id="youtube-url-feedback"
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
            <p className="stims-shell__field-label">Recent videos</p>
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
                    <span>{video.id}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          id="youtube-player-container"
          ref={youtubePreviewRef}
          className="stims-shell__youtube-preview"
          hidden
        >
          <div id="workspace-youtube-player"></div>
        </div>
      </div>
    </section>
  );
}
