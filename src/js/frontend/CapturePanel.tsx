import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/CapturePanel.module.css';
import {
  CanvasVideoExporter,
  type CanvasVideoExporterSupport,
  EXPORT_PRESETS,
  type ExportPresetTarget,
} from '../utils/canvas-video-exporter.ts';
import { useWorkspace } from './workspace-context.tsx';

const CAPTURE_FORMATS = ['hd-landscape', 'spotify-canvas'] as const;

function getFilename(preset: ExportPresetTarget, mimeType: string) {
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return `stims-${preset}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export function CapturePanel() {
  const { ui } = useWorkspace();
  const exporterRef = useRef<CanvasVideoExporter | null>(null);
  const [preset, setPreset] =
    useState<(typeof CAPTURE_FORMATS)[number]>('hd-landscape');
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
    const exporter = new CanvasVideoExporter(canvas);
    exporterRef.current = exporter;
    setSupport(exporter.getSupport());
    return () => {
      if (exporter.getRecordingStatus()) {
        void exporter.stopRecording();
      }
      exporterRef.current = null;
    };
  }, [ui.stageRef]);

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
      `Recording ${EXPORT_PRESETS[preset].label}. The visualizer remains live.`,
    );
  }, [preset]);

  const stopRecording = useCallback(async () => {
    const exporter = exporterRef.current;
    if (!exporter) return;
    setStatus('Finishing video…');
    const blob = await exporter.stopRecording();
    setRecording(false);
    if (!blob) {
      setStatus('No video frames were captured. Try recording again.');
      return;
    }
    exporter.downloadVideo(blob, getFilename(preset, blob.type));
    setStatus('Video saved to your downloads.');
  }, [preset]);

  return (
    <section className={styles.panel} aria-labelledby="capture-heading">
      <div>
        <h3 id="capture-heading" className={styles.heading}>
          Record this visualizer
        </h3>
        <p className={styles.intro}>
          Capture the live canvas without pausing playback. Portrait output is
          center-cropped to fill the frame.
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
                onChange={() => setPreset(format)}
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
