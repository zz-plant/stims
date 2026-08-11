import { useEffect, useRef } from 'react';
import styles from '../../css/StrudelLabPanel.module.css';
import type { useOverlayAnchor } from './hooks/use-overlay-anchor.ts';

type ScopeDock = ReturnType<typeof useOverlayAnchor<'top' | 'bottom'>>;

/**
 * Live signal scopes for the Strudel lab: waveform, spectrum, and band-energy
 * history rendered from the same MediaStream the visualizer analyses. The
 * band split mirrors audio-handler's real ranges (bass = first 12% of FFT
 * bins, mid = 12-50%, treble = 50-100%, byte values averaged over 255) so
 * the traces teach the actual analysis, not an approximation.
 */

const HISTORY_LENGTH = 220;
/** Exponential smoothing factor for the "attenuated" band traces. */
const ATT_K = 0.12;
/** Rolling-average window (frames) and threshold for the beat ticks. */
const BEAT_WINDOW = 60;
const BEAT_THRESHOLD = 1.25;

const BAND_COLORS = {
  bass: '#f47a54',
  mid: '#f6efe4',
  treble: '#77c9ff',
} as const;

type BandKey = keyof typeof BAND_COLORS;
const BANDS: BandKey[] = ['bass', 'mid', 'treble'];

interface BandHistory {
  instant: number[];
  attenuated: number[];
  beat: boolean[];
}

function createHistory(): Record<BandKey, BandHistory> {
  return {
    bass: { instant: [], attenuated: [], beat: [] },
    mid: { instant: [], attenuated: [], beat: [] },
    treble: { instant: [], attenuated: [], beat: [] },
  };
}

export function StrudelScopeStrip({
  stream,
  anchor,
  targetProps,
  surfaceProps,
  onToggleAnchor,
}: {
  stream: MediaStream;
  anchor: 'top' | 'bottom';
  targetProps: ScopeDock['targetProps'];
  surfaceProps: ScopeDock['surfaceProps'];
  onToggleAnchor: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);

    const waveform = new Uint8Array(analyser.fftSize);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const history = createHistory();
    const attenuated: Record<BandKey, number> = { bass: 0, mid: 0, treble: 0 };

    const ctx2d = canvas.getContext('2d');
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!ctx2d) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) {
        return;
      }
      if (
        canvas.width !== Math.round(cssWidth * dpr) ||
        canvas.height !== Math.round(cssHeight * dpr)
      ) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, cssWidth, cssHeight);

      analyser.getByteTimeDomainData(waveform as Uint8Array<ArrayBuffer>);
      analyser.getByteFrequencyData(spectrum as Uint8Array<ArrayBuffer>);

      // Same split audio-handler uses on the visualizer side.
      const len = spectrum.length;
      const bassEnd = Math.max(1, Math.floor(len * 0.12));
      const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.5));
      let bassSum = 0;
      let midSum = 0;
      let trebleSum = 0;
      for (let i = 0; i < bassEnd; i += 1) bassSum += spectrum[i] ?? 0;
      for (let i = bassEnd; i < midEnd; i += 1) midSum += spectrum[i] ?? 0;
      for (let i = midEnd; i < len; i += 1) trebleSum += spectrum[i] ?? 0;
      const instant: Record<BandKey, number> = {
        bass: bassSum / bassEnd / 255,
        mid: midSum / Math.max(1, midEnd - bassEnd) / 255,
        treble: trebleSum / Math.max(1, len - midEnd) / 255,
      };

      for (const band of BANDS) {
        attenuated[band] += (instant[band] - attenuated[band]) * ATT_K;
        const entry = history[band];
        entry.instant.push(instant[band]);
        entry.attenuated.push(attenuated[band]);
        const window = entry.instant.slice(-BEAT_WINDOW);
        const average =
          window.reduce((sum, value) => sum + value, 0) /
          Math.max(1, window.length);
        entry.beat.push(
          average > 0.02 && instant[band] > average * BEAT_THRESHOLD,
        );
        if (entry.instant.length > HISTORY_LENGTH) {
          entry.instant.shift();
          entry.attenuated.shift();
          entry.beat.shift();
        }
      }

      const gap = 12;
      const paneWidth = (cssWidth - gap * 2) / 3;
      const paneHeight = cssHeight;

      drawWaveform(ctx2d, waveform, 0, paneWidth, paneHeight);
      drawSpectrum(
        ctx2d,
        spectrum,
        bassEnd,
        midEnd,
        paneWidth + gap,
        paneWidth,
        paneHeight,
      );
      drawBands(ctx2d, history, (paneWidth + gap) * 2, paneWidth, paneHeight);
    };

    draw();

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close();
    };
  }, [stream]);

  return (
    <div className={styles.scopeStrip} {...targetProps} {...surfaceProps}>
      <canvas
        ref={canvasRef}
        className={styles.scopeCanvas}
        role="img"
        aria-label="Audio signal scopes"
      />
      <button
        type="button"
        className={styles.scopeMoveButton}
        onClick={onToggleAnchor}
        aria-label={`Move scopes to ${anchor === 'bottom' ? 'top' : 'bottom'} edge`}
        title="Move to the other edge (or drag the strip)"
      >
        ⇅
      </button>
    </div>
  );
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  color = 'rgba(246, 239, 228, 0.55)',
) {
  ctx.font = '9px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + 2, 2);
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: Uint8Array,
  x: number,
  width: number,
  height: number,
) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(x + 0.5, 0.5, width - 1, height - 1);
  ctx.beginPath();
  ctx.strokeStyle = '#f6efe4';
  ctx.lineWidth = 1;
  for (let i = 0; i < waveform.length; i += 1) {
    const px = x + (i / (waveform.length - 1)) * width;
    const py = height - ((waveform[i] ?? 128) / 255) * height;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  drawLabel(ctx, 'WAVEFORM (time domain)', x);
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  spectrum: Uint8Array,
  bassEnd: number,
  midEnd: number,
  x: number,
  width: number,
  height: number,
) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(x + 0.5, 0.5, width - 1, height - 1);

  const len = spectrum.length;
  for (let i = 0; i < len; i += 1) {
    const value = (spectrum[i] ?? 0) / 255;
    if (value === 0) {
      continue;
    }
    const band: keyof typeof BAND_COLORS =
      i < bassEnd ? 'bass' : i < midEnd ? 'mid' : 'treble';
    ctx.fillStyle = BAND_COLORS[band];
    ctx.globalAlpha = 0.85;
    const barWidth = width / len;
    ctx.fillRect(
      x + i * barWidth,
      height - value * (height - 12),
      Math.max(barWidth, 0.5),
      value * (height - 12),
    );
  }
  ctx.globalAlpha = 1;

  for (const boundary of [bassEnd, midEnd]) {
    const bx = x + (boundary / len) * width;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(bx, 12);
    ctx.lineTo(bx, height);
    ctx.stroke();
  }
  drawLabel(ctx, 'SPECTRUM (FFT) · bass | mid | treble', x);
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  history: Record<BandKey, BandHistory>,
  x: number,
  width: number,
  height: number,
) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.strokeRect(x + 0.5, 0.5, width - 1, height - 1);
  const plotTop = 12;
  const plotHeight = height - plotTop;

  for (const band of BANDS) {
    const entry = history[band];
    const count = entry.instant.length;
    if (count < 2) {
      continue;
    }
    const step = width / (HISTORY_LENGTH - 1);
    const startX = x + width - (count - 1) * step;

    // Smoothed ("_att") trace: thick and translucent.
    ctx.beginPath();
    ctx.strokeStyle = BAND_COLORS[band];
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    entry.attenuated.forEach((value, i) => {
      const px = startX + i * step;
      const py = plotTop + (1 - Math.min(1, value)) * plotHeight;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();

    // Instantaneous trace: thin and bright.
    ctx.beginPath();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    entry.instant.forEach((value, i) => {
      const px = startX + i * step;
      const py = plotTop + (1 - Math.min(1, value)) * plotHeight;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();

    // Beat ticks along the top edge, bass only (the classic kick detector).
    if (band === 'bass') {
      ctx.fillStyle = BAND_COLORS.bass;
      entry.beat.forEach((hit, i) => {
        if (hit) {
          ctx.fillRect(startX + i * step, plotTop, 1.5, 4);
        }
      });
    }
  }
  ctx.globalAlpha = 1;
  drawLabel(
    ctx,
    'BANDS · bright = now, soft = smoothed · ticks = bass beats',
    x,
  );
}
