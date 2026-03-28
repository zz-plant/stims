import type {
  MilkdropBorderVisual,
  MilkdropCompiledPreset,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropShapeVisual,
} from '../types';
import {
  clamp,
  color,
  MAX_CUSTOM_SHAPE_SLOTS,
  type MutableState,
  type ShapeBuilderState,
} from './shared';

export function shapeVisualFromLocals(
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
        ? color(locals.r2 ?? 0, locals.g2 ?? 0, locals.b2 ?? 0, secondaryAlpha)
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

function fallbackShapeLocals(
  state: MutableState,
  prefix: string,
): MutableState {
  return {
    enabled: state[`${prefix}_enabled`] ?? 0,
    sides: state[`${prefix}_sides`] ?? 6,
    x: state[`${prefix}_x`] ?? 0.5,
    y: state[`${prefix}_y`] ?? 0.5,
    rad: state[`${prefix}_rad`] ?? 0.15,
    ang: state[`${prefix}_ang`] ?? 0,
    textured: state[`${prefix}_textured`] ?? 0,
    tex_zoom: state[`${prefix}_tex_zoom`] ?? 1,
    tex_ang: state[`${prefix}_tex_ang`] ?? 0,
    r: state[`${prefix}_r`] ?? 1,
    g: state[`${prefix}_g`] ?? 1,
    b: state[`${prefix}_b`] ?? 1,
    a: state[`${prefix}_a`] ?? 0.2,
    r2: state[`${prefix}_r2`] ?? 0,
    g2: state[`${prefix}_g2`] ?? 0,
    b2: state[`${prefix}_b2`] ?? 0,
    a2: state[`${prefix}_a2`] ?? 0,
    border_r: state[`${prefix}_border_r`] ?? 1,
    border_g: state[`${prefix}_border_g`] ?? 1,
    border_b: state[`${prefix}_border_b`] ?? 1,
    border_a: state[`${prefix}_border_a`] ?? 0.8,
    additive: state[`${prefix}_additive`] ?? 0,
    thickoutline: state[`${prefix}_thickoutline`] ?? 0,
  };
}

export function buildShapes({
  preset,
  state,
  signals,
  shapeState,
  runProgram,
  createEnv,
  seedCustomShapeState,
}: {
  preset: MilkdropCompiledPreset;
  state: MutableState;
  signals: MilkdropRuntimeSignals;
  shapeState: ShapeBuilderState;
  runProgram: (
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals?: MutableState | null,
  ) => void;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
  ) => MutableState;
  seedCustomShapeState: (shape: MilkdropShapeDefinition) => MutableState;
}): MilkdropShapeVisual[] {
  const builtFromCustom = preset.ir.customShapes.map((shape, index) => {
    const locals = {
      ...(shapeState.customShapeLocals[index] ?? seedCustomShapeState(shape)),
    };
    runProgram(shape.programs.perFrame, createEnv(signals, locals), locals);
    shapeState.customShapeLocals[index] = { ...locals };
    if ((locals.enabled ?? 0) < 0.5) {
      return null;
    }
    return shapeVisualFromLocals(`shape_${shape.index}`, locals, signals);
  });

  const customShapeIndices = new Set(
    preset.ir.customShapes.map((shape) => shape.index),
  );
  const built = builtFromCustom.filter(
    (shape): shape is MilkdropShapeVisual => shape !== null,
  );

  for (let index = 1; index <= MAX_CUSTOM_SHAPE_SLOTS; index += 1) {
    if (customShapeIndices.has(index)) {
      continue;
    }
    const prefix = `shape_${index}`;
    if ((state[`${prefix}_enabled`] ?? 0) < 0.5) {
      continue;
    }
    built.push(
      shapeVisualFromLocals(
        prefix,
        fallbackShapeLocals(state, prefix),
        signals,
      ),
    );
  }

  return built;
}

export function buildBorders(state: MutableState): MilkdropBorderVisual[] {
  const borders: MilkdropBorderVisual[] = [];
  if ((state.ob_size ?? 0) > 0.001) {
    borders.push({
      key: 'outer',
      size: clamp(state.ob_size ?? 0, 0, 0.3),
      color: color(
        state.ob_r ?? 1,
        state.ob_g ?? 1,
        state.ob_b ?? 1,
        state.ob_a ?? 0.8,
      ),
      alpha: clamp(state.ob_a ?? 0.8, 0.02, 1),
      styled: (state.ob_border ?? 0) > 0.5,
    });
  }
  if ((state.ib_size ?? 0) > 0.001) {
    borders.push({
      key: 'inner',
      size: clamp(state.ib_size ?? 0, 0, 0.3),
      color: color(
        state.ib_r ?? 1,
        state.ib_g ?? 1,
        state.ib_b ?? 1,
        state.ib_a ?? 0.76,
      ),
      alpha: clamp(state.ib_a ?? 0.76, 0.02, 1),
      styled: (state.ib_border ?? 0) > 0.5,
    });
  }
  return borders;
}
