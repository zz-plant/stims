import {
  type CanvasVideoExporter,
  type CanvasVideoExporterSupport,
  EXPORT_PRESETS,
  type ExportPresetTarget,
} from 'canvas-video-exporter';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from '../../css/CapturePanel.module.css';
import {
  getActiveAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { createStageVideoExporter } from './engine/stage-video-exporter.ts';
import { RepositorySupport } from './RepositorySupport.tsx';
import { useWorkspace } from './workspace-context.tsx';

const CAPTURE_FORMATS = [
  'hd-landscape',
  '4k-landscape',
  'square-post',
  'spotify-canvas',
  'tiktok-shorts',
  'youtube-shorts',
] as const;

const CAPTURE_FORMAT_STORAGE_KEY = 'stims:capture-format';

function initialCaptureFormat(): (typeof CAPTURE_FORMATS)[number] {
  try {
    const stored = localStorage.getItem(CAPTURE_FORMAT_STORAGE_KEY);
    const match = CAPTURE_FORMATS.find((format) => format === stored);
    return match ?? 'hd-landscape';
  } catch {
    return 'hd-landscape';
  }
}

function getFilename(preset: ExportPresetTarget, mimeType: string) {
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return `stims-${preset}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export function CapturePanel() {
  const { engine, ui } = useWorkspace();
  const exporterRef = useRef<CanvasVideoExporter | null>(null);
  const [preset, setPreset] =
    useState<(typeof CAPTURE_FORMATS)[number]>(initialCaptureFormat);
  const [support, setSupport] = useState<CanvasVideoExporterSupport | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState(
    'Choose a format, then start recording.',
  );
  const reduceFlashing = useSyncExternalStore(
    subscribeToAccessibilityPreference,
    () => getActiveAccessibilityPreference().reduceFlashing,
    () => false,
  );

  useEffect(() => {
    const canvas = ui.stageRef.current?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      setSupport({
        supported: false,
        mimeType: null,
        reason: 'Start a visualizer before recording.',
      });
      return;
    }
    if (exporterRef.current?.getRecordingStatus()) {
      // A recording is in progress; avoid tearing it down just because an
      // unrelated workspace context value changed identity.
      return;
    }
    const exporter = createStageVideoExporter({
      canvas,
      runtime: engine.getVideoExportRuntime(),
      getStage: () => ui.stageRef.current,
    });
    exporterRef.current = exporter;
    setSupport(exporter.getSupport());
    return () => {
      // React runs this before the next pass of the effect, so the guard
      // above only works if a recording survives it. Stopping here ended
      // the recording whenever the engine value changed identity (on WebGPU,
      // about one recording in three, under half a second in), and Stop then
      // found a fresh exporter with nothing to save. The unmount effect
      // below ends a recording the panel is leaving.
      if (exporter.getRecordingStatus()) return;
      exporterRef.current = null;
    };
  }, [engine, ui.stageRef]);

  // Closing the panel mid-recording (the menu's Record item again, Escape,
  // another panel) used to stop the recorder and drop what it held: only the
  // Stop button downloaded. A recording is never thrown away, so leaving
  // saves it the way Stop does.
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const announceRef = useRef(ui.setStatusMessage);
  announceRef.current = ui.setStatusMessage;
  useEffect(
    () => () => {
      const exporter = exporterRef.current;
      if (!exporter?.getRecordingStatus()) return;
      const format = presetRef.current;
      const announce = announceRef.current;
      void exporter
        .stopRecording()
        .then((blob) => {
          if (!blob) return;
          exporter.downloadVideo(blob, getFilename(format, blob.type));
          noteGrowthEvent('video-saved');
          announce('Recording stopped and saved to your downloads.');
        })
        .catch(() => {
          announce('Recording stopped but could not be saved.');
        });
    },
    [],
  );

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    };
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const startRecording = useCallback(() => {
    const result = exporterRef.current?.startRecording({
      preset,
      fps: 60,
    });
    if (!result) {
      setStatus('Start a visualizer before recording.');
      return;
    }
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }
    setElapsedSeconds(0);
    setSaved(false);
    setRecording(true);
    setStatus(
      `Recording ${EXPORT_PRESETS[preset].label}${engine.audioActive ? ' with audio' : ' without audio'}. The visualizer remains live.`,
    );
  }, [engine.audioActive, preset]);

  // Repeat use is instant: the ☰ "Record video" item sets this flag when a
  // remembered format exists, so opening the panel starts recording with it
  // immediately. First-ever use (no stored format, no flag) shows the form.
  const autoStartConsumedRef = useRef(false);
  useEffect(() => {
    if (autoStartConsumedRef.current) return;
    // Wait for the exporter's support probe: consuming the flag before it
    // resolves would drop the auto-start on the floor.
    if (!support?.supported || recording) return;
    let flagged = false;
    try {
      flagged = sessionStorage.getItem('stims:capture-autostart') === '1';
    } catch {
      // Storage can be blocked (private mode); the flag stays unset and the
      // panel shows the form, which is the pre-flag behavior.
    }
    if (!flagged) return;
    autoStartConsumedRef.current = true;
    try {
      sessionStorage.removeItem('stims:capture-autostart');
    } catch {
      // Best-effort cleanup; the in-memory guard above already consumed it.
    }
    startRecording();
  }, [support, recording, startRecording]);

  const stopRecording = useCallback(async () => {
    const exporter = exporterRef.current;
    if (!exporter) return;
    setStatus('Finishing video…');
    try {
      const blob = await exporter.stopRecording();
      if (blob) {
        exporter.downloadVideo(blob, getFilename(preset, blob.type));
        setStatus('Video saved to your downloads.');
        setSaved(true);
        noteGrowthEvent('video-saved');
      } else {
        setStatus('No video frames were captured. Try recording again.');
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Recording could not be saved: ${error.message}`
          : 'Recording could not be saved. Try again.',
      );
    }
    // Always clear the recording flag so a failure can't wedge the Stop
    // button into a permanently "Finishing video…" state. Runs after the
    // catch rather than in a `finally` clause — React Compiler cannot lower
    // try/finally yet, and one unparsable function skips the whole file.
    setRecording(false);
  }, [preset]);

  return (
    <section className={styles.panel} aria-labelledby="capture-heading">
      <div>
        <h3 id="capture-heading" className={styles.heading}>
          Record this visualizer
        </h3>
        <p className={styles.intro}>
          Capture the live canvas and active audio without pausing playback. 4K,
          9:16 vertical, and 1:1 square render natively.
        </p>
      </div>

      <fieldset className={styles.formats} disabled={recording}>
        <legend>Video format</legend>
        {CAPTURE_FORMATS.map((format) => {
          const details = EXPORT_PRESETS[format];
          return (
            <label className={styles.format} key={format}>
              <input
                type="radio"
                name="capture-format"
                value={format}
                checked={preset === format}
                onChange={() => {
                  setPreset(format);
                  try {
                    localStorage.setItem(CAPTURE_FORMAT_STORAGE_KEY, format);
                  } catch {
                    // A blocked localStorage keeps the choice for this visit
                    // only; remembering it is a nicety, not a requirement.
                  }
                }}
              />
              <span>
                <strong>{details.label}</strong>
                <small>
                  {details.width} × {details.height} · {details.aspectRatio}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>

      {support && !support.supported ? (
        <p className={styles.unsupported} role="alert">
          {support.reason}
        </p>
      ) : null}

      <p className={styles.status} role="status" aria-live="polite">
        {recording ? `${status} ${elapsedSeconds}s elapsed.` : status}
      </p>

      {!recording ? (
        <p className={engine.audioActive ? styles.status : styles.unsupported}>
          {engine.audioActive
            ? 'Audio source is active — this recording will include sound.'
            : 'No audio source is active — this recording will be silent.'}
        </p>
      ) : null}

      {reduceFlashing ? (
        <p className={styles.status}>
          Reduce flashing is on — strobing passages are dimmed in the recording
          as they are on screen.
        </p>
      ) : null}

      {recording ? (
        <button
          type="button"
          className={styles.stopButton}
          onClick={() => void stopRecording()}
        >
          Stop and save video
        </button>
      ) : (
        <button
          type="button"
          className={styles.startButton}
          disabled={!support?.supported}
          onClick={startRecording}
        >
          Start recording
        </button>
      )}
      {saved ? <RepositorySupport /> : null}
    </section>
  );
}
