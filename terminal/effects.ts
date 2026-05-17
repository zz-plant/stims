import type { AudioFrame } from './audio';
import type { Canvas } from './renderer';
import { hslToRgb } from './renderer';

export interface EffectOptions {
  compact: boolean;
  minimal: boolean;
  autocycleSecs: number;
}

export interface EffectState {
  particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    hue: number;
  }>;
  hueShift: number;
  flashAlpha: number;
  modeIndex: number;
  modeTimer: number;
  options: EffectOptions;
}

export function createEffectState(
  opts: Partial<EffectOptions> = {},
): EffectState {
  return {
    particles: [],
    hueShift: 0,
    flashAlpha: 0,
    modeIndex: 0,
    modeTimer: 0,
    options: { compact: false, minimal: false, autocycleSecs: 0, ...opts },
  };
}

const MODES = ['waveform', 'spectrum', 'orbit', 'bars', 'combo'] as const;
const COMPACT_MODES = ['orbit', 'bars'] as const;

export function nextMode(state: EffectState): string {
  const modes = state.options.compact ? COMPACT_MODES : MODES;
  state.modeIndex = (state.modeIndex + 1) % modes.length;
  return modes[state.modeIndex]!;
}

export function getMode(state: EffectState): string {
  const modes = state.options.compact ? COMPACT_MODES : MODES;
  return modes[state.modeIndex % modes.length]!;
}

function drawBeatFlash(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  if (state.options.minimal) return;
  if (frame.beat.isBeat) state.flashAlpha = 1;
  state.flashAlpha *= 0.85;
  if (state.flashAlpha < 0.01) return;

  const h = frame.beat.isBeatBass
    ? 0
    : frame.beat.isBeatMid
      ? 200
      : frame.beat.isBeatTreble
        ? 60
        : 300;
  const c = hslToRgb(h, 0.8, 0.3 * state.flashAlpha);

  const step = state.options.compact ? 8 : 6;
  for (let y = 0; y < canvas.frame.height; y += step) {
    for (let x = 0; x < canvas.frame.width; x += step) {
      canvas.setPixel(x, y, c.r, c.g, c.b, state.flashAlpha * 0.2);
    }
  }
}

function drawWaveform(canvas: Canvas, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const wf = frame.waveform;
  const centerY = height / 2;

  for (let x = 0; x < width; x++) {
    const idx = Math.floor((x / width) * wf.length);
    const sample = wf[Math.min(idx, wf.length - 1)] ?? 0;
    const y = Math.round(centerY + sample * height * 0.42);
    const light = 0.4 + Math.abs(sample) * 0.35;
    const c = hslToRgb(
      (200 + (x / width) * 60) % 360,
      0.7 + frame.beat.beatIntensity * 0.3,
      light,
    );
    canvas.setPixel(x, y, c.r, c.g, c.b);
  }
}

function drawSpectrum(canvas: Canvas, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const spec = frame.spectrum;
  const barCount = Math.min(width, 80);
  const barWidth = Math.max(1, Math.floor(width / barCount));
  const binsPerBar = Math.max(1, Math.floor(spec.length / barCount));

  for (let i = 0; i < barCount; i++) {
    let maxBin = 0;
    for (let j = 0; j < binsPerBar; j++) {
      const v = spec[Math.min(i * binsPerBar + j, spec.length - 1)] ?? 0;
      if (v > maxBin) maxBin = v;
    }
    const barH = Math.round(Math.max(0, Math.min(1, maxBin)) * height * 0.9);
    const hue = ((i / barCount) * 300 + 180) % 360;
    const c = hslToRgb(hue, 0.8, 0.35 + maxBin * 0.3);
    const bx = i * barWidth;
    for (let y = height - 1; y >= height - barH; y--) {
      for (let dx = 0; dx < barWidth - 1; dx++) {
        canvas.setPixel(bx + dx, y, c.r, c.g, c.b);
      }
    }
  }
}

function drawOrbit(canvas: Canvas, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const cx = width / 2,
    cy = height / 2;
  const angle = (Date.now() * 0.001) % (Math.PI * 2);
  const minDim = Math.min(width, height);

  function ring(radius: number, hue: number, alpha: number, speed: number) {
    const steps = Math.max(16, Math.round(radius * 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + angle * speed;
      const c = hslToRgb((hue + i * 3) % 360, 0.9, 0.5);
      canvas.setPixel(
        Math.round(cx + Math.cos(a) * radius),
        Math.round(cy + Math.sin(a) * radius),
        c.r,
        c.g,
        c.b,
        alpha,
      );
    }
  }

  ring(minDim * 0.15 + frame.smoothedBands.bass * minDim * 0.35, 0, 0.9, 1.2);
  ring(minDim * 0.1 + frame.smoothedBands.mid * minDim * 0.25, 200, 0.7, 1.8);
  ring(
    minDim * 0.05 + frame.smoothedBands.treble * minDim * 0.15,
    60,
    0.5,
    2.5,
  );
}

function drawBars(canvas: Canvas, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const bands = [
    frame.smoothedBands.bass,
    frame.smoothedBands.mid,
    frame.smoothedBands.treble,
  ];
  const colors = [0, 200, 60];
  const barArea = Math.floor(width * 0.7);
  const startX = Math.floor((width - barArea) / 2);
  const barW = Math.floor(barArea / 3) - 2;

  for (let i = 0; i < 3; i++) {
    const barH = Math.round(Math.max(1, (bands[i] ?? 0) * height * 0.9));
    const bx = startX + i * (barW + 2);
    const c = hslToRgb(colors[i]!, 1, 0.4 + (bands[i] ?? 0) * 0.35);
    for (let py = 0; py < barH; py++) {
      const y = height - 1 - py;
      for (let dx = 0; dx < barW; dx++) {
        const glow = py < 4 ? 0.5 * (1 - py / 4) : 1;
        canvas.setPixel(bx + dx, y, c.r, c.g, c.b, glow);
      }
    }
  }
}

function drawParticles(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  if (state.options.minimal || state.options.compact) return;
  const energy =
    frame.smoothedBands.bass * 0.6 +
    frame.smoothedBands.mid * 0.3 +
    frame.smoothedBands.treble * 0.1;

  if (state.particles.length < 100) {
    state.particles.push({
      x: Math.random() * canvas.frame.width,
      y: canvas.frame.height + 2,
      vx: (Math.random() - 0.5) * 2,
      vy: -(1 + Math.random() * 3) * (0.5 + energy * 3),
      life: 1,
      hue: state.hueShift + Math.random() * 40,
    });
  }
  if (frame.beat.isBeatBass) {
    for (let i = 0; i < 12; i++) {
      state.particles.push({
        x: canvas.frame.width / 2,
        y: canvas.frame.height,
        vx: (Math.random() - 0.5) * 8,
        vy: -(3 + Math.random() * 6),
        life: 1,
        hue: state.hueShift + Math.random() * 60,
      });
    }
  }

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i]!;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.015;
    if (p.life <= 0 || p.y < -5 || p.x < -5 || p.x > canvas.frame.width + 5) {
      state.particles.splice(i, 1);
      continue;
    }
    const c = hslToRgb(p.hue, 0.8, 0.3 + p.life * 0.4);
    canvas.setPixel(Math.round(p.x), Math.round(p.y), c.r, c.g, c.b, p.life);
  }
}

function drawInfo(
  canvas: Canvas,
  frame: AudioFrame,
  mode: string,
  extra?: string,
) {
  if (canvas.frame.rows < 4) return;
  const b = frame.smoothedBands;
  const lead = `${mode.padEnd(8)} b:${b.bass.toFixed(2)} m:${b.mid.toFixed(2)} t:${b.treble.toFixed(2)} ⬡${frame.beat.beatIntensity.toFixed(2)}`;
  const pad = extra ? `  ${extra}` : '';
  canvas.text(0, 0, lead + pad, 160, 160, 160);

  if (canvas.frame.rows < 6) return;
  const pct = Math.floor(frame.progress * 100);
  const barW = canvas.frame.cols - 12;
  const filled = Math.floor(frame.progress * barW);
  canvas.text(
    canvas.frame.rows - 1,
    0,
    `[${'━'.repeat(Math.max(0, filled))}${'─'.repeat(Math.max(0, barW - filled))}] ${pct}%  ${frame.time.toFixed(0)}s`,
    120,
    120,
    120,
  );
}

export function renderFrame(
  canvas: Canvas,
  state: EffectState,
  frame: AudioFrame,
) {
  canvas.fill(6, 8, 14);
  drawParticles(canvas, state, frame);
  drawBeatFlash(canvas, state, frame);

  if (state.options.autocycleSecs > 0) {
    state.modeTimer += 1 / 30;
    const secsPerMode = state.options.autocycleSecs;
    if (state.modeTimer >= secsPerMode) {
      state.modeTimer = 0;
      const modes = state.options.compact ? COMPACT_MODES : MODES;
      state.modeIndex = (state.modeIndex + 1) % modes.length;
    }
  }

  const mode = getMode(state);
  switch (mode) {
    case 'waveform':
      drawWaveform(canvas, frame);
      break;
    case 'spectrum':
      drawSpectrum(canvas, frame);
      break;
    case 'orbit':
      drawOrbit(canvas, frame);
      break;
    case 'bars':
      drawBars(canvas, frame);
      break;
    case 'combo':
      drawWaveform(canvas, frame);
      drawSpectrum(canvas, frame);
      break;
  }

  const hueRate = 1.5 + frame.beat.beatIntensity * 4;
  state.hueShift = (state.hueShift + hueRate) % 360;

  const extra =
    state.options.autocycleSecs > 0
      ? `⏱${state.options.autocycleSecs - Math.floor(state.modeTimer)}`
      : undefined;
  drawInfo(canvas, frame, mode, extra);
}
