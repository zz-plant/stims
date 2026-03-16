import { DEFAULT_MILKDROP_STATE } from './compiler';
import { evaluateMilkdropExpression } from './expression';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropMeshVisual,
  MilkdropPolyline,
  MilkdropPostVisual,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropShapeVisual,
  MilkdropVM,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from './types';

const MAX_TRAILS = 5;

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
    frequencyData,
  };
}

type MutableState = Record<string, number>;

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: MutableState = {};
  private registers: MutableState = {};
  private randomState = 1;
  private detailScale = 1;
  private trails: MilkdropPolyline[] = [];
  private lastWaveform: MilkdropWaveVisual | null = null;
  private customWaveState: MutableState[] = [];
  private customShapeState: MutableState[] = [];

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

  reset() {
    this.state = { ...DEFAULT_MILKDROP_STATE, ...this.preset.ir.numericFields };
    this.registers = {};
    for (let index = 1; index <= 32; index += 1) {
      this.registers[`q${index}`] = 0;
    }
    for (let index = 1; index <= 8; index += 1) {
      this.registers[`t${index}`] = 0;
    }
    this.randomState =
      hashSeed(this.preset.source.id || this.preset.title || 'milkdrop') || 1;
    this.trails = [];
    this.lastWaveform = null;
    this.customWaveState = this.preset.ir.customWaves.map((wave) =>
      this.seedCustomWaveState(wave),
    );
    this.customShapeState = this.preset.ir.customShapes.map((shape) =>
      this.seedCustomShapeState(shape),
    );

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

  private buildMainWave(signals: MilkdropRuntimeSignals): MilkdropWaveVisual {
    const samples = clamp(
      Math.round((48 + this.state.mesh_density * 2) * this.detailScale),
      24,
      192,
    );
    const positions: number[] = [];
    const mode = Math.round(this.state.wave_mode) % 3;
    const centerX = ((this.state.wave_x ?? 0.5) - 0.5) * 2;
    const centerY = (0.5 - (this.state.wave_y ?? 0.5)) * 2;
    const scale = 0.16 + (this.state.wave_scale ?? 1) * 0.18;
    const mystery = this.state.wave_mystery ?? 0;

    for (let index = 0; index < samples; index += 1) {
      const sampleIndex = Math.min(
        signals.frequencyData.length - 1,
        Math.max(
          0,
          Math.round(
            (index / Math.max(1, samples - 1)) *
              (signals.frequencyData.length - 1),
          ),
        ),
      );
      const sampleValue = (signals.frequencyData[sampleIndex] ?? 0) / 255;
      const t = index / Math.max(1, samples - 1);
      let x = 0;
      let y = 0;

      if (mode === 1) {
        const angle = t * Math.PI * 2 + signals.time * 0.32;
        const radius = 0.22 + sampleValue * scale + signals.beatPulse * 0.08;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
      } else if (mode === 2) {
        const angle = t * Math.PI * 5 + signals.time * (0.4 + mystery * 0.2);
        const radius = 0.08 + t * 0.6 + sampleValue * scale * 0.6;
        x = centerX + Math.cos(angle) * radius;
        y = centerY + Math.sin(angle) * radius;
      } else {
        x = -1.1 + t * 2.2;
        y =
          centerY +
          Math.sin(t * Math.PI * 2 + signals.time * (0.55 + mystery)) *
            (0.06 + signals.trebleAtt * 0.08) +
          (sampleValue - 0.5) * scale * 1.7;
      }

      positions.push(x, y, 0.25);
    }

    return {
      positions,
      color: color(
        this.state.wave_r ?? 1,
        this.state.wave_g ?? 1,
        this.state.wave_b ?? 1,
        this.state.wave_a ?? 0.9,
      ),
      alpha: clamp(this.state.wave_a ?? 0.9, 0.04, 1),
      thickness: clamp(this.state.wave_thick ?? 1, 1, 5),
      drawMode: (this.state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line',
      additive: (this.state.wave_additive ?? 0) >= 0.5,
      pointSize: clamp((this.state.wave_thick ?? 1) * 3, 1, 12),
    };
  }

  private buildCustomWaves(
    signals: MilkdropRuntimeSignals,
  ): MilkdropWaveVisual[] {
    const waves: MilkdropWaveVisual[] = [];

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
        color: color(
          frameLocals.r ?? 1,
          frameLocals.g ?? 1,
          frameLocals.b ?? 1,
          frameLocals.a ?? 0.4,
        ),
        alpha: clamp(frameLocals.a ?? 0.4, 0.02, 1),
        thickness: clamp(frameLocals.thick ?? 1, 1, 6),
        drawMode: (frameLocals.usedots ?? 0) >= 0.5 ? 'dots' : 'line',
        additive: (frameLocals.additive ?? 0) >= 0.5,
        pointSize: clamp((frameLocals.thick ?? 1) * 3.2, 1, 14),
        spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
      });
    });

    return waves;
  }

  private buildMesh(signals: MilkdropRuntimeSignals): MilkdropMeshVisual {
    const density = clamp(
      Math.round((this.state.mesh_density ?? 16) * this.detailScale),
      8,
      36,
    );
    const positions: number[] = [];

    const computePoint = (gridX: number, gridY: number) => {
      const local: MutableState = {
        x: gridX,
        y: gridY,
        rad: Math.sqrt(gridX * gridX + gridY * gridY),
        ang: Math.atan2(gridY, gridX),
        zoom: this.state.zoom ?? 1,
        rot: this.state.rot ?? 0,
        warp: this.state.warp ?? 0,
      };
      this.runProgram(
        this.preset.ir.programs.perPixel,
        this.createEnv(signals, local),
        local,
      );

      const angle = local.ang + local.rot;
      const ripple =
        Math.sin(local.rad * 12 + signals.time * (0.6 + signals.trebleAtt)) *
        local.warp *
        0.08;
      const px = (local.x + Math.cos(angle * 3) * ripple) * local.zoom;
      const py = (local.y + Math.sin(angle * 4) * ripple) * local.zoom;
      const cos = Math.cos(local.rot);
      const sin = Math.sin(local.rot);
      return {
        x: px * cos - py * sin,
        y: px * sin + py * cos,
      };
    };

    for (let row = 0; row < density; row += 1) {
      for (let col = 0; col < density; col += 1) {
        const x = (col / Math.max(1, density - 1)) * 2 - 1;
        const y = (row / Math.max(1, density - 1)) * 2 - 1;
        const point = computePoint(x, y);

        if (col + 1 < density) {
          const next = computePoint(
            ((col + 1) / Math.max(1, density - 1)) * 2 - 1,
            y,
          );
          positions.push(point.x, point.y, -0.25, next.x, next.y, -0.25);
        }

        if (row + 1 < density) {
          const next = computePoint(
            x,
            ((row + 1) / Math.max(1, density - 1)) * 2 - 1,
          );
          positions.push(point.x, point.y, -0.25, next.x, next.y, -0.25);
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

    for (let index = 1; index <= 4; index += 1) {
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
      });
    }
    return borders;
  }

  private buildPost(): MilkdropPostVisual {
    return {
      brighten: (this.state.brighten ?? 0) > 0.5,
      darken: (this.state.darken ?? 0) > 0.5,
      solarize: (this.state.solarize ?? 0) > 0.5,
      invert: (this.state.invert ?? 0) > 0.5,
      videoEchoEnabled: (this.state.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: clamp(this.state.video_echo_alpha ?? 0.18, 0, 1),
      videoEchoZoom: clamp(this.state.video_echo_zoom ?? 1, 0.85, 1.3),
      warp: clamp(this.state.warp ?? 0.08, 0, 1),
    };
  }

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    const mainWave = this.buildMainWave(signals);
    if (this.lastWaveform) {
      this.trails.unshift(clonePolyline(this.lastWaveform));
      this.trails = this.trails.slice(0, MAX_TRAILS);
    }
    this.lastWaveform = {
      ...mainWave,
      positions: [...mainWave.positions],
      color: { ...mainWave.color },
    };

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
      customWaves: this.buildCustomWaves(signals),
      trails: this.trails.map(clonePolyline),
      mesh: this.buildMesh(signals),
      shapes: this.buildShapes(signals),
      borders: this.buildBorders(),
      post: this.buildPost(),
      signals,
      variables: this.getStateSnapshot(),
      compatibility: this.preset.ir.compatibility,
    };

    return frameState;
  }
}

export function createMilkdropVM(preset: MilkdropCompiledPreset) {
  return new MilkdropPresetVM(preset);
}
