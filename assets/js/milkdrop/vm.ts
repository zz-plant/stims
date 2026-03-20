import {
  DEFAULT_MILKDROP_STATE,
  evaluateMilkdropShaderControlProgram,
} from './compiler';
import { evaluateMilkdropExpression } from './expression';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropGpuGeometryHints,
  MilkdropMeshVisual,
  MilkdropMotionVectorVisual,
  MilkdropPolyline,
  MilkdropPostVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropShapeVisual,
  MilkdropVM,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from './types';

const MAX_TRAILS = 5;
const MAX_CUSTOM_WAVE_SLOTS = 32;
const MAX_CUSTOM_SHAPE_SLOTS = 32;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function color(r: number, g: number, b: number, a = 1): MilkdropColor {
  return {
    r: clamp(r, 0, 1),
    g: clamp(g, 0, 1),
    b: clamp(b, 0, 1),
    a: clamp(a, 0, 1),
  };
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clonePolyline(polyline: MilkdropPolyline): MilkdropPolyline {
  return {
    ...polyline,
    positions: [...polyline.positions],
    color: { ...polyline.color },
  };
}

function defaultSignalEnv(): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
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
  };
}

function normalizeWaveMode(value: number) {
  const rounded = Math.round(value);
  return ((rounded % 8) + 8) % 8;
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

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function sampleFrequencyData(signals: MilkdropRuntimeSignals, t: number) {
  const sampleIndex = Math.min(
    signals.frequencyData.length - 1,
    Math.max(0, Math.round(t * Math.max(0, signals.frequencyData.length - 1))),
  );
  return (signals.frequencyData[sampleIndex] ?? 0) / 255;
}

function normalizeTransformCenter(value: number) {
  if (value >= 0 && value <= 1) {
    return value * 2 - 1;
  }
  return value;
}

type MutableState = Record<string, number>;
type MeshFieldPoint = {
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
};
type MeshField = {
  density: number;
  points: MeshFieldPoint[];
};

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: MutableState = {};
  private registers: MutableState = {};
  private randomState = 1;
  private detailScale = 1;
  private trails: MilkdropPolyline[] = [];
  private lastWaveform: MilkdropWaveVisual | null = null;
  private lastWaveSamples: number[] = [];
  private customWaveState: MutableState[] = [];
  private customShapeState: MutableState[] = [];
  private lastMeshField: MeshField | null = null;

  constructor(preset: MilkdropCompiledPreset) {
    this.preset = preset;
    this.reset();
  }

  setPreset(preset: MilkdropCompiledPreset) {
    this.preset = preset;
    this.reset();
  }

  setDetailScale(scale: number) {
    this.detailScale = clamp(scale, 0.5, 2);
  }

  setRenderBackend(backend: 'webgl' | 'webgpu') {
    void backend;
  }

  reset() {
    this.state = { ...DEFAULT_MILKDROP_STATE, ...this.preset.ir.numericFields };
    this.registers = {};
    for (let index = 1; index <= 32; index += 1) {
      this.registers[`q${index}`] = 0;
    }
    for (let index = 1; index <= MAX_CUSTOM_WAVE_SLOTS; index += 1) {
      this.registers[`t${index}`] = 0;
    }
    this.randomState =
      hashSeed(this.preset.source.id || this.preset.title || 'milkdrop') || 1;
    this.trails = [];
    this.lastWaveform = null;
    this.lastWaveSamples = [];
    this.customWaveState = this.preset.ir.customWaves.map((wave) =>
      this.seedCustomWaveState(wave),
    );
    this.customShapeState = this.preset.ir.customShapes.map((shape) =>
      this.seedCustomShapeState(shape),
    );
    this.lastMeshField = null;

    const zeroSignals = defaultSignalEnv();
    this.runProgram(this.preset.ir.programs.init, this.createEnv(zeroSignals));
    this.preset.ir.customWaves.forEach((wave, index) => {
      this.runProgram(
        wave.programs.init,
        this.createEnv(zeroSignals, this.customWaveState[index] ?? {}),
        this.customWaveState[index],
      );
    });
    this.preset.ir.customShapes.forEach((shape, index) => {
      this.runProgram(
        shape.programs.init,
        this.createEnv(zeroSignals, this.customShapeState[index] ?? {}),
        this.customShapeState[index],
      );
    });
  }

  getStateSnapshot() {
    return {
      ...this.state,
      ...this.registers,
      ...Object.fromEntries(
        this.customWaveState.flatMap((waveState, index) =>
          Object.entries(waveState).map(([key, value]) => [
            `wave${index + 1}_${key}`,
            value,
          ]),
        ),
      ),
      ...Object.fromEntries(
        this.customShapeState.flatMap((shapeState, index) =>
          Object.entries(shapeState).map(([key, value]) => [
            `shape${index + 1}_${key}`,
            value,
          ]),
        ),
      ),
    };
  }

  private nextRandom = () => {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  };

  private seedCustomWaveState(wave: MilkdropWaveDefinition) {
    return {
      enabled:
        wave.fields.enabled ??
        this.state[`custom_wave_${wave.index}_enabled`] ??
        0,
      samples:
        wave.fields.samples ??
        this.state[`custom_wave_${wave.index}_samples`] ??
        64,
      spectrum:
        wave.fields.spectrum ??
        this.state[`custom_wave_${wave.index}_spectrum`] ??
        0,
      additive:
        wave.fields.additive ??
        this.state[`custom_wave_${wave.index}_additive`] ??
        0,
      usedots:
        wave.fields.usedots ??
        this.state[`custom_wave_${wave.index}_usedots`] ??
        0,
      scaling:
        wave.fields.scaling ??
        this.state[`custom_wave_${wave.index}_scaling`] ??
        1,
      smoothing:
        wave.fields.smoothing ??
        this.state[`custom_wave_${wave.index}_smoothing`] ??
        0.5,
      mystery:
        wave.fields.mystery ??
        this.state[`custom_wave_${wave.index}_mystery`] ??
        0,
      thick:
        wave.fields.thick ?? this.state[`custom_wave_${wave.index}_thick`] ?? 1,
      x: wave.fields.x ?? this.state[`custom_wave_${wave.index}_x`] ?? 0.5,
      y: wave.fields.y ?? this.state[`custom_wave_${wave.index}_y`] ?? 0.5,
      r: wave.fields.r ?? this.state[`custom_wave_${wave.index}_r`] ?? 1,
      g: wave.fields.g ?? this.state[`custom_wave_${wave.index}_g`] ?? 1,
      b: wave.fields.b ?? this.state[`custom_wave_${wave.index}_b`] ?? 1,
      a: wave.fields.a ?? this.state[`custom_wave_${wave.index}_a`] ?? 0.4,
    };
  }

  private seedCustomShapeState(shape: MilkdropShapeDefinition) {
    const prefix = `shape_${shape.index}`;
    return {
      enabled: shape.fields.enabled ?? this.state[`${prefix}_enabled`] ?? 0,
      sides: shape.fields.sides ?? this.state[`${prefix}_sides`] ?? 6,
      x: shape.fields.x ?? this.state[`${prefix}_x`] ?? 0.5,
      y: shape.fields.y ?? this.state[`${prefix}_y`] ?? 0.5,
      rad: shape.fields.rad ?? this.state[`${prefix}_rad`] ?? 0.15,
      ang: shape.fields.ang ?? this.state[`${prefix}_ang`] ?? 0,
      r: shape.fields.r ?? this.state[`${prefix}_r`] ?? 1,
      g: shape.fields.g ?? this.state[`${prefix}_g`] ?? 1,
      b: shape.fields.b ?? this.state[`${prefix}_b`] ?? 1,
      a: shape.fields.a ?? this.state[`${prefix}_a`] ?? 0.2,
      r2: shape.fields.r2 ?? this.state[`${prefix}_r2`] ?? 0,
      g2: shape.fields.g2 ?? this.state[`${prefix}_g2`] ?? 0,
      b2: shape.fields.b2 ?? this.state[`${prefix}_b2`] ?? 0,
      a2: shape.fields.a2 ?? this.state[`${prefix}_a2`] ?? 0,
      border_r: shape.fields.border_r ?? this.state[`${prefix}_border_r`] ?? 1,
      border_g: shape.fields.border_g ?? this.state[`${prefix}_border_g`] ?? 1,
      border_b: shape.fields.border_b ?? this.state[`${prefix}_border_b`] ?? 1,
      border_a:
        shape.fields.border_a ?? this.state[`${prefix}_border_a`] ?? 0.8,
      additive: shape.fields.additive ?? this.state[`${prefix}_additive`] ?? 0,
      thickoutline:
        shape.fields.thickoutline ?? this.state[`${prefix}_thickoutline`] ?? 0,
    };
  }

  private createEnv(
    signals: MilkdropRuntimeSignals,
    extra: Record<string, number> = {},
  ) {
    return {
      ...this.state,
      ...this.registers,
      ...extra,
      time: signals.time,
      frame: signals.frame,
      fps: signals.fps,
      bass: signals.bass,
      mid: signals.mid,
      mids: signals.mids,
      treb: signals.treb,
      treble: signals.treble,
      bass_att: signals.bass_att,
      mid_att: signals.mid_att,
      mids_att: signals.mids_att,
      treb_att: signals.treb_att,
      treble_att: signals.treble_att,
      bassAtt: signals.bassAtt,
      midsAtt: signals.midsAtt,
      trebleAtt: signals.trebleAtt,
      beat: signals.beat,
      beat_pulse: signals.beat_pulse,
      beatPulse: signals.beatPulse,
      rms: signals.rms,
      vol: signals.vol,
      music: signals.music,
      weighted_energy: signals.weightedEnergy,
      progress: signals.frame,
      pi: Math.PI,
      e: Math.E,
    };
  }

  private setValue(
    target: string,
    value: number,
    locals: MutableState | null = null,
  ) {
    const registerMatch = target.toLowerCase().match(/^([qt])(\d+)$/u);
    if (registerMatch) {
      this.registers[target.toLowerCase()] = value;
      return;
    }
    if (locals && target in locals) {
      locals[target] = value;
      return;
    }
    this.state[target] = value;
  }

  private runProgram(
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals: MutableState | null = null,
  ) {
    block.statements.forEach((statement) => {
      const scopedEnv = {
        ...env,
        ...this.state,
        ...this.registers,
        ...(locals ?? {}),
      };
      const value = evaluateMilkdropExpression(
        statement.expression,
        scopedEnv,
        {
          nextRandom: this.nextRandom,
        },
      );
      this.setValue(statement.target, value, locals);
      env[statement.target] = value;
    });
  }

  private buildMainWave(signals: MilkdropRuntimeSignals) {
    const samples = clamp(
      Math.round((48 + this.state.mesh_density * 2) * this.detailScale),
      24,
      192,
    );
    const positions: number[] = [];
    const mode = normalizeWaveMode(this.state.wave_mode ?? 0);
    const centerX = ((this.state.wave_x ?? 0.5) - 0.5) * 2;
    const centerY = (0.5 - (this.state.wave_y ?? 0.5)) * 2;
    const scale = 0.16 + (this.state.wave_scale ?? 1) * 0.18;
    const mystery = this.state.wave_mystery ?? 0;
    const mysteryPhase = mystery * Math.PI;
    const modWaveAlphaStart = clamp(this.state.modwavealphastart ?? 1, 0, 2);
    const modWaveAlphaEnd = clamp(this.state.modwavealphaend ?? 1, 0, 2);
    const modWaveAlphaPhase = clamp(
      0.5 +
        Math.sin(signals.time * (0.9 + (this.state.warpanimspeed ?? 1) * 0.4)) *
          0.35 +
        signals.beatPulse * 0.25,
      0,
      1,
    );
    const liveSamples = Array.from({ length: samples }, (_, index) =>
      sampleFrequencyData(signals, index / Math.max(1, samples - 1)),
    );
    const previousSamples = this.lastWaveSamples;
    const historyBlend = clamp(
      0.26 + signals.beatPulse * 0.48 + signals.deltaMs / 120,
      0.24,
      0.92,
    );
    const smoothedSamples = liveSamples.map((value, index) =>
      mix(previousSamples[index] ?? value, value, historyBlend),
    );
    this.lastWaveSamples = [...smoothedSamples];

    for (let index = 0; index < samples; index += 1) {
      const t = index / Math.max(1, samples - 1);
      const sampleValue =
        smoothedSamples[index] ?? sampleFrequencyData(signals, t);
      const previousSample = previousSamples[index] ?? sampleValue;
      const velocity = sampleValue - previousSample;
      const centeredSample = sampleValue - 0.5;
      let x = 0;
      let y = 0;

      switch (mode) {
        case 1: {
          const angle =
            t * Math.PI * 2 +
            signals.time * 0.32 +
            centeredSample * 0.8 +
            velocity * 2.5;
          const radius =
            0.22 +
            sampleValue * scale +
            signals.beatPulse * 0.08 +
            Math.sin(t * Math.PI * 4 + signals.time) * 0.015;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;
        }
        case 2: {
          const angle =
            t * Math.PI * 5 +
            signals.time * (0.4 + mystery * 0.2) +
            centeredSample * 0.65;
          const radius =
            0.08 + t * 0.6 + sampleValue * scale * 0.6 + velocity * 0.12;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;
        }
        case 3: {
          const angle = t * Math.PI * 2 + signals.time * 0.22;
          const spoke =
            0.2 +
            sampleValue * scale * 1.05 +
            Math.sin(t * Math.PI * 12 + mysteryPhase) * 0.05 +
            velocity * 0.09;
          const pinch = 0.55 + Math.cos(t * Math.PI * 6 + signals.time) * 0.2;
          x = centerX + Math.cos(angle) * spoke;
          y = centerY + Math.sin(angle) * spoke * pinch;
          break;
        }
        case 4: {
          x =
            centerX +
            (sampleValue - 0.5) * scale * 1.85 +
            Math.sin(t * Math.PI * 10 + signals.time * 0.5) * 0.04;
          y = 1.08 - t * 2.16 + velocity * 0.22;
          break;
        }
        case 5: {
          const angle = t * Math.PI * 2 + signals.time * 0.18;
          const xAmp = 0.26 + sampleValue * scale * 0.75;
          const yAmp = 0.18 + sampleValue * scale;
          x =
            centerX +
            Math.sin(angle * (2 + mystery * 0.6)) * xAmp +
            Math.cos(angle * 4 + mysteryPhase) * 0.04 +
            velocity * 0.16;
          y =
            centerY +
            Math.sin(angle * (3 + mystery * 0.5) + Math.PI / 2) * yAmp;
          break;
        }
        case 6: {
          const band = (sampleValue - 0.5) * scale * 1.4;
          x = -1.05 + t * 2.1;
          y =
            centerY +
            (index % 2 === 0 ? band : -band) +
            Math.sin(t * Math.PI * 8 + signals.time * 0.55) * 0.03 +
            velocity * 0.18;
          break;
        }
        case 7: {
          const angle = t * Math.PI * 2 + signals.time * (0.24 + mystery * 0.1);
          const petals = 3 + Math.round(clamp(mystery * 3, 0, 3));
          const radius =
            0.12 +
            (0.2 + sampleValue * scale * 0.9) *
              Math.cos(petals * angle + mysteryPhase) +
            velocity * 0.14;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;
        }
        default:
          x = -1.1 + t * 2.2;
          y =
            centerY +
            Math.sin(t * Math.PI * 2 + signals.time * (0.55 + mystery)) *
              (0.06 + signals.trebleAtt * 0.08) +
            centeredSample * scale * 1.7 +
            velocity * 0.12;
      }

      positions.push(x, y, 0.22 + velocity * 0.08);
    }

    const waveColor = color(
      this.state.wave_r ?? 1,
      this.state.wave_g ?? 1,
      this.state.wave_b ?? 1,
      this.state.wave_a ?? 0.9,
    );
    const finalWaveColor =
      (this.state.wave_brighten ?? 0) >= 0.5
        ? brightenWaveColor(waveColor)
        : waveColor;

    const alpha = clamp(
      (this.state.wave_a ?? 0.9) *
        mix(modWaveAlphaStart, modWaveAlphaEnd, modWaveAlphaPhase),
      0.04,
      1,
    );
    const drawMode = (this.state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
    const additive = (this.state.wave_additive ?? 0) >= 0.5;
    const thickness = clamp(this.state.wave_thick ?? 1, 1, 5);
    const pointSize = clamp((this.state.wave_thick ?? 1) * 3, 1, 12);

    const procedural = null;

    return {
      visual: {
        positions,
        color: finalWaveColor,
        alpha,
        thickness,
        drawMode,
        additive,
        pointSize,
      } satisfies MilkdropWaveVisual,
      procedural,
    };
  }

  private buildCustomWaves(signals: MilkdropRuntimeSignals): {
    visual: MilkdropWaveVisual[];
    procedural: MilkdropProceduralCustomWaveVisual[];
  } {
    const waves: MilkdropWaveVisual[] = [];
    const proceduralWaves: MilkdropProceduralCustomWaveVisual[] = [];

    this.preset.ir.customWaves.forEach((wave, index) => {
      const persistent =
        this.customWaveState[index] ?? this.seedCustomWaveState(wave);
      const frameLocals = { ...persistent };
      this.runProgram(
        wave.programs.perFrame,
        this.createEnv(signals, frameLocals),
        frameLocals,
      );
      this.customWaveState[index] = { ...frameLocals };

      if ((frameLocals.enabled ?? 0) < 0.5) {
        return;
      }

      const sampleCount = clamp(
        Math.round((frameLocals.samples ?? 64) * this.detailScale),
        8,
        256,
      );
      const centerX = ((frameLocals.x ?? 0.5) - 0.5) * 2;
      const centerY = (0.5 - (frameLocals.y ?? 0.5)) * 2;
      const scaling = frameLocals.scaling ?? 1;
      const drawMode = (frameLocals.usedots ?? 0) >= 0.5 ? 'dots' : 'line';
      const additive = (frameLocals.additive ?? 0) >= 0.5;
      const waveColor = color(
        frameLocals.r ?? 1,
        frameLocals.g ?? 1,
        frameLocals.b ?? 1,
        frameLocals.a ?? 0.4,
      );
      const waveAlpha = clamp(frameLocals.a ?? 0.4, 0.02, 1);
      const positions: number[] = [];

      for (let point = 0; point < sampleCount; point += 1) {
        const sample = point / Math.max(1, sampleCount - 1);
        const sampleIndex = Math.min(
          signals.frequencyData.length - 1,
          Math.max(0, Math.round(sample * (signals.frequencyData.length - 1))),
        );
        const spectrumValue = (signals.frequencyData[sampleIndex] ?? 0) / 255;
        const baseY =
          centerY +
          (spectrumValue - 0.5) *
            0.55 *
            scaling *
            (1 + (frameLocals.mystery ?? 0) * 0.25);
        const pointLocals: MutableState = {
          ...frameLocals,
          sample,
          value: spectrumValue,
          x: centerX + (-1 + sample * 2) * 0.85,
          y:
            (frameLocals.spectrum ?? 0) >= 0.5
              ? baseY
              : centerY +
                Math.sin(
                  sample * Math.PI * 2 * (1 + (frameLocals.mystery ?? 0)) +
                    signals.time,
                ) *
                  0.18 *
                  scaling,
        };
        pointLocals.rad = Math.sqrt(
          pointLocals.x * pointLocals.x + pointLocals.y * pointLocals.y,
        );
        pointLocals.ang = Math.atan2(pointLocals.y, pointLocals.x);
        this.runProgram(
          wave.programs.perPoint,
          this.createEnv(signals, pointLocals),
          pointLocals,
        );
        positions.push(pointLocals.x, pointLocals.y, 0.28);
      }

      waves.push({
        positions,
        color: waveColor,
        alpha: waveAlpha,
        thickness: clamp(frameLocals.thick ?? 1, 1, 6),
        drawMode,
        additive,
        pointSize: clamp((frameLocals.thick ?? 1) * 3.2, 1, 14),
        spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
      });
    });

    return {
      visual: waves,
      procedural: proceduralWaves,
    };
  }

  private transformMeshPoint(
    signals: MilkdropRuntimeSignals,
    gridX: number,
    gridY: number,
  ) {
    const local: MutableState = {
      x: gridX,
      y: gridY,
      rad: Math.sqrt(gridX * gridX + gridY * gridY),
      ang: Math.atan2(gridY, gridX),
      zoom: this.state.zoom ?? 1,
      rot: this.state.rot ?? 0,
      warp: this.state.warp ?? 0,
      cx: this.state.cx ?? 0.5,
      cy: this.state.cy ?? 0.5,
      sx: this.state.sx ?? 1,
      sy: this.state.sy ?? 1,
      dx: this.state.dx ?? 0,
      dy: this.state.dy ?? 0,
    };
    this.runProgram(
      this.preset.ir.programs.perPixel,
      this.createEnv(signals, local),
      local,
    );

    const warpAnimSpeed = clamp(this.state.warpanimspeed ?? 1, 0, 4);
    const angle = local.ang + local.rot;
    const centerX = normalizeTransformCenter(local.cx ?? 0.5);
    const centerY = normalizeTransformCenter(local.cy ?? 0.5);
    const scaleX = local.sx ?? 1;
    const scaleY = local.sy ?? 1;
    const translateX = (local.dx ?? 0) * 2;
    const translateY = (local.dy ?? 0) * 2;
    const transformedX = (local.x - centerX) * scaleX + centerX + translateX;
    const transformedY = (local.y - centerY) * scaleY + centerY + translateY;
    const ripple =
      Math.sin(
        local.rad * 12 +
          signals.time * (0.6 + signals.trebleAtt) * (0.35 + warpAnimSpeed),
      ) *
      local.warp *
      0.08;
    const px = (transformedX + Math.cos(angle * 3) * ripple) * local.zoom;
    const py = (transformedY + Math.sin(angle * 4) * ripple) * local.zoom;
    const cos = Math.cos(local.rot);
    const sin = Math.sin(local.rot);
    return {
      x: px * cos - py * sin,
      y: px * sin + py * cos,
    };
  }

  private buildMeshField(signals: MilkdropRuntimeSignals): MeshField {
    const density = clamp(
      Math.round((this.state.mesh_density ?? 16) * this.detailScale),
      8,
      36,
    );
    const points: MeshFieldPoint[] = [];

    for (let row = 0; row < density; row += 1) {
      for (let col = 0; col < density; col += 1) {
        const x = (col / Math.max(1, density - 1)) * 2 - 1;
        const y = (row / Math.max(1, density - 1)) * 2 - 1;
        const point = this.transformMeshPoint(signals, x, y);
        points.push({
          sourceX: x,
          sourceY: y,
          x: point.x,
          y: point.y,
        });
      }
    }

    return { density, points };
  }

  private buildMesh(meshField: MeshField): MilkdropMeshVisual {
    const positions: number[] = [];

    for (let row = 0; row < meshField.density; row += 1) {
      for (let col = 0; col < meshField.density; col += 1) {
        const index = row * meshField.density + col;
        const point = meshField.points[index];
        if (!point) {
          continue;
        }

        if (col + 1 < meshField.density) {
          const next = meshField.points[index + 1];
          if (next) {
            positions.push(point.x, point.y, -0.25, next.x, next.y, -0.25);
          }
        }

        if (row + 1 < meshField.density) {
          const next = meshField.points[index + meshField.density];
          if (next) {
            positions.push(point.x, point.y, -0.25, next.x, next.y, -0.25);
          }
        }
      }
    }

    return {
      positions,
      color: color(
        this.state.mesh_r ?? 0.4,
        this.state.mesh_g ?? 0.6,
        this.state.mesh_b ?? 1,
        this.state.mesh_alpha ?? 0.2,
      ),
      alpha: clamp(this.state.mesh_alpha ?? 0.2, 0.02, 0.9),
    };
  }

  private getProceduralMeshFieldVisual() {
    return null;
  }

  private getProceduralMotionVectorFieldVisual() {
    return null;
  }

  private buildGpuGeometryHints(): MilkdropGpuGeometryHints {
    return {
      mainWave: null,
      trailWaves: [],
      customWaves: [],
      meshField: this.getProceduralMeshFieldVisual(),
      motionVectorField: this.getProceduralMotionVectorFieldVisual(),
    };
  }

  private buildMotionVectors(
    signals: MilkdropRuntimeSignals,
    meshField: MeshField,
  ): MilkdropMotionVectorVisual[] {
    if ((this.state.motion_vectors ?? 0) < 0.5) {
      return [];
    }

    const countX = clamp(Math.round(this.state.motion_vectors_x ?? 16), 1, 64);
    const countY = clamp(Math.round(this.state.motion_vectors_y ?? 12), 1, 64);
    const colorValue = color(
      this.state.mv_r ?? 1,
      this.state.mv_g ?? 1,
      this.state.mv_b ?? 1,
      this.state.mv_a ?? 0.35,
    );
    const alpha = clamp(this.state.mv_a ?? 0.35, 0.02, 1);
    const vectors: MilkdropMotionVectorVisual[] = [];
    const previousField = this.lastMeshField;
    const density = meshField.density;
    const hasPerPixelPrograms =
      this.preset.ir.programs.perPixel.statements.length > 0;

    for (let row = 0; row < countY; row += 1) {
      for (let col = 0; col < countX; col += 1) {
        const sourceX = countX === 1 ? 0 : (col / (countX - 1)) * 2 - 1;
        const sourceY = countY === 1 ? 0 : (row / (countY - 1)) * 2 - 1;
        const fieldCol = Math.round((sourceX + 1) * 0.5 * (density - 1));
        const fieldRow = Math.round((sourceY + 1) * 0.5 * (density - 1));
        const index = fieldRow * density + fieldCol;
        const currentPoint = this.transformMeshPoint(signals, sourceX, sourceY);
        const previous = previousField?.points[index] ?? {
          sourceX,
          sourceY,
          x: sourceX,
          y: sourceY,
        };
        const sourceDx = (currentPoint.x - sourceX) * 1.35;
        const sourceDy = (currentPoint.y - sourceY) * 1.35;
        const historyDx = hasPerPixelPrograms
          ? (currentPoint.x - previous.x) * 1.1
          : 0;
        const historyDy = hasPerPixelPrograms
          ? (currentPoint.y - previous.y) * 1.1
          : 0;
        const dx = clamp(sourceDx + historyDx, -0.24, 0.24);
        const dy = clamp(sourceDy + historyDy, -0.24, 0.24);
        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.002) {
          continue;
        }
        vectors.push({
          positions: [
            currentPoint.x - dx * 0.45,
            currentPoint.y - dy * 0.45,
            0.18,
            currentPoint.x + dx,
            currentPoint.y + dy,
            0.18,
          ],
          color: colorValue,
          alpha: clamp(alpha * (0.75 + magnitude * 2.2), 0.02, 1),
          thickness: clamp(1 + magnitude * 18, 1, 4),
          additive: false,
        });
      }
    }

    return vectors;
  }

  private buildShapes(signals: MilkdropRuntimeSignals): MilkdropShapeVisual[] {
    const builtFromCustom = this.preset.ir.customShapes.map((shape, index) => {
      const locals = {
        ...(this.customShapeState[index] ?? this.seedCustomShapeState(shape)),
      };
      this.runProgram(
        shape.programs.perFrame,
        this.createEnv(signals, locals),
        locals,
      );
      this.customShapeState[index] = { ...locals };
      if ((locals.enabled ?? 0) < 0.5) {
        return null;
      }
      return this.shapeVisualFromLocals(
        `shape_${shape.index}`,
        locals,
        signals,
      );
    });

    const built = builtFromCustom.filter(
      (shape): shape is MilkdropShapeVisual => shape !== null,
    );

    for (let index = 1; index <= MAX_CUSTOM_SHAPE_SLOTS; index += 1) {
      if (this.preset.ir.customShapes.some((shape) => shape.index === index)) {
        continue;
      }
      const prefix = `shape_${index}`;
      if ((this.state[`${prefix}_enabled`] ?? 0) < 0.5) {
        continue;
      }
      built.push(
        this.shapeVisualFromLocals(
          prefix,
          {
            enabled: this.state[`${prefix}_enabled`] ?? 0,
            sides: this.state[`${prefix}_sides`] ?? 6,
            x: this.state[`${prefix}_x`] ?? 0.5,
            y: this.state[`${prefix}_y`] ?? 0.5,
            rad: this.state[`${prefix}_rad`] ?? 0.15,
            ang: this.state[`${prefix}_ang`] ?? 0,
            r: this.state[`${prefix}_r`] ?? 1,
            g: this.state[`${prefix}_g`] ?? 1,
            b: this.state[`${prefix}_b`] ?? 1,
            a: this.state[`${prefix}_a`] ?? 0.2,
            r2: this.state[`${prefix}_r2`] ?? 0,
            g2: this.state[`${prefix}_g2`] ?? 0,
            b2: this.state[`${prefix}_b2`] ?? 0,
            a2: this.state[`${prefix}_a2`] ?? 0,
            border_r: this.state[`${prefix}_border_r`] ?? 1,
            border_g: this.state[`${prefix}_border_g`] ?? 1,
            border_b: this.state[`${prefix}_border_b`] ?? 1,
            border_a: this.state[`${prefix}_border_a`] ?? 0.8,
            additive: this.state[`${prefix}_additive`] ?? 0,
            thickoutline: this.state[`${prefix}_thickoutline`] ?? 0,
          },
          signals,
        ),
      );
    }

    return built;
  }

  private shapeVisualFromLocals(
    key: string,
    locals: MutableState,
    signals: MilkdropRuntimeSignals,
  ): MilkdropShapeVisual {
    const secondaryAlpha = locals.a2 ?? 0;
    return {
      key,
      x: ((locals.x ?? 0.5) - 0.5) * 2,
      y: (0.5 - (locals.y ?? 0.5)) * 2,
      radius: clamp(
        (locals.rad ?? 0.15) * (1 + signals.beatPulse * 0.1),
        0.04,
        0.9,
      ),
      sides: Math.max(3, Math.round(locals.sides ?? 6)),
      rotation: (locals.ang ?? 0) + signals.time * 0.08,
      color: color(
        locals.r ?? 1,
        locals.g ?? 0.5,
        locals.b ?? 0.85,
        locals.a ?? 0.24,
      ),
      secondaryColor:
        secondaryAlpha > 0
          ? color(
              locals.r2 ?? 0,
              locals.g2 ?? 0,
              locals.b2 ?? 0,
              secondaryAlpha,
            )
          : null,
      borderColor: color(
        locals.border_r ?? 1,
        locals.border_g ?? 0.84,
        locals.border_b ?? 1,
        locals.border_a ?? 0.82,
      ),
      additive: (locals.additive ?? 0) >= 0.5,
      thickOutline: (locals.thickoutline ?? 0) >= 0.5,
    };
  }

  private buildBorders(): MilkdropBorderVisual[] {
    const borders: MilkdropBorderVisual[] = [];
    if ((this.state.ob_size ?? 0) > 0.001) {
      borders.push({
        key: 'outer',
        size: clamp(this.state.ob_size ?? 0, 0, 0.3),
        color: color(
          this.state.ob_r ?? 1,
          this.state.ob_g ?? 1,
          this.state.ob_b ?? 1,
          this.state.ob_a ?? 0.8,
        ),
        alpha: clamp(this.state.ob_a ?? 0.8, 0.02, 1),
        styled: (this.state.ob_border ?? 0) > 0.5,
      });
    }
    if ((this.state.ib_size ?? 0) > 0.001) {
      borders.push({
        key: 'inner',
        size: clamp(this.state.ib_size ?? 0, 0, 0.3),
        color: color(
          this.state.ib_r ?? 1,
          this.state.ib_g ?? 1,
          this.state.ib_b ?? 1,
          this.state.ib_a ?? 0.76,
        ),
        alpha: clamp(this.state.ib_a ?? 0.76, 0.02, 1),
        styled: (this.state.ib_border ?? 0) > 0.5,
      });
    }
    return borders;
  }

  private buildShaderControls(signals: MilkdropRuntimeSignals) {
    const env = this.createEnv(signals);
    return evaluateMilkdropShaderControlProgram({
      warp: this.preset.ir.shaderText.warp,
      comp: this.preset.ir.shaderText.comp,
      env,
    });
  }

  private buildPost(signals: MilkdropRuntimeSignals): MilkdropPostVisual {
    return {
      shaderEnabled: (this.state.shader ?? 1) > 0.5,
      textureWrap: (this.state.texture_wrap ?? 0) > 0.5,
      feedbackTexture: (this.state.feedback_texture ?? 0) > 0.5,
      outerBorderStyle: (this.state.ob_border ?? 0) > 0.5,
      innerBorderStyle: (this.state.ib_border ?? 0) > 0.5,
      shaderControls: this.buildShaderControls(signals),
      brighten: (this.state.brighten ?? 0) > 0.5,
      darken: (this.state.darken ?? 0) > 0.5,
      solarize: (this.state.solarize ?? 0) > 0.5,
      invert: (this.state.invert ?? 0) > 0.5,
      gammaAdj: clamp(this.state.gammaadj ?? 1, 0.25, 4),
      videoEchoEnabled: (this.state.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: clamp(this.state.video_echo_alpha ?? 0.18, 0, 1),
      videoEchoZoom: clamp(this.state.video_echo_zoom ?? 1, 0.85, 1.3),
      warp: clamp(this.state.warp ?? 0.08, 0, 1),
    };
  }

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    const { visual: mainWave } = this.buildMainWave(signals);
    const gpuGeometry = this.buildGpuGeometryHints();
    const customWaves = this.buildCustomWaves(signals);
    if (this.lastWaveform) {
      this.trails.unshift(clonePolyline(this.lastWaveform));
      this.trails = this.trails.slice(0, MAX_TRAILS);
    }
    this.lastWaveform = {
      ...mainWave,
      positions: [...mainWave.positions],
      color: { ...mainWave.color },
    };

    const meshField = this.buildMeshField(signals);
    const mesh = this.buildMesh(meshField);
    const motionVectors = this.buildMotionVectors(signals, meshField);
    this.lastMeshField = meshField
      ? {
          density: meshField.density,
          points: meshField.points.map((point) => ({ ...point })),
        }
      : null;

    const frameState: MilkdropFrameState = {
      presetId: this.preset.source.id,
      title: this.preset.title,
      background: color(
        clamp((this.state.bg_r ?? 0.02) + signals.beatPulse * 0.015, 0, 1),
        clamp((this.state.bg_g ?? 0.03) + signals.midsAtt * 0.01, 0, 1),
        clamp((this.state.bg_b ?? 0.06) + signals.trebleAtt * 0.015, 0, 1),
      ),
      waveform: mainWave,
      mainWave,
      customWaves: customWaves.visual,
      trails: this.trails,
      mesh,
      shapes: this.buildShapes(signals),
      borders: this.buildBorders(),
      motionVectors,
      post: this.buildPost(signals),
      signals,
      variables: this.getStateSnapshot(),
      compatibility: this.preset.ir.compatibility,
      gpuGeometry,
    };
    gpuGeometry.customWaves = customWaves.procedural;

    return frameState;
  }
}

export function createMilkdropVM(preset: MilkdropCompiledPreset) {
  return new MilkdropPresetVM(preset);
}
