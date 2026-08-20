import type { ClipboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { parseYouTubeVideoReference } from '../ui/youtube-controller.ts';
import {
  isInAppBrowser,
  isMobileDevice,
  openExternalBrowserIntent,
} from '../utils/browser/device-detect.ts';
import {
  AUDIO_FILE_ACCEPT,
  canProbablyPlay,
  createFileAudioStream,
  type FileAudioHandle,
} from './file-audio.ts';
import { ShaderIdenticon } from './ShaderIdenticon.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

type AudioSourcePanelProps = {
  showHelp?: boolean;
};

/**
 * One device enumeration per page, shared by every mount of this panel.
 *
 * This panel renders twice concurrently — once in the home hero, which stays
 * mounted for the whole session, and once in Settings — so a per-instance
 * effect asked the browser for the device list twice on every Settings open.
 * enumerateDevices also prompts a permission-state check in some browsers,
 * making the duplicate more than just wasted work.
 */
let audioInputsPromise: Promise<MediaDeviceInfo[]> | null = null;

function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([]);
  audioInputsPromise ??= navigator.mediaDevices
    .enumerateDevices()
    .then((devices) => devices.filter((d) => d.kind === 'audioinput'))
    .catch(() => []);
  return audioInputsPromise;
}

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

  const fileCardId = `${sourcePanelId}-file-card`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileHandleRef = useRef<FileAudioHandle | null>(null);
  const [fileState, setFileState] = useState<{
    name: string;
    error: string | null;
    loading: boolean;
  } | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // One handle at a time: picking a second track must tear the first one's
  // graph down, or both keep playing into the analyser at once.
  const playFile = async (file: File) => {
    if (!canProbablyPlay(file)) {
      setFileState({
        name: file.name,
        error: `This browser can't play ${file.type || 'that file type'}.`,
        loading: false,
      });
      return;
    }
    setFileState({ name: file.name, error: null, loading: true });
    fileHandleRef.current?.dispose();
    fileHandleRef.current = null;
    try {
      const handle = await createFileAudioStream(file);
      fileHandleRef.current = handle;
      // Commit the route *and* pass it as launchState, the same way the
      // Strudel bridge starts a stream source. Calling startAudioSource
      // alone leaves routeState.audioSource null, so the engine snapshot
      // never reports the source and nothing downstream reacts to it.
      const nextRoute = { ...ui.routeState, audioSource: 'file' as const };
      ui.commitRoute(nextRoute);
      await engine.startAudioSource({
        source: 'file',
        stream: handle.stream,
        launchState: nextRoute,
      });
      setFileState({ name: handle.name, error: null, loading: false });
      ui.setStatusMessage(`Playing ${handle.name}`);
    } catch (error) {
      fileHandleRef.current?.dispose();
      fileHandleRef.current = null;
      setFileState({
        name: file.name,
        error: error instanceof Error ? error.message : 'Could not play file.',
        loading: false,
      });
    }
  };

  useEffect(
    () => () => {
      fileHandleRef.current?.dispose();
      fileHandleRef.current = null;
    },
    [],
  );

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const deviceInitRef = useRef(false);
  const mobileDevice = isMobileDevice();

  useEffect(() => {
    if (mobileDevice) return;
    let cancelled = false;
    void listAudioInputs().then((inputs) => {
      if (cancelled) return;
      setAudioDevices(inputs);
      if (!deviceInitRef.current && inputs.length > 0) {
        deviceInitRef.current = true;
        setSelectedDeviceId(inputs[0].deviceId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mobileDevice]);

  const canCaptureDisplayAudio =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !mobileDevice;

  const handlePlayYouTube = () => {
    if (youtubeReady) {
      void onAudioStart('youtube');
    } else {
      // Deliberately NOT chaining capture onto the load: getDisplayMedia
      // needs transient user activation, and by the time an async load
      // finishes the Load click's activation may have expired (silent
      // failure). The button morphs to "Start capture" in place, focus is
      // still on it, so the deterministic path costs one Enter press.
      void engine.loadYouTubePreview(youtubeUrl);
    }
  };

  // A pasted link that parses is a load request — start it without waiting
  // for a Load click. Typed input still goes through the Load button. The
  // default paste action is left alone so the field updates as usual.
  const handleYoutubeUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (youtubeLoading) {
      return;
    }
    const pastedText = event.clipboardData.getData('text');
    if (!pastedText.trim()) {
      return;
    }
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? input.value.length;
    const nextValue =
      input.value.slice(0, selectionStart) +
      pastedText +
      input.value.slice(selectionEnd);
    if (!parseYouTubeVideoReference(nextValue)) {
      return;
    }
    void engine.loadYouTubePreview(nextValue);
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
            onPaste={handleYoutubeUrlPaste}
          />
          <button
            id={`${sourcePanelId}-load-youtube`}
            data-youtube-load-btn="true"
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
          <div data-youtube-player></div>
        </div>
      </div>
      <div className="stims-shell__source-grid">
        <button
          id={`${sourcePanelId}-use-demo-audio-card`}
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
          id={`${sourcePanelId}-start-audio-btn`}
          data-mic-audio-btn="true"
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
        <button
          type="button"
          // No hardcoded id: this panel mounts twice at once (home + Settings),
          // so the sibling cards' fixed ids are already duplicated in the DOM.
          // The data-attribute is the automation hook here, matching
          // data-demo-audio-btn — which exists for exactly this reason.
          id={fileCardId}
          data-file-audio-btn="true"
          className="stims-shell__source-card"
          data-drag-active={dragActive || undefined}
          disabled={!engineReady || fileState?.loading}
          aria-describedby={!engineReady ? disabledDescription : undefined}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void playFile(file);
          }}
        >
          <div className="stims-shell__source-card-header">
            <span className="stims-shell__source-card-kicker">Your music</span>
            <ShaderIdenticon
              seed="audio-file-source"
              size={28}
              mode="3d-polyhedron"
            />
          </div>
          <strong>Audio file</strong>
          <span>
            {fileState?.loading
              ? 'Loading…'
              : fileState?.error
                ? fileState.error
                : fileState
                  ? `Playing ${fileState.name}`
                  : 'Pick a track, or drop one here'}
          </span>
        </button>
        {/* Outside the button: a file input nested in a button swallows the
            click that is meant to open the picker. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          className="stims-shell__sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Clear so re-picking the same file fires change again.
            event.target.value = '';
            if (file) void playFile(file);
          }}
        />
        {canCaptureDisplayAudio ? (
          <button
            type="button"
            id={`${sourcePanelId}-use-tab-audio`}
            data-tab-audio-btn="true"
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
