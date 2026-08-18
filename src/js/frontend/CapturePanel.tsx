import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/CapturePanel.module.css';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterSupport,
  EXPORT_PRESETS,
  type ExportPresetTarget,
} from '../utils/media/canvas-video-exporter.ts';
import { useWorkspace } from './workspace-context.tsx';

const CAPTURE_FORMATS = [
  'hd-landscape',
  '4k-landscape',
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState(
    'Choose a format, then start recording.',
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
    const exporter = new CanvasVideoExporter(
      canvas,
      undefined,
      engine.getVideoExportRuntime(),
    );
    exporterRef.current = exporter;
    setSupport(exporter.getSupport());
    return () => {
      if (exporter.getRecordingStatus()) {
        void exporter.stopRecording().catch(() => {});
      }
      exporterRef.current = null;
    };
  }, [engine, ui.stageRef]);

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
    setRecording(true);
    setStatus(
      `Recording ${EXPORT_PRESETS[preset].label}${engine.audioActive ? ' with audio' : ' without audio'}. The visualizer remains live.`,
    );
  }, [engine.audioActive, preset]);

  const stopRecording = useCallback(async () => {
    const exporter = exporterRef.current;
    if (!exporter) return;
    setStatus('Finishing video…');
    try {
      const blob = await exporter.stopRecording();
      if (!blob) {
        setStatus('No video frames were captured. Try recording again.');
        return;
      }
      exporter.downloadVideo(blob, getFilename(preset, blob.type));
      setStatus('Video saved to your downloads.');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Recording could not be saved: ${error.message}`
          : 'Recording could not be saved. Try again.',
      );
    } finally {
      // Always clear the recording flag so a failure can't wedge the Stop
      // button into a permanently "Finishing video…" state.
      setRecording(false);
    }
  }, [preset]);

  return (
    <section className={styles.panel} aria-labelledby="capture-heading">
      <div>
        <h3 id="capture-heading" className={styles.heading}>
          Record this visualizer
        </h3>
        <p className={styles.intro}>
          Capture the live canvas and active audio without pausing playback. 4K
          renders natively; portrait output is center-cropped to fill the frame.
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
                  } catch {}
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
    </section>
  );
}
