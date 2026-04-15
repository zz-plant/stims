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

function sampleWaveformData(signals: MilkdropRuntimeSignals, t: number) {
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  if (waveformData.length === 0) {
    return 0;
  }
  const scaledIndex = clamp(t, 0, 1) * Math.max(0, waveformData.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(waveformData.length - 1, lowerIndex + 1);
  const amount = scaledIndex - lowerIndex;
  const lower = ((waveformData[lowerIndex] ?? 128) - 128) / 128;
  const upper = ((waveformData[upperIndex] ?? 128) - 128) / 128;
  return mix(lower, upper, amount);
}

function normalizeWaveMode(value: number) {
  const rounded = Math.round(value);
  return ((rounded % 8) + 8) % 8;
}

function normalizeProjectMMystery(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 1) + 1) % 1;
}

function brightenWaveColor(waveColor: {
  r: number;
  g: number;
  b: number;
  a?: number;
}) {
  const peak = Math.max(waveColor.r, waveColor.g, waveColor.b);
  if (peak <= 0.0001 || peak >= 1) {
    return waveColor;
  }
  const gain = 1 / peak;
  return color(
    clamp(waveColor.r * gain, 0, 1),
    clamp(waveColor.g * gain, 0, 1),
    clamp(waveColor.b * gain, 0, 1),
    waveColor.a,
  );
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
  return (
    mode === 0 ||
    mode === 1 ||
    mode === 2 ||
    mode === 3 ||
    mode === 5 ||
    mode === 7
  );
}

function getMainWaveSampleCount(
  mode: number,
  detailScale: number,
  sourceLength: number,
) {
  const baseCountByMode = [176, 168, 160, 152, 192, 176, 192, 160];
  const sourceFloor = sourceLength > 0 ? Math.min(sourceLength, 384) : 64;
  return clamp(
    Math.round(
      mix(baseCountByMode[mode] ?? 168, sourceFloor, 0.45) *
        clamp(detailScale, 0.5, 2),
    ),
    48,
    384,
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
  };
}

export function buildMainWaveFrame({
  state,
  signals,
  detailScale,
  previousSamples,
  previousMomentum,
  buffers = {
    liveSamples: [],
    smoothedSamples: [],
    momentumSamples: [],
  },
  useProcedural,
  reusableVisual,
  reusableProcedural,
}: {
  state: Record<string, number>;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  previousSamples: number[];
  previousMomentum: number[];
  buffers?: {
    liveSamples: number[];
    smoothedSamples: number[];
    momentumSamples: number[];
  };
  useProcedural: boolean;
  reusableVisual?: MilkdropWaveVisual;
  reusableProcedural?: MilkdropProceduralWaveVisual;
}): {
  visual: MilkdropWaveVisual;
  procedural: MilkdropProceduralWaveVisual | null;
  nextSamples: number[];
  nextMomentum: number[];
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
  const scale = clamp(0.12 + (state.wave_scale ?? 1) * 0.2, 0.08, 1.4);
  const smoothing = clamp(state.wave_smoothing ?? 0.72, 0, 0.98);
  const mystery = normalizeProjectMMystery(state.wave_mystery ?? 0);
  const mysteryPhase = mystery * Math.PI;
  const modWaveAlphaStart = clamp(state.modwavealphastart ?? 1, 0, 2);
  const modWaveAlphaEnd = clamp(state.modwavealphaend ?? 1, 0, 2);
  const alphaByVolume = (state.bmodwavealphabyvolume ?? 0) >= 0.5;
  const liveSamples = buffers.liveSamples;
  const smoothedSamples = buffers.smoothedSamples;
  const nextMomentum = buffers.momentumSamples;
  liveSamples.length = samples;
  smoothedSamples.length = samples;
  nextMomentum.length = samples;
  const smoothingBlend = clamp(1 - smoothing, 0.04, 1);
  for (let index = 0; index < samples; index += 1) {
    const t = index / Math.max(1, samples - 1);
    const value = sampleWaveformData(signals, t);
    liveSamples[index] = value;
    smoothedSamples[index] = mix(
      previousSamples[index] ?? value,
      value,
      smoothingBlend,
    );
  }

  const drawMode = (state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
  const visual = reusableVisual ?? {
    positions: [],
    color: color(1, 1, 1, 1),
    alpha: 1,
    thickness: 1,
    drawMode,
    additive: false,
    pointSize: 1,
    closed: false,
  };
  const positions = visual.positions;
  if (useProcedural) {
    positions.length = 0;
  } else {
    positions.length = samples * 3;
  }
  const procedural = useProcedural
    ? (reusableProcedural ?? {
        samples: [],
        velocities: [],
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
      })
    : null;
  const proceduralSamples = procedural?.samples ?? null;
  const proceduralVelocities = procedural?.velocities ?? null;
  if (proceduralSamples) {
    proceduralSamples.length = samples;
  }
  if (proceduralVelocities) {
    proceduralVelocities.length = samples;
  }

  for (let index = 0; index < samples; index += 1) {
    const t = index / Math.max(1, samples - 1);
    const sampleValue =
      smoothedSamples[index] ?? sampleWaveformData(signals, t);
    const prevSample = previousSamples[index] ?? sampleValue;
    const prevMomentum = previousMomentum[index] ?? 0;
    const prevCurrent = smoothedSamples[Math.max(0, index - 1)] ?? sampleValue;
    const nextCurrent =
      smoothedSamples[Math.min(samples - 1, index + 1)] ?? sampleValue;
    const derivative = (nextCurrent - prevCurrent) * 0.5;
    const velocity = sampleValue - prevSample;
    const momentum = mix(
      prevMomentum,
      derivative,
      clamp(0.24 + (1 - smoothing) * 0.58, 0.18, 0.82),
    );
    nextMomentum[index] = momentum;
    let x = 0;
    let y = 0;
    switch (mode) {
      case 0: {
        const angle = t * TWO_PI;
        const radius =
          0.3 +
          Math.abs(sampleValue) * scale * (0.9 + mystery * 0.25) +
          signals.beatPulse * 0.04;
        x =
          centerX +
          Math.cos(angle) * radius +
          Math.sin(angle * 3 + mysteryPhase + signals.time * 0.4) * 0.025;
        y =
          centerY +
          Math.sin(angle) * radius +
          Math.cos(angle * 2 - mysteryPhase + signals.time * 0.3) * 0.025;
        break;
      }
      case 1: {
        const angle = t * TWO_PI + sampleValue * (0.6 + mystery * 0.4);
        const radius =
          0.24 +
          (0.22 + sampleValue * 0.16) * (1 + (signals.trebleAtt ?? 0) * 0.12) +
          Math.sin(signals.time * 0.2 + t * TWO_PI * 2) * 0.02;
        x = centerX + Math.cos(angle) * radius;
        y =
          centerY +
          Math.sin(angle) * radius * (0.6 + mystery * 0.5) +
          derivative * 0.1;
        break;
      }
      case 2: {
        const angle = t * TWO_PI * (1.5 + mystery * 1.5) + signals.time * 0.12;
        const radius =
          0.08 + t * 0.5 + sampleValue * scale * 0.45 + momentum * 0.1;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        break;
      }
      case 3: {
        const angle = t * TWO_PI;
        const lissajousX = Math.sin(angle * 2 + mysteryPhase);
        const lissajousY = Math.sin(angle * 3 + mysteryPhase * 1.7);
        x = centerX + lissajousX * (0.28 + Math.abs(sampleValue) * scale * 0.7);
        y = centerY + lissajousY * (0.2 + Math.abs(sampleValue) * scale * 0.9);
        break;
      }
      case 4: {
        x =
          centerX +
          sampleValue * scale * 1.5 +
          momentum * 0.42 +
          Math.sin(t * TWO_PI * 4 + signals.time * 0.25) * 0.03;
        y = 1.02 - t * 2.04 + derivative * 0.16;
        break;
      }
      case 5: {
        const angle = t * TWO_PI;
        const xAmp = 0.2 + Math.abs(sampleValue) * scale * 0.9;
        const yAmp = 0.14 + Math.abs(sampleValue) * scale * 0.95;
        x =
          centerX +
          Math.sin(angle * (2 + mystery)) * xAmp +
          Math.cos(angle * 4 + mysteryPhase) * 0.05;
        y =
          centerY +
          Math.sin(angle * (3 + mystery * 0.5) + Math.PI / 2) * yAmp +
          sampleValue * scale * 0.2;
        break;
      }
      case 6: {
        const band = sampleValue * scale * 1.3;
        x = -1.05 + t * 2.1;
        y =
          centerY +
          (index % 2 === 0 ? band : -band) +
          momentum * 0.3 +
          Math.sin(t * TWO_PI * 3 + signals.time * 0.2) * 0.02;
        break;
      }
      case 7: {
        const angle = t * TWO_PI;
        const petals = 3 + Math.round(clamp(mystery * 4, 0, 4));
        const radius =
          0.12 +
          (0.18 + Math.abs(sampleValue) * scale * 0.9) *
            Math.cos(petals * angle + mysteryPhase) +
          derivative * 0.08;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
        break;
      }
      default:
        x = -1.1 + t * 2.2;
        y = centerY + sampleValue * scale * 1.7 + velocity * 0.12;
    }
    if (useProcedural && proceduralSamples && proceduralVelocities) {
      proceduralSamples[index] = sampleValue;
      proceduralVelocities[index] = momentum;
      continue;
    }
    const writeIndex = index * 3;
    positions[writeIndex] = x;
    positions[writeIndex + 1] = y;
    positions[writeIndex + 2] = 0.22 + momentum * 0.06;
  }

  const waveColor = color(
    state.wave_r ?? 1,
    state.wave_g ?? 1,
    state.wave_b ?? 1,
    state.wave_a ?? 0.9,
  );
  const finalWaveColor =
    (state.wave_brighten ?? 0) >= 0.5
      ? brightenWaveColor(waveColor)
      : waveColor;
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
    procedural.color = assignColor(procedural.color, finalWaveColor);
    procedural.alpha = alpha;
    procedural.additive = additive;
    procedural.thickness = thickness;
  }

  visual.color = assignColor(visual.color, finalWaveColor);
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
