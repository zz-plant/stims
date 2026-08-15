import { useEffect, useId, useRef, useState } from 'react';
import {
  isInAppBrowser,
  isMobileDevice,
  openExternalBrowserIntent,
} from '../utils/browser/device-detect.ts';
import { ShaderIdenticon } from './ShaderIdenticon.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

type AudioSourcePanelProps = {
  showHelp?: boolean;
};

/** m:ss, or h:mm:ss once a video runs past an hour. */
function formatPlaybackTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

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
  const onAudioStart = (
    source: 'demo' | 'microphone' | 'tab' | 'youtube',
    deviceId?: string,
  ) => engine.handleAudioStart(source, deviceId);
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
  const youtubeTransport = ui.youtubeTransport;
  const youtubeTransportControls = ui.youtubeTransportControls;
  const youtubeUrl = ui.youtubeUrl;

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const deviceInitRef = useRef(false);
  const mobileDevice = isMobileDevice();

  useEffect(() => {
    if (mobileDevice) return;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(inputs);
      if (!deviceInitRef.current && inputs.length > 0) {
        deviceInitRef.current = true;
        setSelectedDeviceId(inputs[0].deviceId);
      }
    });
  }, [mobileDevice]);

  const canCaptureDisplayAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !mobileDevice;

  const handlePlayYouTube = () => {
    if (youtubeReady) {
      void onAudioStart('youtube');
    } else {
      void engine.loadYouTubePreview(youtubeUrl, () => onAudioStart('youtube'));
    }
  };

  const isAppBrowser = isInAppBrowser();

  return (
    <section
      className="stims-shell__source-panel"
      aria-labelledby={sourceHeadingId}
      aria-busy={!engineReady}
    >
      <div className="stims-shell__source-heading">
        <h2 id={sourceHeadingId} className="stims-shell__section-label">
          {canCaptureDisplayAudio ? 'YouTube playback' : 'Audio source'}
        </h2>
      </div>
      {isAppBrowser ? (
        <div className="stims-shell__sheet-callout stims-shell__sheet-callout--webview">
          <p className="stims-shell__meta-copy">
            In-app browsers (Instagram, TikTok, Twitter) limit live microphone
            access.
          </p>
          <button
            type="button"
            className="cta-button primary"
            onClick={() => openExternalBrowserIntent()}
          >
            Open in Safari / Chrome
          </button>
        </div>
      ) : null}
      {!engineReady ? (
        <p
          id={engineStatusId}
          className="stims-shell__meta-copy"
          aria-live="polite"
        >
          Audio engine is starting. Sources will unlock in a moment.
        </p>
      ) : null}
      <div
        className="stims-shell__youtube stims-shell__youtube-primary"
        hidden={!canCaptureDisplayAudio}
      >
        <label className="stims-shell__field-label" htmlFor={youtubeInputId}>
          YouTube link
        </label>
        <div className="stims-shell__youtube-row">
          <input
            id={youtubeInputId}
            className="stims-shell__input"
            type="url"
            placeholder="Paste a YouTube link…"
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
        {youtubeTransport ? (
          <fieldset
            className="stims-shell__youtube-transport"
            aria-label="YouTube playback"
          >
            <button
              type="button"
              className="stims-shell__transport-button"
              onClick={() => youtubeTransportControls.nudge(-10)}
              aria-label="Back 10 seconds"
            >
              −10s
            </button>
            <button
              type="button"
              className="stims-shell__transport-button"
              onClick={() =>
                youtubeTransport.paused
                  ? youtubeTransportControls.play()
                  : youtubeTransportControls.pause()
              }
            >
              {youtubeTransport.paused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              className="stims-shell__transport-button"
              onClick={() => youtubeTransportControls.nudge(10)}
              aria-label="Forward 10 seconds"
            >
              +10s
            </button>
            <input
              className="stims-shell__transport-scrubber"
              type="range"
              min={0}
              max={Math.floor(youtubeTransport.durationSeconds)}
              value={Math.floor(youtubeTransport.currentSeconds)}
              aria-label="Seek"
              aria-valuetext={formatPlaybackTime(
                youtubeTransport.currentSeconds,
              )}
              onChange={(event) =>
                youtubeTransportControls.seekTo(Number(event.target.value))
              }
            />
            <span className="stims-shell__transport-time">
              {formatPlaybackTime(youtubeTransport.currentSeconds)} /{' '}
              {formatPlaybackTime(youtubeTransport.durationSeconds)}
            </span>
          </fieldset>
        ) : null}
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
                  className="stims-shell__chip stims-shell__chip--media"
                  onClick={() => onLoadRecentYouTubeVideo(video.id)}
                >
                  {video.thumbnail ? (
                    <img
                      className="stims-shell__chip-thumb"
                      src={video.thumbnail}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                  <span className="stims-shell__chip-copy">
                    <strong>{video.title}</strong>
                    {video.author ? <span>{video.author}</span> : null}
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
      {!canCaptureDisplayAudio ? (
        <div className="stims-shell__sheet-callout">
          <p className="stims-shell__meta-copy">
            <strong>Playing a video on this device?</strong> Mobile browsers
            don&apos;t expose tab audio, so start it in the YouTube app or
            another tab, then pick Microphone below — Stims reacts to what your
            phone hears.
          </p>
          <p className="stims-shell__meta-copy">
            Turn the volume up and keep the mic clear of your hand for the
            cleanest beat detection.
          </p>
        </div>
      ) : null}
      <div className="stims-shell__source-grid">
        <button
          id="use-demo-audio"
          data-demo-audio-btn="true"
          type="button"
          className="stims-shell__source-card"
          disabled={!engineReady}
          aria-describedby={!engineReady ? disabledDescription : undefined}
          onClick={() => onAudioStart('demo')}
        >
          <div className="stims-shell__source-card-header">
            <span className="stims-shell__source-card-kicker">No setup</span>
            <ShaderIdenticon
              seed="audio-demo-source"
              size={28}
              mode="3d-polyhedron"
            />
          </div>
          <strong>Demo audio</strong>
          <span>Start with demo audio — no permission needed</span>
        </button>
        <button
          id="start-audio-btn"
          type="button"
          className="stims-shell__source-card"
          disabled={!engineReady}
          aria-describedby={!engineReady ? disabledDescription : undefined}
          onClick={() =>
            onAudioStart(
              'microphone',
              mobileDevice ? undefined : selectedDeviceId || undefined,
            )
          }
        >
          <div className="stims-shell__source-card-header">
            <span className="stims-shell__source-card-kicker">Live source</span>
            <ShaderIdenticon
              seed="audio-mic-source"
              size={28}
              mode="3d-polyhedron"
            />
          </div>
          <strong>Microphone</strong>
          <span>Live mic input</span>
        </button>
        {audioDevices.length > 1 ? (
          <label className="stims-shell__device-select">
            <span className="stims-shell__field-label">Microphone</span>
            <select
              className="stims-shell__input"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canCaptureDisplayAudio ? (
          <button
            type="button"
            id="use-tab-audio"
            className="stims-shell__source-card"
            disabled={!engineReady}
            aria-describedby={!engineReady ? disabledDescription : undefined}
            onClick={() => onAudioStart('tab')}
          >
            <div className="stims-shell__source-card-header">
              <span className="stims-shell__source-card-kicker">
                Browser audio
              </span>
              <ShaderIdenticon
                seed="audio-tab-source"
                size={28}
                mode="3d-polyhedron"
              />
            </div>
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
              Permissions & troubleshooting
            </span>
          </summary>
          <div className="stims-shell__settings-advanced-body">
            <p className="stims-shell__meta-copy">
              <strong>Permissions:</strong> Allow microphone access in site
              permissions. If blocked, check macOS Privacy & Security or Windows
              Privacy Settings.
            </p>
            <p className="stims-shell__meta-copy">
              <strong>Smartphones & In-App Browsers:</strong> In-app browsers
              (Instagram, TikTok, Twitter) may block mic capture. Tap
              &quot;...&quot; and select &quot;Open in Safari / Chrome&quot;.
            </p>
            <p className="stims-shell__meta-copy">
              <strong>Local Testing & Bluetooth:</strong> Mic capture requires
              HTTPS or localhost. If using Bluetooth earbuds, OS settings may
              switch sound to call mode; use built-in or wired mics for best
              music quality.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
