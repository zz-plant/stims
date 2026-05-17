import type { AudioFrame } from './audio';
import type { Canvas } from './renderer';
import { hslToRgb } from './renderer';
import type { Theme } from './themes';
import { applyTheme } from './themes';

export interface EffectOptions {
  compact: boolean;
  minimal: boolean;
  autocycleSecs: number;
  theme: Theme | null;
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
  normalizeGain: number;
  vibeIntensity: number;
  transitionAlpha: number;
  previousMode: number;
  transitionSnapshot: { bg: Uint8Array; bgColor: Uint32Array } | null;
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
    options: {
      compact: false,
      minimal: false,
      autocycleSecs: 0,
      theme: null,
      ...opts,
    },
    normalizeGain: 1,
    vibeIntensity: 0.5,
    transitionAlpha: 0,
    previousMode: 0,
    transitionSnapshot: null,
  };
}

const MODES = ['waveform', 'spectrum', 'orbit', 'bars', 'combo'] as const;
const COMPACT_MODES = ['orbit', 'bars'] as const;

export function nextMode(state: EffectState): string {
  const modes = state.options.compact ? COMPACT_MODES : MODES;
  state.previousMode = state.modeIndex;
  state.modeIndex = (state.modeIndex + 1) % modes.length;
  state.transitionAlpha = 0;
  return modes[state.modeIndex]!;
}

export function getMode(state: EffectState): string {
  const modes = state.options.compact ? COMPACT_MODES : MODES;
  return modes[state.modeIndex % modes.length]!;
}

function color(
  theme: Theme | null,
  hue: number,
  value: number,
  boost = 0,
): { r: number; g: number; b: number } {
  const v = Math.min(1, value * (1 + boost * 0.3));
  if (theme) {
    const { h, s, l } = applyTheme(theme, hue, v);
    return hslToRgb(h, s, l);
  }
  const sat = 0.7 + (1 - v) * 0.3;
  const light = 0.4 + v * 0.3;
  return hslToRgb(hue, sat, light);
}

function beatColor(theme: Theme | null): { r: number; g: number; b: number } {
  if (theme) {
    const { h, l } = applyTheme(theme, 0, 0.8);
    return hslToRgb(h, 0.3, l * 0.3);
  }
  return hslToRgb(300, 0.8, 0.3);
}

function drawBeatFlash(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  if (state.options.minimal) return;
  if (frame.beat.isBeat) state.flashAlpha = 1;
  state.flashAlpha *= 0.85;
  if (state.flashAlpha < 0.01) return;

  const c = beatColor(state.options.theme);
  const step = state.options.compact ? 8 : 6;
  const alpha = state.flashAlpha * 0.2;
  for (let y = 0; y < canvas.frame.height; y += step) {
    for (let x = 0; x < canvas.frame.width; x += step) {
      canvas.setPixel(x, y, c.r, c.g, c.b, alpha);
    }
  }
}

function drawWaveform(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const wf = frame.waveform;
  const centerY = height / 2;
  const theme = state.options.theme;

  for (let x = 0; x < width; x++) {
    const idx = Math.floor((x / width) * wf.length);
    const sample = wf[Math.min(idx, wf.length - 1)] ?? 0;
    const y = Math.round(centerY + sample * height * 0.42);
    const val = 0.5 + Math.abs(sample) * 0.5;
    const c = color(theme, (200 + (x / width) * 60) % 360, val);
    canvas.setPixel(x, y, c.r, c.g, c.b);
  }
}

function drawSpectrum(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const spec = frame.spectrum;
  const theme = state.options.theme;
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
    const c = color(theme, hue, Math.min(1, maxBin * 1.5));
    const bx = i * barWidth;
    for (let y = height - 1; y >= height - barH; y--) {
      for (let dx = 0; dx < barWidth - 1; dx++) {
        canvas.setPixel(bx + dx, y, c.r, c.g, c.b);
      }
    }
  }
}

function drawOrbit(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const cx = width / 2;
  const cy = height / 2;
  const angle = (Date.now() * 0.001) % (Math.PI * 2);
  const minDim = Math.min(width, height);
  const theme = state.options.theme;

  function ring(radius: number, hue: number, alpha: number, speed: number) {
    const steps = Math.max(16, Math.round(radius * 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + angle * speed;
      const c = color(theme, (hue + i * 3) % 360, 0.6);
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

function drawBars(canvas: Canvas, state: EffectState, frame: AudioFrame) {
  const { width, height } = canvas.frame;
  const bands = [
    frame.smoothedBands.bass,
    frame.smoothedBands.mid,
    frame.smoothedBands.treble,
  ];
  const colors = [0, 200, 60];
  const theme = state.options.theme;
  const barArea = Math.floor(width * 0.7);
  const startX = Math.floor((width - barArea) / 2);
  const barW = Math.floor(barArea / 3) - 2;

  for (let i = 0; i < 3; i++) {
    const barH = Math.round(Math.max(1, (bands[i] ?? 0) * height * 0.9));
    const bx = startX + i * (barW + 2);
    const val = (bands[i] ?? 0) * 0.8 + 0.2;
    const c = color(theme, colors[i]!, val);
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
  const theme = state.options.theme;
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
    const c = color(theme, p.hue, 0.4 + p.life * 0.4);
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
  if (state.previousMode !== state.modeIndex) {
    state.transitionSnapshot = canvas.snapshot();
    state.transitionAlpha = 1;
    state.previousMode = state.modeIndex;
  }

  canvas.fill(6, 8, 14);
  drawParticles(canvas, state, frame);
  drawBeatFlash(canvas, state, frame);

  if (state.options.autocycleSecs > 0) {
    state.modeTimer += 1 / 30;
    const secsPerMode = state.options.autocycleSecs;
    if (state.modeTimer >= secsPerMode) {
      state.modeTimer = 0;
      state.transitionSnapshot = canvas.snapshot();
      canvas.fill(6, 8, 14);
      state.previousMode = state.modeIndex;
      state.transitionAlpha = 1;
      const modes = state.options.compact ? COMPACT_MODES : MODES;
      state.modeIndex = (state.modeIndex + 1) % modes.length;
    }
  }

  if (state.transitionAlpha > 0) {
    state.transitionAlpha -= 1 / 15;
    drawMode(canvas, state, frame, getMode(state));
    if (state.transitionSnapshot) {
      canvas.blend(
        state.transitionSnapshot,
        Math.max(0, state.transitionAlpha),
      );
    }
    if (state.transitionAlpha <= 0) {
      state.transitionSnapshot = null;
    }
  } else {
    drawMode(canvas, state, frame, getMode(state));
  }

  const hueRate = 1.5 + frame.beat.beatIntensity * 4;
  state.hueShift = (state.hueShift + hueRate) % 360;

  const extra =
    state.options.autocycleSecs > 0
      ? `⏱${state.options.autocycleSecs - Math.floor(state.modeTimer)}`
      : undefined;
  drawInfo(canvas, frame, getMode(state), extra);
}

function drawMode(
  canvas: Canvas,
  state: EffectState,
  frame: AudioFrame,
  mode: string,
) {
  switch (mode) {
    case 'waveform':
      drawWaveform(canvas, state, frame);
      break;
    case 'spectrum':
      drawSpectrum(canvas, state, frame);
      break;
    case 'orbit':
      drawOrbit(canvas, state, frame);
      break;
    case 'bars':
      drawBars(canvas, state, frame);
      break;
    case 'combo':
      drawWaveform(canvas, state, frame);
      drawSpectrum(canvas, state, frame);
      break;
  }
}
