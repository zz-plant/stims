import type {
  MilkdropColor,
  MilkdropFrameState,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropWaveVisual,
} from '../types';

const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function color(r: number, g: number, b: number, a = 1) {
  return {
    r: clamp(r, 0, 1),
    g: clamp(g, 0, 1),
    b: clamp(b, 0, 1),
    a: clamp(a, 0, 1),
  };
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

let tempPositionsBuffer = new Float32Array(1024 * 3);
function ensureTempPositionsCapacity(size: number) {
  if (tempPositionsBuffer.length < size) {
    tempPositionsBuffer = new Float32Array(size);
  }
}

const tempWaveColor = { r: 1, g: 1, b: 1, a: 1 };
const tempFinalColor = { r: 1, g: 1, b: 1, a: 1 };

function colorTo(
  target: MilkdropColor,
  r: number,
  g: number,
  b: number,
  a = 1,
) {
  target.r = clamp(r, 0, 1);
  target.g = clamp(g, 0, 1);
  target.b = clamp(b, 0, 1);
  target.a = clamp(a, 0, 1);
}

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
  target: { [key: number]: number },
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
  let p1x = p0x,
    p1y = p0y;
  let p2x = source[3],
    p2y = source[4];
  let p3x = source[Math.min(lastIdx, 2) * 3];
  let p3y = source[Math.min(lastIdx, 2) * 3 + 1];

  for (let i = 0; i < lastIdx; i++) {
    if (i > 0) {
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

    // Insert midpoint using ProjectM's fixed weights at t=0.5:
    // [-0.15, 1.15, 1.15, -0.15] / 2.0
    target[writeIdx++] =
      (-0.15 * p0x + 1.15 * p1x + 1.15 * p2x - 0.15 * p3x) * 0.5;
    target[writeIdx++] =
      (-0.15 * p0y + 1.15 * p1y + 1.15 * p2y - 0.15 * p3y) * 0.5;
    target[writeIdx++] = source[i * 3 + 2];
  }

  // Write last point
  const lastOut = lastIdx * 3;
  target[writeIdx++] = source[lastOut];
  target[writeIdx++] = source[lastOut + 1];
  target[writeIdx++] = source[lastOut + 2];
}

function sampleByteData(data: Uint8Array, t: number) {
  if (data.length === 0) {
    return 0;
  }
  const scaledIndex = clamp(t, 0, 1) * Math.max(0, data.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(data.length - 1, lowerIndex + 1);
  const amount = scaledIndex - lowerIndex;
  const lower = ((data[lowerIndex] ?? 128) - 128) / 128;
  const upper = ((data[upperIndex] ?? 128) - 128) / 128;
  return mix(lower, upper, amount);
}

function sampleWaveformData(signals: MilkdropRuntimeSignals, t: number) {
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  return sampleByteData(waveformData, t);
}

function sampleWaveformDataOffset(
  signals: MilkdropRuntimeSignals,
  t: number,
  offset: number,
): number {
  return sampleWaveformData(signals, clamp(t + offset, 0, 1));
}

function sampleFrequencyDataOffset(
  signals: MilkdropRuntimeSignals,
  t: number,
  offset: number,
): number {
  return sampleByteData(signals.frequencyData, clamp(t + offset, 0, 1));
}

function sampleStereoWaveformData(
  signals: MilkdropRuntimeSignals,
  channel: 'left' | 'right',
  t: number,
  offset: number,
): number {
  const left = signals.waveformDataL;
  const right = signals.waveformDataR;
  if (left && left.length > 0 && right && right.length > 0) {
    return sampleByteData(
      channel === 'left' ? left : right,
      clamp(t + offset, 0, 1),
    );
  }

  return sampleWaveformDataOffset(signals, t, offset);
}

function sampleStereoFrequencyData(
  signals: MilkdropRuntimeSignals,
  channel: 'left' | 'right',
  t: number,
  offset: number,
): number {
  const left = signals.frequencyDataL;
  const right = signals.frequencyDataR;
  if (left && left.length > 0 && right && right.length > 0) {
    return sampleByteData(
      channel === 'left' ? left : right,
      clamp(t + offset, 0, 1),
    );
  }

  return sampleFrequencyDataOffset(signals, t, offset);
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
  const baseCountByMode = [176, 168, 160, 152, 192, 176, 192, 160];
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

export function defaultSignalEnv(): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  const waveformData = new Uint8Array(64);
  waveformData.fill(128);
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
    frequencyData,
    waveformData,
    frequencyDataL: null,
    frequencyDataR: null,
    waveformDataL: null,
    waveformDataR: null,
  };
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
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  const samples = getMainWaveSampleCount(
    mode,
    detailScale,
    waveformData.length,
  );
  const centerX = ((state.wave_x ?? 0.5) - 0.5) * 2;
  const centerY = (0.5 - (state.wave_y ?? 0.5)) * 2;
  const scale = clamp((state.wave_scale ?? 1) * 0.45, 0.08, 1.4);
  const smoothing = clamp(state.wave_smoothing ?? 0.72, 0, 0.98);
  const mystery = normalizeProjectMMystery(state.wave_mystery ?? 0);
  const modWaveAlphaStart = clamp(state.modwavealphastart ?? 1, 0, 2);
  const modWaveAlphaEnd = clamp(state.modwavealphaend ?? 1, 0, 2);
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
  if (useProcedural) {
    if (Array.isArray(positions)) {
      positions.length = 0;
    } else if (positions.length !== 0) {
      visual.positions = new Float32Array(0);
    }
  }
  const procedural = useProcedural
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
  if (!useProcedural) {
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
    let x = 0;
    let y = 0;
    switch (mode) {
      case 0: {
        const angle = t * TWO_PI + signals.time * 0.2;
        const radius = 0.5 + 0.4 * sampleValue + mystery;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        break;
      }
      case 1: {
        const sampleR = sampleValue;
        const sampleL = sampleWaveformDataOffset(signals, t, 32 / 512);
        const radius = 0.53 + 0.43 * sampleR + mystery;
        const angle = sampleL * 1.57 + signals.time * 2.3;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        break;
      }
      case 2: {
        // CenteredSpiro: ProjectM plots R->X, L[i+32]->Y (stereo Lissajous).
        const sampleR = sampleStereoWaveformData(signals, 'right', t, 0);
        const sampleL = sampleStereoWaveformData(signals, 'left', t, 32 / 512);
        x = centerX + sampleR * scale;
        y = centerY + sampleL * scale;
        break;
      }
      case 3: {
        // CenteredSpiroVolume: same XY mapping but from spectrum data.
        const sampleR = sampleStereoFrequencyData(signals, 'right', t, 0);
        const sampleL = sampleStereoFrequencyData(signals, 'left', t, 32 / 512);
        x = centerX + sampleR * scale;
        y = centerY + sampleL * scale;
        break;
      }
      case 4: {
        const w1 = 0.45 + 0.5 * (mystery * 0.5 + 0.5);
        const w2 = 1 - w1;
        x = -1 + 2 * t + centerX + sampleValue * 0.44 * scale;
        y =
          centerY +
          sampleWaveformDataOffset(signals, t, 25 / 512) * 0.47 * scale;
        if (index > 1) {
          x = x * w2 + w1 * (prevX * 2 - prevPrevX);
          y = y * w2 + w1 * (prevY * 2 - prevPrevY);
        }
        break;
      }
      case 5: {
        // ExplosiveHash: ProjectM computes complex multiplication of L/R
        // channels and rotates by time.
        const sampleR = sampleStereoWaveformData(signals, 'right', t, 0);
        const sampleL = sampleStereoWaveformData(signals, 'left', t, 32 / 512);
        const sampleR2 = sampleStereoWaveformData(
          signals,
          'right',
          t,
          64 / 512,
        );
        const sampleL2 = sampleStereoWaveformData(signals, 'left', t, 96 / 512);
        const x0 = sampleR * sampleR2 + sampleL * sampleL2;
        const y0 = sampleR * sampleR - sampleL * sampleR2;
        const rot = signals.time * 0.3;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        x = centerX + (x0 * cosR - y0 * sinR) * scale;
        y = centerY + (x0 * sinR + y0 * cosR) * scale;
        break;
      }
      case 6: {
        const clipCount = Math.round((1.57 * mystery * samples) / 2);
        const clipped =
          index < clipCount || index >= samples - clipCount ? 0 : sampleValue;
        x = -1 + 2 * t;
        y = centerY + clipped * 0.25 * scale;
        break;
      }
      case 7: {
        // DoubleLine: ProjectM shows two parallel lines from L and R channels.
        const sampleR = sampleStereoWaveformData(signals, 'right', t, 0);
        const sampleL = sampleStereoWaveformData(signals, 'left', t, 32 / 512);
        const separation = 0.1 + mystery * 0.2;
        if (index % 2 === 0) {
          x = -1 + 2 * t;
          y = centerY + sampleR * scale * 0.5 + separation;
        } else {
          x = -1 + 2 * t;
          y = centerY + sampleL * scale * 0.5 - separation;
        }
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
    if (useProcedural && proceduralSamples && proceduralVelocities) {
      proceduralSamples[index] = sampleValue;
      proceduralVelocities[index] = momentum;
      continue;
    }
    const writeIndex = index * 3;
    tempPositionsBuffer[writeIndex] = x;
    tempPositionsBuffer[writeIndex + 1] = y;
    tempPositionsBuffer[writeIndex + 2] = 0.22 + momentum * 0.06;
  }

  // ProjectM inserts exactly one midpoint per segment using fixed weights
  // [-0.15, 1.15, 1.15, -0.15] / 2.0, doubling the vertex count. The
  // wave_smoothing parameter controls the IIR filter, not subdivision.
  if (!useProcedural) {
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
        positions as { [key: number]: number },
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
    procedural.centerX = centerX;
    procedural.centerY = centerY;
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
