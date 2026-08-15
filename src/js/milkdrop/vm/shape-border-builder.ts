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
  SHAPECODE_PROPERTY_KEYS,
  type ShapeBuilderState,
} from './shared';

/** MilkDrop's own ceiling for `shapecode_N_num_inst`. */
const MAX_SHAPE_INSTANCES = 1024;

export function shapeVisualFromLocals(
  key: string,
  locals: MutableState,
  _signals: MilkdropRuntimeSignals,
): MilkdropShapeVisual {
  const secondaryAlpha = locals.a2 ?? 0;
  return {
    key,
    x: ((locals.x ?? 0.5) - 0.5) * 2,
    y: (0.5 - (locals.y ?? 0.5)) * 2,
    // The lower bound only guards against degenerate geometry. It has to stay
    // well below MilkDrop's typical instanced-dot radii (0.005-0.02), which an
    // aggressive floor would inflate into overlapping blobs.
    radius: clamp(locals.rad ?? 0.15, 0.002, 0.9),
    sides: Math.max(3, Math.round(locals.sides ?? 6)),
    rotation: locals.ang ?? 0,
    textured: (locals.textured ?? 0) >= 0.5,
    textureZoom: Math.max(0.0001, Math.abs(locals.tex_zoom ?? 1)),
    textureAngle: locals.tex_ang ?? 0,
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
  prefixOrIndex: string | number,
): MutableState {
  const keys =
    typeof prefixOrIndex === 'number'
      ? SHAPECODE_PROPERTY_KEYS[prefixOrIndex]
      : null;
  const prefix = typeof prefixOrIndex === 'string' ? prefixOrIndex : null;
  return {
    enabled:
      (keys ? state[keys.enabled] : prefix ? state[`${prefix}_enabled`] : 0) ??
      0,
    sides:
      (keys ? state[keys.sides] : prefix ? state[`${prefix}_sides`] : 6) ?? 6,
    x: (keys ? state[keys.x] : prefix ? state[`${prefix}_x`] : 0.5) ?? 0.5,
    y: (keys ? state[keys.y] : prefix ? state[`${prefix}_y`] : 0.5) ?? 0.5,
    rad:
      (keys ? state[keys.rad] : prefix ? state[`${prefix}_rad`] : 0.15) ?? 0.15,
    ang: (keys ? state[keys.ang] : prefix ? state[`${prefix}_ang`] : 0) ?? 0,
    textured:
      (keys
        ? state[keys.textured]
        : prefix
          ? state[`${prefix}_textured`]
          : 0) ?? 0,
    tex_zoom:
      (keys
        ? state[keys.tex_zoom]
        : prefix
          ? state[`${prefix}_tex_zoom`]
          : 1) ?? 1,
    tex_ang:
      (keys ? state[keys.tex_ang] : prefix ? state[`${prefix}_tex_ang`] : 0) ??
      0,
    r: (keys ? state[keys.r] : prefix ? state[`${prefix}_r`] : 1) ?? 1,
    g: (keys ? state[keys.g] : prefix ? state[`${prefix}_g`] : 1) ?? 1,
    b: (keys ? state[keys.b] : prefix ? state[`${prefix}_b`] : 1) ?? 1,
    a: (keys ? state[keys.a] : prefix ? state[`${prefix}_a`] : 0.2) ?? 0.2,
    r2: (keys ? state[keys.r2] : prefix ? state[`${prefix}_r2`] : 0) ?? 0,
    g2: (keys ? state[keys.g2] : prefix ? state[`${prefix}_g2`] : 0) ?? 0,
    b2: (keys ? state[keys.b2] : prefix ? state[`${prefix}_b2`] : 0) ?? 0,
    a2: (keys ? state[keys.a2] : prefix ? state[`${prefix}_a2`] : 0) ?? 0,
    border_r:
      (keys
        ? state[keys.border_r]
        : prefix
          ? state[`${prefix}_border_r`]
          : 1) ?? 1,
    border_g:
      (keys
        ? state[keys.border_g]
        : prefix
          ? state[`${prefix}_border_g`]
          : 1) ?? 1,
    border_b:
      (keys
        ? state[keys.border_b]
        : prefix
          ? state[`${prefix}_border_b`]
          : 1) ?? 1,
    border_a:
      (keys
        ? state[keys.border_a]
        : prefix
          ? state[`${prefix}_border_a`]
          : 0.8) ?? 0.8,
    additive:
      (keys
        ? state[keys.additive]
        : prefix
          ? state[`${prefix}_additive`]
          : 0) ?? 0,
    thickoutline:
      (keys
        ? state[keys.thickoutline]
        : prefix
          ? state[`${prefix}_thickoutline`]
          : 0) ?? 0,
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
    options?: {
      reuseExtraAsEnv?: boolean;
    },
  ) => MutableState;
  seedCustomShapeState: (shape: MilkdropShapeDefinition) => MutableState;
}): MilkdropShapeVisual[] {
  const built: MilkdropShapeVisual[] = [];
  const customShapeIndices = preset.ir.customShapeIndices;

  for (let index = 0; index < preset.ir.customShapes.length; index += 1) {
    const shape = preset.ir.customShapes[index];
    if (!shape) {
      continue;
    }

    const locals =
      shapeState.customShapeLocals[index] ?? seedCustomShapeState(shape);
    shapeState.customShapeLocals[index] = locals;

    // MilkDrop runs the per-frame shape code once per instance, exposing the
    // instance number so a single shape definition can lay out a whole field of
    // primitives.
    const instanceCount = clamp(
      Math.round(shape.fields.num_inst ?? locals.num_inst ?? 1),
      1,
      MAX_SHAPE_INSTANCES,
    );
    const env = createEnv(signals, locals, { reuseExtraAsEnv: true });

    // Restore t/v from post-init snapshot before instance loop
    const tAfterInit = shapeState.customShapeTAfterInit[index];
    const baseTLocals = {
      t1: tAfterInit?.t1 ?? locals.t1 ?? 0,
      t2: tAfterInit?.t2 ?? locals.t2 ?? 0,
      t3: tAfterInit?.t3 ?? locals.t3 ?? 0,
      t4: tAfterInit?.t4 ?? locals.t4 ?? 0,
      t5: tAfterInit?.t5 ?? locals.t5 ?? 0,
      t6: tAfterInit?.t6 ?? locals.t6 ?? 0,
      t7: tAfterInit?.t7 ?? locals.t7 ?? 0,
      t8: tAfterInit?.t8 ?? locals.t8 ?? 0,
      v1: locals.v1 ?? 0,
      v2: locals.v2 ?? 0,
      v3: locals.v3 ?? 0,
      v4: locals.v4 ?? 0,
      v5: locals.v5 ?? 0,
      v6: locals.v6 ?? 0,
      v7: locals.v7 ?? 0,
      v8: locals.v8 ?? 0,
    };

    for (let instance = 0; instance < instanceCount; instance += 1) {
      Object.assign(locals, baseTLocals);
      locals.instance = instance;
      locals.num_inst = instanceCount;
      runProgram(shape.programs.perFrame, env, locals);
      if ((locals.enabled ?? 0) < 0.5) {
        continue;
      }
      built.push(
        shapeVisualFromLocals(
          instanceCount > 1
            ? `shape_${shape.index}_${instance}`
            : `shape_${shape.index}`,
          locals,
          signals,
        ),
      );
    }
  }

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

/**
 * A border is built when the preset asked for one: either it declared the
 * border's size, or the border is currently visible. Both sizes default to
 * MilkDrop's 0.01, so a size-only test would emit two fully transparent quads
 * for every preset in the catalog; requiring visibility alone would drop the
 * declared-but-transparent borders that per-frame code fades in later.
 */
export function buildBorders(
  state: MutableState,
  declaredBorderKeys?: ReadonlySet<'outer' | 'inner'>,
): MilkdropBorderVisual[] {
  const borders: MilkdropBorderVisual[] = [];
  const wanted = (key: 'outer' | 'inner', alpha: number) =>
    (declaredBorderKeys?.has(key) ?? true) || alpha > 0.001;
  if ((state.ob_size ?? 0) > 0.001 && wanted('outer', state.ob_a ?? 0)) {
    borders.push({
      key: 'outer',
      size: clamp(state.ob_size ?? 0, 0, 0.3),
      color: color(
        state.ob_r ?? 1,
        state.ob_g ?? 1,
        state.ob_b ?? 1,
        state.ob_a ?? 0.8,
      ),
      alpha: clamp(state.ob_a ?? 0.8, 0, 1),
      styled: (state.ob_border ?? 0) > 0.5,
    });
  }
  if ((state.ib_size ?? 0) > 0.001 && wanted('inner', state.ib_a ?? 0)) {
    borders.push({
      key: 'inner',
      size: clamp(state.ib_size ?? 0, 0, 0.3),
      color: color(
        state.ib_r ?? 1,
        state.ib_g ?? 1,
        state.ib_b ?? 1,
        state.ib_a ?? 0.76,
      ),
      alpha: clamp(state.ib_a ?? 0.76, 0, 1),
      styled: (state.ib_border ?? 0) > 0.5,
    });
  }
  return borders;
}
