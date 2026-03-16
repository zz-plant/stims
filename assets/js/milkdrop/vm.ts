import { DEFAULT_MILKDROP_STATE } from './compiler';
import { evaluateMilkdropExpression } from './expression';
import type {
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropPolyline,
  MilkdropRuntimeSignals,
  MilkdropShapeVisual,
  MilkdropVM,
} from './types';

const MAX_SHAPES = 4;
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

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: Record<string, number> = {};
  private registers: Record<string, number> = {};
  private randomState = 1;
  private detailScale = 1;
  private trails: MilkdropPolyline[] = [];
  private lastWaveform: MilkdropPolyline | null = null;

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
    for (let index = 1; index <= 8; index += 1) {
      this.registers[`q${index}`] = 0;
    }
    this.randomState =
      hashSeed(this.preset.source.id || this.preset.title) || 1;
    this.trails = [];
    this.lastWaveform = null;
    this.runProgram(this.preset.ir.programs.init, {
      time: 0,
      frame: 0,
      bass: 0,
      mids: 0,
      treble: 0,
      bass_att: 0,
      mids_att: 0,
      treble_att: 0,
      beat: 0,
      beat_pulse: 0,
      rms: 0,
      weighted_energy: 0,
    });
  }

  getStateSnapshot() {
    return { ...this.state, ...this.registers };
  }

  private nextRandom = () => {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  };

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
      bass: signals.bass,
      mids: signals.mids,
      treble: signals.treble,
      bass_att: signals.bassAtt,
      mids_att: signals.midsAtt,
      treble_att: signals.trebleAtt,
      beat: signals.beat,
      beat_pulse: signals.beatPulse,
      rms: signals.rms,
      weighted_energy: signals.weightedEnergy,
      pi: Math.PI,
      e: Math.E,
    };
  }

  private setValue(
    target: string,
    value: number,
    locals: Record<string, number> | null = null,
  ) {
    if (/^q\d+$/u.test(target)) {
      this.registers[target] = value;
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
    env: Record<string, number>,
    locals: Record<string, number> | null = null,
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

  private buildWaveform(signals: MilkdropRuntimeSignals) {
    const frequencyData = signals.frequencyData;
    const samples = clamp(
      Math.round((48 + this.state.mesh_density * 2) * this.detailScale),
      24,
      144,
    );
    const positions: number[] = [];
    const mode = Math.round(this.state.wave_mode) % 3;
    const centerX = (this.state.wave_x - 0.5) * 2;
    const centerY = (0.5 - this.state.wave_y) * 2;
    const scale = 0.16 + this.state.wave_scale * 0.18;

    for (let index = 0; index < samples; index += 1) {
      const sampleIndex = Math.min(
        frequencyData.length - 1,
        Math.max(
          0,
          Math.round(
            (index / Math.max(1, samples - 1)) * (frequencyData.length - 1),
          ),
        ),
      );
      const sampleValue = (frequencyData[sampleIndex] ?? 0) / 255;
      const t = index / Math.max(1, samples - 1);
      const mystery = this.state.wave_mystery;
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
        this.state.wave_r,
        this.state.wave_g,
        this.state.wave_b,
        this.state.wave_a,
      ),
      alpha: clamp(this.state.wave_a, 0.04, 1),
      thickness: clamp(this.state.wave_thick, 1, 4),
    } satisfies MilkdropPolyline;
  }

  private buildMesh(signals: MilkdropRuntimeSignals) {
    const density = clamp(
      Math.round(this.state.mesh_density * this.detailScale),
      8,
      34,
    );
    const positions: number[] = [];

    const computePoint = (gridX: number, gridY: number) => {
      const local = {
        x: gridX,
        y: gridY,
        rad: Math.sqrt(gridX * gridX + gridY * gridY),
        ang: Math.atan2(gridY, gridX),
        zoom: this.state.zoom,
        rot: this.state.rot,
        warp: this.state.warp,
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
        this.state.mesh_r,
        this.state.mesh_g,
        this.state.mesh_b,
        this.state.mesh_alpha,
      ),
      alpha: clamp(this.state.mesh_alpha, 0.04, 0.9),
    };
  }

  private buildShapes(signals: MilkdropRuntimeSignals) {
    const shapes: MilkdropShapeVisual[] = [];
    for (let index = 1; index <= MAX_SHAPES; index += 1) {
      const prefix = `shape_${index}`;
      if ((this.state[`${prefix}_enabled`] ?? 0) < 0.5) {
        continue;
      }
      shapes.push({
        key: prefix,
        x: ((this.state[`${prefix}_x`] ?? 0.5) - 0.5) * 2,
        y: (0.5 - (this.state[`${prefix}_y`] ?? 0.5)) * 2,
        radius: clamp(
          (this.state[`${prefix}_rad`] ?? 0.15) * (1 + signals.beatPulse * 0.1),
          0.04,
          0.8,
        ),
        sides: Math.max(3, Math.round(this.state[`${prefix}_sides`] ?? 6)),
        rotation: (this.state[`${prefix}_ang`] ?? 0) + signals.time * 0.08,
        color: color(
          this.state[`${prefix}_r`] ?? 1,
          this.state[`${prefix}_g`] ?? 0.5,
          this.state[`${prefix}_b`] ?? 0.85,
          this.state[`${prefix}_a`] ?? 0.24,
        ),
        borderColor: color(
          this.state[`${prefix}_border_r`] ?? 1,
          this.state[`${prefix}_border_g`] ?? 0.84,
          this.state[`${prefix}_border_b`] ?? 1,
          this.state[`${prefix}_border_a`] ?? 0.82,
        ),
        additive: (this.state[`${prefix}_additive`] ?? 1) >= 0.5,
        thickOutline: (this.state[`${prefix}_thickoutline`] ?? 1) >= 0.5,
      });
    }
    return shapes;
  }

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    const waveform = this.buildWaveform(signals);
    if (this.lastWaveform) {
      const decayed = clonePolyline(this.lastWaveform);
      this.trails.unshift(decayed);
      this.trails = this.trails.slice(0, MAX_TRAILS);
    }
    this.lastWaveform = clonePolyline(waveform);

    const trails = this.trails.map((trail, index) => ({
      ...clonePolyline(trail),
      alpha: clamp(
        trail.alpha * Math.max(0.08, this.state.decay - index * 0.08),
        0.04,
        0.75,
      ),
    }));

    return {
      presetId: this.preset.source.id,
      title: this.preset.title,
      background: color(this.state.bg_r, this.state.bg_g, this.state.bg_b, 1),
      waveform,
      trails,
      mesh: this.buildMesh(signals),
      shapes: this.buildShapes(signals),
      signals,
      variables: this.getStateSnapshot(),
      compatibility: this.preset.ir.compatibility,
    };
  }
}

export function createMilkdropVM(preset: MilkdropCompiledPreset): MilkdropVM {
  return new MilkdropPresetVM(preset);
}
