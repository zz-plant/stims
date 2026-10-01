/**
 * Produces the per-frame state bundle the renderer consumes.
 *
 * After the per-frame program runs, this module assembles the resulting
 * `MilkdropFrameState`: resolved colors, wave visuals, and the default signal
 * environment a preset starts each frame from.
 *
 * `defaultSignalEnv` is effectively the contract for what variables exist
 * before a preset's own equations run. Presets read variables they never set
 * and rely on MilkDrop's starting values, so adding, renaming or re-defaulting
 * anything here can change how existing presets look without touching their
 * source. Treat it as a compatibility surface.
 */
import type {
  MilkdropColor,
  MilkdropFrameState,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropWaveVisual,
} from '../types';

import { clamp, color, colorTo, mix, sceneHalfExtents } from './shared';

const TWO_PI = Math.PI * 2;
/** Depth the main wave draws at (before its per-point momentum nudge). */
const MAIN_WAVE_Z = 0.22;

let tempPositionsBuffer = new Float32Array(1024 * 3);
function ensureTempPositionsCapacity(size: number) {
  if (tempPositionsBuffer.length < size) {
    tempPositionsBuffer = new Float32Array(size);
  }
}

const tempWaveColor = { r: 1, g: 1, b: 1, a: 1 };
const tempFinalColor = { r: 1, g: 1, b: 1, a: 1 };

function brightenWaveColorTo(target: MilkdropColor, source: MilkdropColor) {
  const peak = Math.max(source.r, source.g, source.b);
  if (peak <= 0.0001 || peak >= 1) {
    target.r = source.r;
    target.g = source.g;
    target.b = source.b;
    target.a = source.a;
    return;
  }
  const gain = 1 / peak;
  target.r = clamp(source.r * gain, 0, 1);
  target.g = clamp(source.g * gain, 0, 1);
  target.b = clamp(source.b * gain, 0, 1);
  target.a = source.a;
}

function catmullRomInterpolateTo(
  source: ArrayLike<number>,
  sourceLen: number,
  target: Float32Array | number[],
) {
  const ptCount = sourceLen / 3;
  if (ptCount < 2) {
    for (let i = 0; i < sourceLen; i++) {
      target[i] = source[i];
    }
    return;
  }

  let writeIdx = 0;
  const lastIdx = ptCount - 1;

  // Write first point
  target[writeIdx++] = source[0];
  target[writeIdx++] = source[1];
  target[writeIdx++] = source[2];

  let p0x = source[0],
    p0y = source[1];
  let p1x = source[0],
    p1y = source[1];
  let p2x = source[3],
    p2y = source[4];
  let p3x = source[Math.min(lastIdx, 2) * 3];
  let p3y = source[Math.min(lastIdx, 2) * 3 + 1];

  for (let i = 0; i < lastIdx; i++) {
    // Insert midpoint using ProjectM's fixed weights at t=0.5:
    // [-0.15, 1.15, 1.15, -0.15] / 2.0
    target[writeIdx++] =
      (-0.15 * p0x + 1.15 * p1x + 1.15 * p2x - 0.15 * p3x) * 0.5;
    target[writeIdx++] =
      (-0.15 * p0y + 1.15 * p1y + 1.15 * p2y - 0.15 * p3y) * 0.5;
    target[writeIdx++] = source[i * 3 + 2];

    // Write next original point (skip for last segment — the trailing
    // point is written after the loop).
    if (i < lastIdx - 1) {
      const nextPt = (i + 1) * 3;
      target[writeIdx++] = source[nextPt];
      target[writeIdx++] = source[nextPt + 1];
      target[writeIdx++] = source[nextPt + 2];
    }

    // Advance control points for next segment
    p0x = p1x;
    p0y = p1y;
    p1x = p2x;
    p1y = p2y;
    if (i + 2 <= lastIdx) {
      const nextI = (i + 1) * 3;
      p2x = source[nextI];
      p2y = source[nextI + 1];
      p3x = source[Math.min(lastIdx, i + 2) * 3];
      p3y = source[Math.min(lastIdx, i + 2) * 3 + 1];
    } else {
      p2x = source[lastIdx * 3];
      p2y = source[lastIdx * 3 + 1];
      p3x = p2x;
      p3y = p2y;
    }
  }

  // Write last point
  const lastOut = lastIdx * 3;
  target[writeIdx++] = source[lastOut];
  target[writeIdx++] = source[lastOut + 1];
  target[writeIdx++] = source[lastOut + 2];
}

function sampleByteData(data: Uint8Array, t: number) {
  const len = data.length;
  if (len === 0) {
    return 0;
  }
  const maxIdx = len - 1;
  const normT = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const scaledIndex = normT * maxIdx;
  const lowerIndex = scaledIndex | 0;
  const upperIndex = lowerIndex < maxIdx ? lowerIndex + 1 : maxIdx;
  const amount = scaledIndex - lowerIndex;
  const lower = ((data[lowerIndex] ?? 128) - 128) * 0.0078125;
  const upper = ((data[upperIndex] ?? 128) - 128) * 0.0078125;
  return lower + (upper - lower) * amount;
}

function sampleFloatData(data: Float32Array, t: number) {
  const len = data.length;
  if (len === 0) {
    return 0;
  }
  const maxIdx = len - 1;
  const normT = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const scaledIndex = normT * maxIdx;
  const lowerIndex = scaledIndex | 0;
  const upperIndex = lowerIndex < maxIdx ? lowerIndex + 1 : maxIdx;
  const amount = scaledIndex - lowerIndex;
  const v0 = data[lowerIndex] ?? 0;
  const v1 = data[upperIndex] ?? 0;
  return v0 + (v1 - v0) * amount;
}

function sampleWaveformData(signals: MilkdropRuntimeSignals, t: number) {
  // Float PCM avoids the 1/128 byte staircase, which reads as blocky wave
  // outlines now that waves draw at full fWaveScale amplitude.
  const floatData = signals.waveformFloatData;
  if (floatData && floatData.length > 0) {
    return sampleFloatData(floatData, t);
  }
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  if (!waveformData || waveformData.length === 0) {
    return 0;
  }
  return sampleByteData(waveformData, t);
}

// MilkDrop indexes offset samples modulo the buffer length (e.g. the
// mode-2 spiro reads waveL[(i + 32) % 512]); wrapping keeps the tail of
// the wave live instead of collapsing it onto the final sample.
function wrapUnit(t: number) {
  if (t >= 0 && t < 1) {
    return t;
  }
  const wrapped = t - Math.floor(t);
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function sampleWaveformDataOffset(
  signals: MilkdropRuntimeSignals,
  t: number,
  offset: number,
): number {
  return sampleWaveformData(signals, wrapUnit(t + offset));
}

function sampleStereoWaveformData(
  signals: MilkdropRuntimeSignals,
  channel: 'left' | 'right',
  t: number,
  offset: number,
): number {
  const floatLeft = signals.waveformFloatDataL;
  const floatRight = signals.waveformFloatDataR;
  if (
    floatLeft &&
    floatLeft.length > 0 &&
    floatRight &&
    floatRight.length > 0
  ) {
    return sampleFloatData(
      channel === 'left' ? floatLeft : floatRight,
      wrapUnit(t + offset),
    );
  }
  const left = signals.waveformDataL;
  const right = signals.waveformDataR;
  if (left && left.length > 0 && right && right.length > 0) {
    return sampleByteData(
      channel === 'left' ? left : right,
      wrapUnit(t + offset),
    );
  }

  return sampleWaveformDataOffset(signals, t, offset);
}

function normalizeWaveMode(value: number) {
  const rounded = Math.round(value);
  return ((rounded % 8) + 8) % 8;
}

function normalizeProjectMMystery(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (Math.abs(value) <= 1) {
    return value;
  }
  let v = value * 0.5 + 0.5;
  v -= Math.floor(v);
  return Math.abs(v * 2 - 1);
}

function assignColor(target: MilkdropColor | undefined, source: MilkdropColor) {
  if (!target) {
    return source;
  }

  target.r = source.r;
  target.g = source.g;
  target.b = source.b;
  target.a = source.a;
  return target;
}

function isClosedMainWaveMode(mode: number) {
  return mode === 0 || mode === 1;
}

function getMainWaveSampleCount(
  mode: number,
  detailScale: number,
  sourceLength: number,
) {
  // Modes 2 and 3 share identical geometry in MilkDrop (same 512-sample
  // Lissajous); keep their sample counts equal so mode blending stays 1:1.
  const baseCountByMode = [176, 168, 160, 160, 192, 176, 192, 160];
  const sourceFloor = sourceLength > 0 ? Math.min(sourceLength, 1024) : 64;
  return clamp(
    Math.round(
      mix(baseCountByMode[mode] ?? 168, sourceFloor, 0.45) *
        clamp(detailScale, 0.5, 3.5),
    ),
    48,
    1024,
  );
}

const STATIC_DEFAULT_FREQUENCY_DATA = new Uint8Array(64);
const STATIC_DEFAULT_WAVEFORM_DATA = (() => {
  const buf = new Uint8Array(64);
  buf.fill(128);
  return buf;
})();

export function defaultSignalEnv(): MilkdropRuntimeSignals {
  return {
    time: 0,
    deltaMs: 16.67,
    frame: 0,
    fps: 60,
    aspect: 1,
    bass: 0,
    mid: 0,
    mids: 0,
    treb: 0,
    treble: 0,
    bassAtt: 0,
    midAtt: 0,
    midsAtt: 0,
    trebleAtt: 0,
    bass_att: 0,
    mid_att: 0,
    mids_att: 0,
    treb_att: 0,
    treble_att: 0,
    rms: 0,
    vol: 0,
    music: 0,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    beatBass: 0,
    beatMid: 0,
    beatTreble: 0,
    beat_bass: 0,
    beat_mid: 0,
    beat_treb: 0,
    beat_treble: 0,
    bandFlux: 0,
    transient: 0,
    spectralFlux: 0,
    weightedEnergy: 0,
    inputX: 0,
    inputY: 0,
    input_x: 0,
    input_y: 0,
    inputDx: 0,
    inputDy: 0,
    input_dx: 0,
    input_dy: 0,
    inputSpeed: 0,
    input_speed: 0,
    inputPressed: 0,
    input_pressed: 0,
    inputJustPressed: 0,
    input_just_pressed: 0,
    inputJustReleased: 0,
    input_just_released: 0,
    inputCount: 0,
    input_count: 0,
    gestureScale: 1,
    gesture_scale: 1,
    gestureRotation: 0,
    gesture_rotation: 0,
    gestureTranslateX: 0,
    gestureTranslateY: 0,
    gesture_translate_x: 0,
    gesture_translate_y: 0,
    hoverActive: 0,
    hover_active: 0,
    hoverX: 0,
    hoverY: 0,
    hover_x: 0,
    hover_y: 0,
    wheelDelta: 0,
    wheel_delta: 0,
    wheelAccum: 0,
    wheel_accum: 0,
    dragIntensity: 0,
    drag_intensity: 0,
    dragAngle: 0,
    drag_angle: 0,
    accentPulse: 0,
    accent_pulse: 0,
    actionAccent: 0,
    action_accent: 0,
    actionModeNext: 0,
    action_mode_next: 0,
    actionModePrevious: 0,
    action_mode_previous: 0,
    actionPresetNext: 0,
    action_preset_next: 0,
    actionPresetPrevious: 0,
    action_preset_previous: 0,
    actionQuickLook1: 0,
    action_quick_look_1: 0,
    actionQuickLook2: 0,
    action_quick_look_2: 0,
    actionQuickLook3: 0,
    action_quick_look_3: 0,
    actionRemix: 0,
    action_remix: 0,
    inputSourcePointer: 0,
    input_source_pointer: 0,
    inputSourceKeyboard: 0,
    input_source_keyboard: 0,
    inputSourceGamepad: 0,
    input_source_gamepad: 0,
    inputSourceMouse: 0,
    input_source_mouse: 0,
    inputSourceTouch: 0,
    input_source_touch: 0,
    inputSourcePen: 0,
    input_source_pen: 0,
    motionX: 0,
    motionY: 0,
    motionZ: 0,
    motion_x: 0,
    motion_y: 0,
    motion_z: 0,
    motionEnabled: 0,
    motion_enabled: 0,
    motionStrength: 0,
    motion_strength: 0,
    frequencyData: STATIC_DEFAULT_FREQUENCY_DATA,
    waveformData: STATIC_DEFAULT_WAVEFORM_DATA,
    frequencyDataL: null,
    frequencyDataR: null,
    waveformDataL: null,
    waveformDataR: null,
    waveformFloatData: null,
    waveformFloatDataL: null,
    waveformFloatDataR: null,
  };
}

/** Main-wave modes MilkDrop draws as straight lines across the screen. */
function isMilkdropLineWaveMode(mode: number) {
  return mode === 6 || mode === 7;
}

/**
 * MilkDrop 2's line waves, modes 6 and 7, as projectM and Butterchurn draw
 * them. The line runs through the screen at angle pi/2 * fWaveParam, sits
 * `wave_x` off-centre perpendicular to itself, and is clipped where it leaves
 * the +/-1.1 box; each sample pushes it sideways by a quarter of its value.
 * Mode 7 draws two such lines, the left channel `sep` to one side and the
 * right channel `sep` to the other, with sep = wave_y^2. `wave_y` does not
 * move a mode 6 line at all.
 *
 * Returns one raw xyz polyline per line in scene units: the line is built in
 * MilkDrop's clip space (y up) and scaled by the scene's half-extents.
 */
export function buildMilkdropLineWave({
  mode,
  waveX,
  waveY,
  mystery,
  scale,
  count,
  sampleLeft,
  sampleRight,
  half,
}: {
  mode: 6 | 7;
  waveX: number;
  waveY: number;
  mystery: number;
  scale: number;
  count: number;
  sampleLeft: (t: number) => number;
  sampleRight: (t: number) => number;
  /** The scene's half-extents (sceneHalfExtents in vm/shared.ts). */
  half: { x: number; y: number };
}): Float32Array[] {
  const angle = Math.PI * 0.5 * mystery;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const posX = waveX * 2 - 1;
  const posY = waveY * 2 - 1;
  const offsetX = posX * Math.cos(angle + Math.PI * 0.5);
  const offsetY = posX * Math.sin(angle + Math.PI * 0.5);
  const edgeX = [offsetX - dirX * 3, offsetX + dirX * 3];
  const edgeY = [offsetY - dirY * 3, offsetY + dirY * 3];
  // Pull each end back inside the +/-1.1 box along the line.
  for (let end = 0; end < 2; end += 1) {
    const other = 1 - end;
    for (const [coords, limit] of [
      [edgeX, 1.1],
      [edgeX, -1.1],
      [edgeY, 1.1],
      [edgeY, -1.1],
    ] as const) {
      const outside = limit > 0 ? coords[end] > limit : coords[end] < limit;
      if (!outside) continue;
      const t = (limit - coords[other]) / (coords[end] - coords[other]);
      const dx = edgeX[end] - edgeX[other];
      const dy = edgeY[end] - edgeY[other];
      edgeX[end] = edgeX[other] + dx * t;
      edgeY[end] = edgeY[other] + dy * t;
    }
  }
  const stepX = (edgeX[1] - edgeX[0]) / count;
  const stepY = (edgeY[1] - edgeY[0]) / count;
  const along = Math.atan2(stepY, stepX);
  const perpX = Math.cos(along + Math.PI * 0.5);
  const perpY = Math.sin(along + Math.PI * 0.5);
  const separation = mode === 7 ? (posY * 0.5 + 0.5) ** 2 : 0;

  const line = (sample: (t: number) => number, side: number) => {
    const points = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const push = 0.25 * sample(index / Math.max(1, count - 1)) * scale;
      const offset = push + side * separation;
      points[index * 3] = (edgeX[0] + stepX * index + perpX * offset) * half.x;
      points[index * 3 + 1] =
        (edgeY[0] + stepY * index + perpY * offset) * half.y;
      points[index * 3 + 2] = MAIN_WAVE_Z;
    }
    return points;
  };
  return mode === 7
    ? [line(sampleLeft, 1), line(sampleRight, -1)]
    : [line(sampleLeft, 0)];
}

/**
 * Per-vertex RGBA for a mode 7 wave: the wave colour at `alpha` everywhere
 * except the two bridge vertices in the middle, which are fully transparent.
 */
function lineWaveBridgeColors(
  vertexCount: number,
  waveColor: MilkdropColor,
  alpha: number,
  reuse: number[] | Float32Array | undefined,
): Float32Array {
  const colors =
    reuse instanceof Float32Array && reuse.length === vertexCount * 4
      ? reuse
      : new Float32Array(vertexCount * 4);
  const bridgeStart = (vertexCount - 2) / 2;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const bridge = vertex === bridgeStart || vertex === bridgeStart + 1;
    colors[vertex * 4] = waveColor.r;
    colors[vertex * 4 + 1] = waveColor.g;
    colors[vertex * 4 + 2] = waveColor.b;
    colors[vertex * 4 + 3] = bridge ? 0 : alpha;
  }
  return colors;
}

export function buildMainWaveFrame({
  state,
  signals,
  detailScale,
  previousSamples,
  previousMomentum,
  buffers = {
    liveSamples: new Float32Array(0),
    previousSamples: new Float32Array(0),
    smoothedSamples: new Float32Array(0),
    momentumSamples: new Float32Array(0),
  },
  useProcedural,
  reusableVisual,
  reusableProcedural,
}: {
  state: Record<string, number>;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  previousSamples: Float32Array;
  previousMomentum: Float32Array;
  buffers?: {
    liveSamples: Float32Array;
    previousSamples?: Float32Array;
    smoothedSamples: Float32Array;
    momentumSamples: Float32Array;
  };
  useProcedural: boolean;
  reusableVisual?: MilkdropWaveVisual;
  reusableProcedural?: MilkdropProceduralWaveVisual;
}): {
  visual: MilkdropWaveVisual;
  procedural: MilkdropProceduralWaveVisual | null;
  nextSamples: Float32Array;
  nextMomentum: Float32Array;
} {
  const mode = normalizeWaveMode(state.wave_mode ?? 0);
  // Line waves are built on the CPU (buildMilkdropLineWave): mode 7 is two
  // separate lines, which the single-strip procedural path cannot draw. Mode
  // 4 is a line too, built in clip space here and scaled to scene units.
  const lineMode = isMilkdropLineWaveMode(mode);
  const proceduralGeometry = useProcedural && !lineMode && mode !== 4;
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  const samples = getMainWaveSampleCount(
    mode,
    detailScale,
    waveformData.length,
  );
  // MilkDrop's wave position in clip space, y up (0 = bottom), and the same
  // point in scene units. Round modes (0-3, 5) add unscaled offsets to the
  // scene centre; the line modes are built in clip space and scaled.
  const centerX = ((state.wave_x ?? 0.5) - 0.5) * 2;
  const centerY = ((state.wave_y ?? 0.5) - 0.5) * 2;
  const half = sceneHalfExtents(signals.aspect ?? 1);
  const sceneCenterX = centerX * half.x;
  const sceneCenterY = centerY * half.y;
  // MilkDrop multiplies PCM samples by fWaveScale at full strength before
  // any mode math (processWaveform: pcm * wave_scale / 128). Samples here
  // are already normalized to [-1, 1], so `scale` is the whole factor.
  const scale = clamp(state.wave_scale ?? 1, 0.01, 4);
  const smoothing = clamp(state.wave_smoothing ?? 0.72, 0, 0.98);
  const mystery = normalizeProjectMMystery(state.wave_mystery ?? 0);
  const modWaveAlphaStart = clamp(state.modwavealphastart ?? 0.75, 0, 2);
  const modWaveAlphaEnd = clamp(state.modwavealphaend ?? 0.95, 0, 2);
  const alphaByVolume = (state.bmodwavealphabyvolume ?? 0) >= 0.5;
  // Reuse Float32Arrays when size matches; allocate fresh only when needed
  let liveSamples: Float32Array;
  let smoothedSamples: Float32Array;
  let nextMomentum: Float32Array;
  if (
    buffers.liveSamples.length === samples &&
    buffers.liveSamples !== previousSamples
  ) {
    liveSamples = buffers.liveSamples;
  } else {
    liveSamples = new Float32Array(samples);
    buffers.liveSamples = liveSamples;
  }
  const alternateSamples = buffers.previousSamples;
  if (
    buffers.smoothedSamples.length === samples &&
    buffers.smoothedSamples !== previousSamples
  ) {
    smoothedSamples = buffers.smoothedSamples;
  } else if (
    alternateSamples?.length === samples &&
    alternateSamples !== previousSamples
  ) {
    smoothedSamples = alternateSamples;
  } else {
    smoothedSamples = new Float32Array(samples);
  }
  buffers.previousSamples = previousSamples;
  buffers.smoothedSamples = smoothedSamples;
  if (buffers.momentumSamples.length === samples) {
    nextMomentum = buffers.momentumSamples;
  } else {
    nextMomentum = new Float32Array(samples);
    buffers.momentumSamples = nextMomentum;
  }
  // IIR causal filter along sample axis (matching ProjectM's WaveformMath).
  // Each sample blends with its predecessor, creating a "comet tail" within
  // a single frame rather than frame-to-frame persistence.
  const iirScale = 1.0;
  for (let index = 0; index < samples; index += 1) {
    const t = index / Math.max(1, samples - 1);
    const raw = sampleWaveformData(signals, t);
    liveSamples[index] = raw;
    if (index === 0) {
      smoothedSamples[index] = iirScale * raw;
    } else {
      smoothedSamples[index] =
        iirScale * (1 - smoothing) * raw +
        smoothing * smoothedSamples[index - 1];
    }
  }

  const drawMode = (state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
  const visual = reusableVisual ?? {
    positions: new Float32Array(0),
    color: color(1, 1, 1, 1),
    alpha: 1,
    thickness: 1,
    drawMode,
    additive: false,
    pointSize: 1,
    closed: false,
  };
  let positions = visual.positions;
  if (proceduralGeometry) {
    if (Array.isArray(positions)) {
      positions.length = 0;
    } else if (positions.length !== 0) {
      visual.positions = new Float32Array(0);
    }
  }
  const procedural = proceduralGeometry
    ? (reusableProcedural ?? {
        samples: new Float32Array(0),
        velocities: new Float32Array(0),
        mode,
        centerX,
        centerY,
        scale,
        mystery,
        time: signals.time,
        beatPulse: signals.beatPulse,
        trebleAtt: signals.trebleAtt,
        color: color(1, 1, 1, 1),
        alpha: 1,
        additive: false,
        thickness: 1,
        closed: false,
      })
    : null;
  let proceduralSamples = procedural?.samples ?? null;
  let proceduralVelocities = procedural?.velocities ?? null;
  if (procedural && proceduralSamples) {
    if (
      !(proceduralSamples instanceof Float32Array) ||
      proceduralSamples.length !== samples
    ) {
      proceduralSamples = new Float32Array(samples);
      procedural.samples = proceduralSamples;
    }
  }
  if (procedural && proceduralVelocities) {
    if (
      !(proceduralVelocities instanceof Float32Array) ||
      proceduralVelocities.length !== samples
    ) {
      proceduralVelocities = new Float32Array(samples);
      procedural.velocities = proceduralVelocities;
    }
  }

  let prevX = 0;
  let prevY = 0;
  let prevPrevX = 0;
  let prevPrevY = 0;

  const rawLength = samples * 3;
  if (!proceduralGeometry) {
    ensureTempPositionsCapacity(rawLength);
  }

  for (let index = 0; index < samples; index += 1) {
    const t = index / Math.max(1, samples - 1);
    const sampleValue =
      smoothedSamples[index] ?? sampleWaveformData(signals, t);
    const prevSample = previousSamples[index] ?? sampleValue;
    const prevMomentumVal = previousMomentum[index] ?? 0;
    const prevCurrent = smoothedSamples[Math.max(0, index - 1)] ?? sampleValue;
    const nextCurrent =
      smoothedSamples[Math.min(samples - 1, index + 1)] ?? sampleValue;
    const derivative = (nextCurrent - prevCurrent) * 0.5;
    const velocity = sampleValue - prevSample;
    const momentum = mix(
      prevMomentumVal,
      derivative,
      clamp(0.24 + (1 - smoothing) * 0.58, 0.18, 0.82),
    );
    nextMomentum[index] = momentum;
    if (lineMode) {
      continue;
    }
    let x = 0;
    let y = 0;
    switch (mode) {
      case 0: {
        const angle = t * TWO_PI + signals.time * 0.2;
        const radius = 0.5 + 0.4 * sampleValue * scale + mystery;
        x = sceneCenterX + Math.cos(angle) * radius;
        y = sceneCenterY + Math.sin(angle) * radius;
        break;
      }
      case 1: {
        const sampleR = sampleValue;
        const sampleL = sampleWaveformDataOffset(signals, t, 32 / 512);
        const radius = 0.53 + 0.43 * sampleR * scale + mystery;
        const angle = sampleL * scale * 1.5708 + signals.time * 2.3;
        x = sceneCenterX + Math.cos(angle) * radius;
        y = sceneCenterY + Math.sin(angle) * radius;
        break;
      }
      case 2:
      case 3: {
        // CenteredSpiro / CenteredSpiroVolume: MilkDrop plots R->X,
        // L[(i+32) % len]->Y (stereo Lissajous) at full fWaveScale for
        // both modes; mode 3 differs only in treble-modulated alpha.
        const sampleR = sampleStereoWaveformData(signals, 'right', t, 0);
        const sampleL = sampleStereoWaveformData(signals, 'left', t, 32 / 512);
        x = sceneCenterX + sampleR * scale;
        y = sceneCenterY + sampleL * scale;
        break;
      }
      case 4: {
        // DerivativeLine: MilkDrop reads R[(i+25) % len] for X displacement
        // and unshifted L for Y.
        const w1 = 0.45 + 0.5 * (mystery * 0.5 + 0.5);
        const w2 = 1 - w1;
        x =
          -1 +
          2 * t +
          centerX +
          sampleStereoWaveformData(signals, 'right', t, 25 / 512) *
            0.44 *
            scale;
        y = centerY + sampleValue * 0.47 * scale;
        if (index > 1) {
          x = x * w2 + w1 * (prevX * 2 - prevPrevX);
          y = y * w2 + w1 * (prevY * 2 - prevPrevY);
        }
        break;
      }
      case 5: {
        // ExplosiveHash: complex product of the wave with its offset self,
        // rotated by time. MilkDrop: x0 = R[i]*L[i+32] + L[i]*R[i+32],
        // y0 = R[i]^2 - L[i+32]^2, with fWaveScale on each factor (scale^2).
        const sampleR = sampleStereoWaveformData(signals, 'right', t, 0);
        const sampleL = sampleStereoWaveformData(signals, 'left', t, 0);
        const sampleR2 = sampleStereoWaveformData(
          signals,
          'right',
          t,
          32 / 512,
        );
        const sampleL2 = sampleStereoWaveformData(signals, 'left', t, 32 / 512);
        const scale2 = scale * scale;
        const x0 = (sampleR * sampleL2 + sampleL * sampleR2) * scale2;
        const y0 = (sampleR * sampleR - sampleL2 * sampleL2) * scale2;
        const rot = signals.time * 0.3;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        x = sceneCenterX + (x0 * cosR - y0 * sinR);
        y = sceneCenterY + (x0 * sinR + y0 * cosR);
        break;
      }
      default:
        x = -1.1 + t * 2.2;
        y = centerY + sampleValue * scale * 1.7 + velocity * 0.12;
    }
    prevPrevX = prevX;
    prevPrevY = prevY;
    prevX = x;
    prevY = y;
    if (proceduralGeometry && proceduralSamples && proceduralVelocities) {
      proceduralSamples[index] = sampleValue;
      proceduralVelocities[index] = momentum;
      continue;
    }
    const writeIndex = index * 3;
    // mode 4 is clip space (its smoothing runs there); round modes are scene
    // units already
    tempPositionsBuffer[writeIndex] = mode === 4 ? x * half.x : x;
    tempPositionsBuffer[writeIndex + 1] = mode === 4 ? y * half.y : y;
    tempPositionsBuffer[writeIndex + 2] = 0.22 + momentum * 0.06;
  }

  // ProjectM inserts exactly one midpoint per segment using fixed weights
  // [-0.15, 1.15, 1.15, -0.15] / 2.0, doubling the vertex count. The
  // wave_smoothing parameter controls the IIR filter, not subdivision.
  if (!proceduralGeometry && lineMode) {
    const lines = buildMilkdropLineWave({
      mode: mode as 6 | 7,
      waveX: state.wave_x ?? 0.5,
      waveY: state.wave_y ?? 0.5,
      mystery: state.wave_mystery ?? 0,
      scale,
      count: samples,
      // mode 6 reads the smoothed mono wave, mode 7 one line per channel
      sampleLeft:
        mode === 6
          ? (t) => smoothedSamples[Math.round(t * (samples - 1))] ?? 0
          : (t) => sampleStereoWaveformData(signals, 'left', t, 0),
      sampleRight: (t) => sampleStereoWaveformData(signals, 'right', t, 0),
      half,
    });
    // Each line is smoothed on its own, then the two are joined by a pair of
    // zero-alpha vertices so the hop between them draws nothing.
    const smoothed = lines.map((raw) => {
      const out = new Float32Array(
        samples < 2 ? raw.length : (samples - 1) * 6 + 3,
      );
      catmullRomInterpolateTo(raw, raw.length, out);
      return out;
    });
    const bridge = smoothed.length > 1 ? 6 : 0;
    const total = smoothed.reduce((sum, line) => sum + line.length, 0) + bridge;
    if (!(positions instanceof Float32Array) || positions.length !== total) {
      visual.positions = new Float32Array(total);
      positions = visual.positions;
    }
    const out = positions as Float32Array;
    out.set(smoothed[0], 0);
    if (smoothed.length > 1) {
      const first = smoothed[0];
      const second = smoothed[1];
      out.set(first.subarray(first.length - 3), first.length);
      out.set(second.subarray(0, 3), first.length + 3);
      out.set(second, first.length + 6);
    }
  } else if (!proceduralGeometry) {
    const interpolatedLength = samples < 2 ? rawLength : (samples - 1) * 6 + 3;
    if (Array.isArray(positions)) {
      if (positions.length !== interpolatedLength) {
        positions.length = interpolatedLength;
      }
      catmullRomInterpolateTo(tempPositionsBuffer, rawLength, positions);
    } else {
      if (positions.length !== interpolatedLength) {
        visual.positions = new Float32Array(interpolatedLength);
        positions = visual.positions;
      }
      catmullRomInterpolateTo(
        tempPositionsBuffer,
        rawLength,
        positions as Float32Array,
      );
    }
  }

  colorTo(
    tempWaveColor,
    state.wave_r ?? 1,
    state.wave_g ?? 1,
    state.wave_b ?? 1,
    state.wave_a ?? 0.9,
  );
  if ((state.wave_brighten ?? 0) >= 0.5) {
    brightenWaveColorTo(tempFinalColor, tempWaveColor);
  } else {
    tempFinalColor.r = tempWaveColor.r;
    tempFinalColor.g = tempWaveColor.g;
    tempFinalColor.b = tempWaveColor.b;
    tempFinalColor.a = tempWaveColor.a;
  }

  const additive = (state.wave_additive ?? 0) >= 0.5;
  let alpha = state.wave_a ?? 0.9;
  if (mode === 1) {
    alpha *= 1.25;
  } else if (mode === 3) {
    // MilkDrop scales mode-3 alpha by treb_imm^2, where treb hovers
    // around 1 (instantaneous energy over its running average). Our
    // treble/trebleAtt pair is the closest analog of that ratio.
    const trebleRatio =
      signals.trebleAtt > 0.001
        ? clamp(signals.treble / signals.trebleAtt, 0, 2)
        : 1;
    alpha *= 1.3 * trebleRatio * trebleRatio;
  }
  if (alphaByVolume) {
    if (Math.abs(modWaveAlphaEnd - modWaveAlphaStart) < 0.0001) {
      alpha *= signals.vol >= modWaveAlphaEnd ? 1 : 0;
    } else {
      alpha *= clamp(
        (signals.vol - modWaveAlphaStart) /
          (modWaveAlphaEnd - modWaveAlphaStart),
        0,
        1,
      );
    }
  }
  alpha = clamp(alpha, 0, additive ? 2 : 1);
  const thickness = clamp(state.wave_thick ?? 1, 1, 5);
  const pointSize = clamp((state.wave_thick ?? 1) * 3, 1, 12);
  const closed = drawMode === 'line' && isClosedMainWaveMode(mode);

  if (procedural) {
    procedural.mode = mode;
    procedural.centerX = sceneCenterX;
    procedural.centerY = sceneCenterY;
    procedural.scale = scale;
    procedural.mystery = mystery;
    procedural.time = signals.time;
    procedural.beatPulse = signals.beatPulse;
    procedural.trebleAtt = signals.trebleAtt;
    procedural.color = assignColor(procedural.color, tempFinalColor);
    procedural.alpha = alpha;
    procedural.additive = additive;
    procedural.thickness = thickness;
    procedural.closed = closed;
  }

  visual.color = assignColor(visual.color, tempFinalColor);
  visual.alpha = alpha;
  // Mode 7's bridge between its two lines is the only per-vertex alpha a main
  // wave carries; every other frame clears it, since visuals are reused.
  if (lineMode && mode === 7 && !proceduralGeometry) {
    visual.colors = lineWaveBridgeColors(
      visual.positions.length / 3,
      tempFinalColor,
      alpha,
      visual.colors,
    );
    visual.perPointAlpha = true;
  } else {
    visual.colors = undefined;
    visual.perPointAlpha = false;
  }
  visual.thickness = thickness;
  visual.drawMode = drawMode;
  visual.additive = additive;
  visual.pointSize = pointSize;
  visual.closed = closed;

  return {
    visual,
    procedural,
    nextSamples: smoothedSamples,
    nextMomentum,
  };
}

export function buildMilkdropFrameState(
  frameState: MilkdropFrameState,
): MilkdropFrameState {
  return frameState;
}
