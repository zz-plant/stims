/**
 * WebGPU materials for the procedurally generated visuals.
 *
 * Builds the node-based materials the WebGPU backend uses for procedural waves,
 * particle fields and motion vectors — the visuals whose geometry is generated
 * per frame from VM state rather than authored.
 *
 * Each material here has a WebGL counterpart under `renderer-helpers/`, and the
 * pair is expected to produce the same image. When adding a visual, add both
 * sides together; a backend-only visual becomes a silent difference on hardware
 * the author does not have.
 */
import { Color } from 'three';
// @ts-expect-error - 'three/webgpu' is available at runtime but not under the repo's current moduleResolution.
import { NodeMaterial, TSL } from 'three/webgpu';
import {
  EEL_BINARY_OPERATORS,
  EEL_UNARY_OPERATORS,
  emitEelCallWgslField,
} from '../compiler/eel-function-table.ts';
import { MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE } from '../compiler/wgsl-eel-helpers';
import {
  MILKDROP_CUSTOM_WAVE_Z,
  MILKDROP_WAVE_Z,
} from '../renderer-helpers/primitive-rasterization-metrics';
import {
  createProceduralFieldUniformState,
  createProceduralInteractionUniformState,
} from '../renderer-helpers/procedural-field-uniforms';
import { registerWebGpuHelperMaterials } from '../renderer-helpers/webgpu-materials-loader';
import type {
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
} from '../types';

// NOTE: this was previously wrong — TSL DOES expose a native texture3D()
// node (see feedback-manager-webgpu-composite.ts, `texture3D` imported from
// TSL and used via tex3DNodes.*.sample()). The composite path samples real
// Data3DTextures natively for every volume type (noise, simplex, voronoi,
// aura, caustics, pattern, fractal, perlin); only `video` still needs 2D
// atlas slicing, since a captured video frame isn't a real volume.

// three.js's WebGPURenderer only recognizes materials registered in its
// StandardNodeLibrary (MeshBasicMaterial, MeshStandardMaterial, etc). A
// plain THREE.ShaderMaterial is not in that library, so NodeBuilder logs
// "Material is not compatible" and silently swaps in a blank default
// NodeMaterial instead of the intended shader — the geometry renders with
// no custom color/position logic at all. wgslFn wraps hand-written WGSL as
// a callable node function so it can drive a real NodeMaterial's
// vertexNode/colorNode without rewriting the math into TSL's JS node DSL.
// Everything must be WGSL (not GLSL): three.js's WebGPU backend runs wgslFn
// bodies through its native WGSL pipeline, and these material paths only
// ever run on the native WebGPU backend (see renderMesh /
// renderMotionVectors / the procedural wave sync helpers, all gated on
// backend === 'webgpu').
const {
  Discard,
  Fn,
  attribute,
  cameraProjectionMatrix,
  modelViewMatrix,
  uniform,
  varying,
  vec4,
  wgsl,
  wgslFn,
} = TSL;

type TslNode = {
  value: number & Color;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  w: TslNode;
  mul: (other: unknown) => TslNode;
  lessThanEqual: (other: unknown) => TslNode;
  [key: string]: unknown;
};

type TslVertexFn = (inputs: object) => TslNode;

type TslUniformNodes<T> = { [K in keyof T]: TslNode };

// The per-preset field programs arrive as expression ASTs and historically
// compiled to GLSL. On WebGPU they must compile to WGSL instead; the
// dialect differences that matter here are: no ternary operator (select()),
// no mod() builtin (milkdropMod helper, which also guards divide-by-zero
// like the GLSL version did), two-argument atan spelled atan2, and
// float(int(...)) casts spelled f32(i32(...)).
// Every truthiness/equality threshold below is MilkDrop's EEL close factor
// (0.00001, MILKDROP_EEL_CLOSE_FACTOR) — the CPU JIT and interpreter use the
// same constant, and the tier-differential census caught these helpers using
// a tenfold-tighter 0.000001, which flipped boolean results near the
// threshold between backends.
export const MILKDROP_FIELD_WGSL_HELPERS_SOURCE = `${MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE}
  fn milkdropNormalizeTransformCenterX(value: f32) -> f32 {
    return select(value, (value - 0.5) * 2.0, value >= 0.0 && value <= 1.0);
  }

  fn milkdropNormalizeTransformCenterY(value: f32) -> f32 {
    return select(value, (0.5 - value) * 2.0, value >= 0.0 && value <= 1.0);
  }

  fn milkdropDenormalizeTransformCenterX(value: f32) -> f32 {
    return value * 0.5 + 0.5;
  }

  fn milkdropDenormalizeTransformCenterY(value: f32) -> f32 {
    return 0.5 - value * 0.5;
  }
`;

const MILKDROP_FIELD_WGSL_HELPERS = wgsl(MILKDROP_FIELD_WGSL_HELPERS_SOURCE);

// Runtime signal values reach the generated WGSL packed into five vec4
// parameters (signalsA..signalsE) to keep wgslFn parameter lists sane; this
// preamble unpacks them under the same local names the expression compiler
// emits for signal identifiers.
const WGSL_SIGNAL_UNPACK = `
    let signalTimeValue = signalsA.x;
    let signalFrameValue = signalsA.y;
    let signalFpsValue = signalsA.z;
    let signalAspectValue = signalsA.w;
    let signalBassValue = signalsB.x;
    let signalMidValue = signalsB.y;
    let signalMidsValue = signalsB.z;
    let signalTrebleValue = signalsB.w;
    let signalBassAttValue = signalsC.x;
    let signalMidAttValue = signalsC.y;
    let signalMidsAttValue = signalsC.z;
    let signalTrebleAttValue = signalsC.w;
    let signalBeatValue = signalsD.x;
    let signalBeatPulseValue = signalsD.y;
    let signalRmsValue = signalsD.z;
    let signalVolValue = signalsD.w;
    let signalMusicValue = signalsE.x;
    let signalWeightedEnergyValue = signalsE.y;
    let signalPixelsXValue = signalsE.z;
    let signalPixelsYValue = signalsE.w;
    // MilkDrop aspectx/aspecty builtins, derived exactly as the CPU path does
    // (wgsl-signal-layout.ts deriveMilkdropViewportSignalValues).
    let signalAspectXValue = select(1.0, 1.0 / signalAspectValue, signalAspectValue < 1.0);
    let signalAspectYValue = select(1.0, signalAspectValue, signalAspectValue > 1.0);
`;

const WGSL_SIGNAL_PARAMETERS = `
    signalsA: vec4<f32>,
    signalsB: vec4<f32>,
    signalsC: vec4<f32>,
    signalsD: vec4<f32>,
    signalsE: vec4<f32>`;

function gpuFieldVarName(name: string) {
  switch (name) {
    case 'zoom':
      return 'fieldZoom';
    case 'zoomexp':
      return 'fieldZoomExponent';
    case 'rot':
      return 'fieldRotation';
    case 'warp':
      return 'fieldWarp';
    case 'warp_scale':
      return 'fieldWarpScale';
    case 'cx':
      return 'fieldCenterX';
    case 'cy':
      return 'fieldCenterY';
    case 'sx':
      return 'fieldScaleX';
    case 'sy':
      return 'fieldScaleY';
    case 'dx':
      return 'fieldTranslateX';
    case 'dy':
      return 'fieldTranslateY';
    default:
      return `field_${name}`;
  }
}

function gpuFieldIdentifierToShaderSource(
  name: string,
  registerInputs: ReadonlySet<string>,
) {
  switch (name) {
    case 'pi':
      return '3.141592653589793';
    case 'e':
      return '2.718281828459045';
    case 'time':
      return 'signalTimeValue';
    case 'frame':
      return 'signalFrameValue';
    case 'fps':
      return 'signalFpsValue';
    case 'aspect':
      return 'signalAspectValue';
    case 'aspectX':
      return 'signalAspectXValue';
    case 'aspectY':
      return 'signalAspectYValue';
    case 'pixelsx':
      return 'signalPixelsXValue';
    case 'pixelsy':
      return 'signalPixelsYValue';
    // The warp mesh is square (density x density), so both dimensions read
    // the same packed param.
    case 'meshx':
    case 'meshy':
      return 'fieldMeshSizeValue';
    case 'bass':
      return 'signalBassValue';
    case 'mid':
      return 'signalMidValue';
    case 'mids':
      return 'signalMidsValue';
    case 'treble':
      return 'signalTrebleValue';
    case 'bassAtt':
      return 'signalBassAttValue';
    case 'midAtt':
      return 'signalMidAttValue';
    case 'midsAtt':
      return 'signalMidsAttValue';
    case 'trebleAtt':
      return 'signalTrebleAttValue';
    case 'beat':
      return 'signalBeatValue';
    case 'beatPulse':
      return 'signalBeatPulseValue';
    case 'rms':
      return 'signalRmsValue';
    case 'vol':
      return 'signalVolValue';
    case 'music':
      return 'signalMusicValue';
    case 'weightedEnergy':
      return 'signalWeightedEnergyValue';
    default: {
      if (registerInputs.has(name)) {
        return registerBindingName(name);
      }
      return gpuFieldVarName(name);
    }
  }
}

// Frame-constant register inputs (q registers and per-frame-assigned user
// variables alike) lower to per-vertex `let` bindings fed from packed
// register uniform vectors (`registersA`..`registersH`, four scalars each).
// Slot assignment is positional in the descriptor's sorted `registerInputs`
// list, so only ceil(inputs/4) vectors are declared and passed. The
// `fieldRegisterIn_*` namespace is distinct from `field_*` (temporaries
// written per-vertex), so a name that is both assigned and read elsewhere
// stays a temporary.
const REGISTER_VECTOR_LETTERS = 'ABCDEFGH';
const REGISTER_VECTOR_COUNT = REGISTER_VECTOR_LETTERS.length;
const REGISTER_VECTOR_SLOTS = ['x', 'y', 'z', 'w'] as const;

function registerBindingName(name: string) {
  return `fieldRegisterIn_${name}`;
}

/** Sorted indices (0-based, one per vec4) of the register vectors the
 * program's `registerInputs` occupy positionally. */
function getRegisterVectorIndices(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
): number[] {
  const count = program?.registerInputs.length ?? 0;
  const vectors = Math.min(REGISTER_VECTOR_COUNT, Math.ceil(count / 4));
  return Array.from({ length: vectors }, (_, index) => index);
}

function buildGpuFieldRegisterBindings(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  if (!program || program.registerInputs.length === 0) {
    return '';
  }
  const bindings = program.registerInputs.map((name, index) => {
    const vector = Math.floor(index / 4);
    if (vector >= REGISTER_VECTOR_COUNT) {
      return '';
    }
    return `let ${registerBindingName(name)} = registers${REGISTER_VECTOR_LETTERS[vector]}.${REGISTER_VECTOR_SLOTS[index % 4]};`;
  });
  return bindings.filter(Boolean).join('\n    ');
}

function buildGpuFieldRegisterParamDecls(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return getRegisterVectorIndices(program)
    .map(
      (vector) =>
        `,\n    registers${REGISTER_VECTOR_LETTERS[vector]}: vec4<f32>`,
    )
    .join('');
}

function buildGpuFieldRegisterCallArgs(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return getRegisterVectorIndices(program)
    .map((vector) => `,\n      registers${REGISTER_VECTOR_LETTERS[vector]}`)
    .join('');
}

function formatWgslFloat(value: number) {
  if (!Number.isFinite(value)) {
    return '0.0';
  }
  const text = value.toString();
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

function buildGpuFieldExpressionWgslSource(
  expression: MilkdropGpuFieldExpression,
  registerInputs: ReadonlySet<string>,
  temporaries: readonly string[] = [],
): string {
  switch (expression.type) {
    case 'literal':
      return formatWgslFloat(expression.value);
    case 'identifier':
      // A program that assigns pi/e turned them into temporaries; reads must
      // reference the declared var, not the inlined constant.
      return temporaries.includes(expression.name)
        ? gpuFieldVarName(expression.name)
        : gpuFieldIdentifierToShaderSource(expression.name, registerInputs);
    case 'unary': {
      const operand = buildGpuFieldExpressionWgslSource(
        expression.operand,
        registerInputs,
        temporaries,
      );
      return (
        EEL_UNARY_OPERATORS[expression.operator]?.wgslField?.(operand) ?? '0.0'
      );
    }
    case 'binary': {
      const left = buildGpuFieldExpressionWgslSource(
        expression.left,
        registerInputs,
        temporaries,
      );
      const right = buildGpuFieldExpressionWgslSource(
        expression.right,
        registerInputs,
        temporaries,
      );
      return (
        EEL_BINARY_OPERATORS[expression.operator]?.wgslField?.(left, right) ??
        `(${left} ${expression.operator} ${right})`
      );
    }
    case 'call': {
      const args = expression.args.map((arg) =>
        buildGpuFieldExpressionWgslSource(arg, registerInputs, temporaries),
      );
      // Every planner-allowlisted call has a wgslField renderer in the shared
      // table; the passthrough fallback is defensive only.
      return (
        emitEelCallWgslField(expression.name, args) ??
        `${expression.name}(${args.join(', ')})`
      );
    }
  }
}

// MilkDrop presets may overwrite pi/e; when the planner turned one into a
// temporary its declaration starts at the mathematical constant (not 0), so
// reads before the first assignment still see the builtin value.
const TEMPORARY_INITIAL_VALUES: Record<string, string> = {
  pi: '3.141592653589793',
  e: '2.718281828459045',
};

function buildGpuFieldTemporaryDeclarations(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return (program?.temporaries ?? [])
    .map(
      (temporary) =>
        `var ${gpuFieldVarName(temporary)}: f32 = ${
          TEMPORARY_INITIAL_VALUES[temporary] ?? '0.0'
        };`,
    )
    .join('\n    ');
}

function buildGpuFieldStatementCode(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const registerInputs = new Set(program?.registerInputs ?? []);
  // Kept as the descriptor's own (tiny, compile-time-fixed) array — the
  // membership checks per identifier are over a handful of names at most.
  const temporaries = program?.temporaries ?? [];
  return (program?.statements ?? [])
    .map(
      (statement) =>
        // milkdropFinite mirrors the CPU JIT's per-statement `_v` clamp:
        // MilkDrop never lets NaN/Infinity escape a statement into state
        // that persists across pixels/frames. Without it, a sqrt/asin/acos
        // domain error poisoned GPU-side state that the CPU tier zeroes.
        `${gpuFieldVarName(statement.target)} = milkdropFinite(${buildGpuFieldExpressionWgslSource(
          statement.expression,
          registerInputs,
          temporaries,
        )});`,
    )
    .join('\n    ');
}

// Field transform parameters are packed like the signals: fieldParamsA =
// (zoom, zoomExponent, rotation, warp), fieldParamsB = (warpAnimSpeed,
// centerX, centerY, scaleX), fieldParamsC = (scaleY, translateX,
// translateY, meshSize).
function buildTransformHeader(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return `fn milkdropTransformPointWithParams(
    source: vec2<f32>,
    fieldParamsA: vec4<f32>,
    fieldParamsB: vec4<f32>,
    fieldParamsC: vec4<f32>,${WGSL_SIGNAL_PARAMETERS}${buildGpuFieldRegisterParamDecls(
      program,
    )}
  ) -> vec2<f32> {
    let paramZoom = fieldParamsA.x;
    let paramZoomExponent = fieldParamsA.y;
    let paramRotation = fieldParamsA.z;
    let paramWarp = fieldParamsA.w;
    let paramWarpAnimSpeed = fieldParamsB.x;
    let paramCenterX = fieldParamsB.y;
    let paramCenterY = fieldParamsB.z;
    let paramScaleX = fieldParamsB.w;
    let paramScaleY = fieldParamsC.x;
    let paramTranslateX = fieldParamsC.y;
    let paramTranslateY = fieldParamsC.z;
    let fieldMeshSizeValue = fieldParamsC.w;
${WGSL_SIGNAL_UNPACK}`;
}

export function buildMilkdropTransformWgslCode(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const header = buildTransformHeader(program);
  if (!program) {
    return `${header}
    let radius = length(source);
    let angle = atan2(source.y, source.x) + paramRotation;
    let transformedX =
      (source.x - paramCenterX) * paramScaleX + paramCenterX + paramTranslateX;
    let transformedY =
      (source.y - paramCenterY) * paramScaleY + paramCenterY + paramTranslateY;
    let ripple = sin(
      radius * 12.0 +
      signalTimeValue * (0.6 + signalTrebleAttValue) * (0.35 + paramWarpAnimSpeed)
    ) * paramWarp * 0.08;
    let radiusNormalized = clamp(radius / 1.41421356237, 0.0, 1.0);
    // Bounded like the CPU path: extreme authored zoom/zoomexp pairs
    // (e.g. orbasonic's 100/100) overflow f32 and NaN the warp otherwise.
    let zoomScale = clamp(pow(
      max(paramZoom, 0.0001),
      pow(max(paramZoomExponent, 0.0001), radiusNormalized * 2.0 - 1.0)
    ), 0.02, 50.0);
    let warped = vec2<f32>(
      (transformedX + cos(angle * 3.0) * ripple) * zoomScale,
      (transformedY + sin(angle * 4.0) * ripple) * zoomScale
    );
    let cosRot = cos(paramRotation);
    let sinRot = sin(paramRotation);
    return vec2<f32>(
      warped.x * cosRot - warped.y * sinRot,
      warped.x * sinRot + warped.y * cosRot
    );
  }`;
  }

  return `${header}
    // Present x/y/rad/ang to the preset's per-pixel program in MilkDrop
    // [0,1] y-down aspect-weighted space, matching the CPU mesh path
    // (geometry-builder.ts transformMeshPoint) instead of raw renderer
    // [-1,1] y-up clip space.
    let fieldAspectX = select(1.0, signalAspectValue, signalAspectValue < 1.0);
    let fieldAspectY = select(1.0, 1.0 / signalAspectValue, signalAspectValue > 1.0);
    var field_x = source.x * 0.5 * fieldAspectX + 0.5;
    var field_y = -source.y * 0.5 * fieldAspectY + 0.5;
    var field_rad = length(vec2<f32>(source.x * fieldAspectX, source.y * fieldAspectY));
    var field_ang = atan2(source.y * fieldAspectY, source.x * fieldAspectX);
    var fieldZoom = paramZoom;
    var fieldZoomExponent = paramZoomExponent;
    var fieldRotation = paramRotation;
    var fieldWarp = paramWarp;
    var fieldWarpScale = paramWarpAnimSpeed;
    var fieldCenterX = milkdropDenormalizeTransformCenterX(paramCenterX);
    var fieldCenterY = milkdropDenormalizeTransformCenterY(paramCenterY);
    var fieldScaleX = paramScaleX;
    var fieldScaleY = paramScaleY;
    var fieldTranslateX = paramTranslateX * 0.5;
    var fieldTranslateY = paramTranslateY * 0.5;
    ${buildGpuFieldRegisterBindings(program)}
    ${buildGpuFieldTemporaryDeclarations(program)}
    ${buildGpuFieldStatementCode(program)}

    // Invert back to renderer space now that the preset program has had its
    // chance to read/write x and y (mirrors the CPU path's rendererX/rendererY).
    let rendererFieldX = (field_x - 0.5) * 2.0 / fieldAspectX;
    let rendererFieldY = -((field_y - 0.5) * 2.0 / fieldAspectY);
    let normalizedCenterX = milkdropNormalizeTransformCenterX(fieldCenterX);
    let normalizedCenterY = milkdropNormalizeTransformCenterY(fieldCenterY);
    let angle = field_ang + fieldRotation;
    let translatedX =
      (rendererFieldX - normalizedCenterX) * fieldScaleX +
      normalizedCenterX +
      fieldTranslateX * 2.0;
    let translatedY =
      (rendererFieldY - normalizedCenterY) * fieldScaleY +
      normalizedCenterY +
      fieldTranslateY * 2.0;
    let ripple = sin(
      field_rad * 12.0 +
      signalTimeValue * (0.6 + signalTrebleAttValue) * (0.35 + fieldWarpScale)
    ) * fieldWarp * 0.08;
    let radiusNormalized = clamp(field_rad / 1.41421356237, 0.0, 1.0);
    let zoomScale = clamp(pow(
      max(fieldZoom, 0.0001),
      pow(max(fieldZoomExponent, 0.0001), radiusNormalized * 2.0 - 1.0)
    ), 0.02, 50.0);
    let px = (translatedX + cos(angle * 3.0) * ripple) * zoomScale;
    let py = (translatedY + sin(angle * 4.0) * ripple) * zoomScale;
    let cosRot = cos(fieldRotation);
    let sinRot = sin(fieldRotation);
    return vec2<f32>(
      px * cosRot - py * sinRot,
      px * sinRot + py * cosRot
    );
  }`;
}

const WGSL_APPLY_INTERACTION = `
    let scaled = point * interactionTransform.w;
    let cosRotInteraction = cos(interactionTransform.z);
    let sinRotInteraction = sin(interactionTransform.z);
    let interacted = vec2<f32>(
      scaled.x * cosRotInteraction - scaled.y * sinRotInteraction + interactionTransform.x,
      scaled.x * sinRotInteraction + scaled.y * cosRotInteraction + interactionTransform.y
    );
`;

const transformIncludeCache = new Map<string, unknown>();

function getTransformInclude(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const key = program?.signature ?? 'default';
  let include = transformIncludeCache.get(key);
  if (!include) {
    include = wgsl(buildMilkdropTransformWgslCode(program));
    transformIncludeCache.set(key, include);
  }
  return include;
}

function toUniformNodes<T extends Record<string, { value: unknown }>>(
  state: T,
): TslUniformNodes<T> {
  const nodes: Record<string, TslNode> = {};
  for (const [key, entry] of Object.entries(state)) {
    nodes[key] = uniform(entry.value);
  }
  return nodes as TslUniformNodes<T>;
}

function packSignalUniformVectors(
  uniforms: Record<string, TslNode>,
  prefix: 'signal' | 'previousSignal',
) {
  const get = (name: string) => uniforms[`${prefix}${name}`];
  return {
    a: vec4(get('Time'), get('Frame'), get('Fps'), get('Aspect')),
    b: vec4(get('Bass'), get('Mid'), get('Mids'), get('Treble')),
    c: vec4(get('BassAtt'), get('MidAtt'), get('MidsAtt'), get('TrebleAtt')),
    d: vec4(get('Beat'), get('BeatPulse'), get('Rms'), get('Vol')),
    e: vec4(
      get('Music'),
      get('WeightedEnergy'),
      get('PixelsX'),
      get('PixelsY'),
    ),
  };
}

function packFieldParamVectors(uniforms: Record<string, TslNode>, prefix = '') {
  const get = (name: string) =>
    uniforms[
      prefix === ''
        ? name
        : `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`
    ];
  return {
    a: vec4(get('zoom'), get('zoomExponent'), get('rotation'), get('warp')),
    b: vec4(
      get('warpAnimSpeed'),
      get('centerX'),
      get('centerY'),
      get('scaleX'),
    ),
    c: vec4(
      get('scaleY'),
      get('translateX'),
      get('translateY'),
      get('meshSize'),
    ),
  };
}

/** TSL-side mirror of buildGpuFieldRegisterParamDecls: packs the register
 * uniforms into the vec4 arguments the generated WGSL declares, one entry per
 * register vector the program reads. */
function packRegisterVectorArgs(
  uniforms: Record<string, TslNode>,
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const args: Record<string, TslNode> = {};
  for (const vector of getRegisterVectorIndices(program)) {
    const base = vector * 4;
    args[`registers${REGISTER_VECTOR_LETTERS[vector]}`] = vec4(
      uniforms[`registerSlot${base}`],
      uniforms[`registerSlot${base + 1}`],
      uniforms[`registerSlot${base + 2}`],
      uniforms[`registerSlot${base + 3}`],
    ) as TslNode;
  }
  return args;
}

function packInteractionVector(uniforms: Record<string, TslNode>) {
  return vec4(
    uniforms.interactionOffsetX,
    uniforms.interactionOffsetY,
    uniforms.interactionRotation,
    uniforms.interactionScale,
  );
}

function buildProceduralMeshVertexFnWgsl(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return `
  fn computeProceduralMeshVertex(
    sourcePosition: vec3<f32>,
    fieldParamsA: vec4<f32>,
    fieldParamsB: vec4<f32>,
    fieldParamsC: vec4<f32>,${WGSL_SIGNAL_PARAMETERS}${buildGpuFieldRegisterParamDecls(
      program,
    )},
    interactionTransform: vec4<f32>
  ) -> vec3<f32> {
    let point = milkdropTransformPointWithParams(
      sourcePosition.xy,
      fieldParamsA,
      fieldParamsB,
      fieldParamsC,
      signalsA,
      signalsB,
      signalsC,
      signalsD,
      signalsE${buildGpuFieldRegisterCallArgs(program)}
    );
${WGSL_APPLY_INTERACTION}
    return vec3<f32>(
      interacted.x,
      interacted.y,
      clamp(sourcePosition.z, ${MILKDROP_WAVE_Z.toFixed(2)}, ${MILKDROP_CUSTOM_WAVE_Z.toFixed(2)})
    );
  }
`;
}

const meshVertexFnCache = new Map<string, TslVertexFn>();

function getProceduralMeshVertexFn(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const key = program?.signature ?? 'default';
  const cached = meshVertexFnCache.get(key);
  if (cached) {
    return cached;
  }
  const fn = wgslFn(buildProceduralMeshVertexFnWgsl(program), [
    MILKDROP_FIELD_WGSL_HELPERS,
    getTransformInclude(program),
  ]) as TslVertexFn;
  meshVertexFnCache.set(key, fn);
  return fn;
}

export function createProceduralMeshMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const uniforms = toUniformNodes({
    ...createProceduralFieldUniformState(),
    ...createProceduralInteractionUniformState(),
  });
  const signals = packSignalUniformVectors(uniforms, 'signal');
  const fieldParams = packFieldParamVectors(uniforms);
  const vertex = getProceduralMeshVertexFn(program)({
    sourcePosition: attribute('sourcePosition', 'vec3'),
    fieldParamsA: fieldParams.a,
    fieldParamsB: fieldParams.b,
    fieldParamsC: fieldParams.c,
    signalsA: signals.a,
    signalsB: signals.b,
    signalsC: signals.c,
    signalsD: signals.d,
    signalsE: signals.e,
    ...packRegisterVectorArgs(uniforms, program),
    interactionTransform: packInteractionVector(uniforms),
  });

  const material = new NodeMaterial();
  material.transparent = true;
  material.userData.fieldProgramSignature = program?.signature ?? 'default';
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(vertex, 1.0));
  material.colorNode = vec4(
    uniforms.tint,
    uniforms.alpha.mul(uniforms.interactionAlpha),
  );

  return Object.assign(material, { uniforms });
}

// Returns vec4(x, y, alpha, z): the transformed endpoint, its fade alpha,
// and the depth the caller feeds into gl_Position.
function buildProceduralMotionVectorVertexFnWgsl(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  return `
  fn computeProceduralMotionVectorVertex(
    sourcePosition: vec3<f32>,
    endpointWeight: f32,
    fieldParamsA: vec4<f32>,
    fieldParamsB: vec4<f32>,
    fieldParamsC: vec4<f32>,${WGSL_SIGNAL_PARAMETERS}${buildGpuFieldRegisterParamDecls(
      program,
    )},
    previousFieldParamsA: vec4<f32>,
    previousFieldParamsB: vec4<f32>,
    previousFieldParamsC: vec4<f32>,
    previousSignalsA: vec4<f32>,
    previousSignalsB: vec4<f32>,
    previousSignalsC: vec4<f32>,
    previousSignalsD: vec4<f32>,
    previousSignalsE: vec4<f32>,
    offsets: vec4<f32>,
    lengthBlendAlpha: vec4<f32>,
    interactionTransform: vec4<f32>
  ) -> vec4<f32> {
    let blendMix = lengthBlendAlpha.z;
    let currentSource = clamp(
      sourcePosition.xy + offsets.xy,
      vec2<f32>(-1.0),
      vec2<f32>(1.0)
    );
    let previousSource = clamp(
      sourcePosition.xy + offsets.zw,
      vec2<f32>(-1.0),
      vec2<f32>(1.0)
    );
    let current = milkdropTransformPointWithParams(
      currentSource,
      fieldParamsA,
      fieldParamsB,
      fieldParamsC,
      signalsA,
      signalsB,
      signalsC,
      signalsD,
      signalsE${buildGpuFieldRegisterCallArgs(program)}
    );
    let previous = milkdropTransformPointWithParams(
      previousSource,
      previousFieldParamsA,
      previousFieldParamsB,
      previousFieldParamsC,
      previousSignalsA,
      previousSignalsB,
      previousSignalsC,
      previousSignalsD,
      previousSignalsE${buildGpuFieldRegisterCallArgs(program)}
    );
    let blendedCurrent = mix(previous, current, blendMix);
    let blendedSource = mix(previousSource, currentSource, blendMix);
    var delta = clamp(
      (blendedCurrent - blendedSource) * 1.35,
      vec2<f32>(-0.24),
      vec2<f32>(0.24)
    );
    let explicitLengthMixed = mix(
      lengthBlendAlpha.y,
      lengthBlendAlpha.x,
      blendMix
    );
    var magnitude = length(delta);
    if (explicitLengthMixed > 0.0001 && magnitude > 0.0001) {
      delta = delta / magnitude * explicitLengthMixed;
      magnitude = length(delta);
    }
    let point = mix(
      blendedCurrent - delta * 0.45,
      blendedCurrent + delta,
      vec2<f32>(endpointWeight)
    );
${WGSL_APPLY_INTERACTION}
    let alpha =
      lengthBlendAlpha.w *
      clamp(0.75 + magnitude * 2.2, 0.0, 1.0) *
      step(0.002, magnitude);
    return vec4<f32>(
      interacted.x,
      interacted.y,
      alpha,
      clamp(sourcePosition.z, ${MILKDROP_WAVE_Z.toFixed(2)}, ${MILKDROP_CUSTOM_WAVE_Z.toFixed(2)})
    );
  }
`;
}

const motionVectorVertexFnCache = new Map<string, TslVertexFn>();

function getProceduralMotionVectorVertexFn(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const key = program?.signature ?? 'default';
  const cached = motionVectorVertexFnCache.get(key);
  if (cached) {
    return cached;
  }
  const fn = wgslFn(buildProceduralMotionVectorVertexFnWgsl(program), [
    MILKDROP_FIELD_WGSL_HELPERS,
    getTransformInclude(program),
  ]) as TslVertexFn;
  motionVectorVertexFnCache.set(key, fn);
  return fn;
}

function createMotionVectorUniformState() {
  return {
    ...createProceduralFieldUniformState(),
    ...createProceduralInteractionUniformState(),
    sourceOffsetX: { value: 0 },
    sourceOffsetY: { value: 0 },
    explicitLength: { value: 0 },
    legacyControls: { value: 0 },
    previousZoom: { value: 1 },
    previousZoomExponent: { value: 1 },
    previousRotation: { value: 0 },
    previousWarp: { value: 0 },
    previousWarpAnimSpeed: { value: 1 },
    previousCenterX: { value: 0 },
    previousCenterY: { value: 0 },
    previousScaleX: { value: 1 },
    previousScaleY: { value: 1 },
    previousTranslateX: { value: 0 },
    previousTranslateY: { value: 0 },
    previousSourceOffsetX: { value: 0 },
    previousSourceOffsetY: { value: 0 },
    previousExplicitLength: { value: 0 },
    blendMix: { value: 1 },
    previousSignalTime: { value: 0 },
    previousSignalFrame: { value: 0 },
    previousSignalFps: { value: 60 },
    previousSignalAspect: { value: 1 },
    previousSignalBass: { value: 0 },
    previousSignalMid: { value: 0 },
    previousSignalMids: { value: 0 },
    previousSignalTreble: { value: 0 },
    previousSignalBassAtt: { value: 0 },
    previousSignalMidAtt: { value: 0 },
    previousSignalMidsAtt: { value: 0 },
    previousSignalTrebleAtt: { value: 0 },
    previousSignalBeat: { value: 0 },
    previousSignalBeatPulse: { value: 0 },
    previousSignalRms: { value: 0 },
    previousSignalVol: { value: 0 },
    previousSignalMusic: { value: 0 },
    previousSignalWeightedEnergy: { value: 0 },
    previousSignalPixelsX: { value: 1280 },
    previousSignalPixelsY: { value: 1280 },
    previousMeshSize: { value: 48 },
  };
}

export function createProceduralMotionVectorMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const uniforms = toUniformNodes(createMotionVectorUniformState());
  const signals = packSignalUniformVectors(uniforms, 'signal');
  const previousSignals = packSignalUniformVectors(uniforms, 'previousSignal');
  const fieldParams = packFieldParamVectors(uniforms);
  const previousFieldParams = packFieldParamVectors(uniforms, 'previous');
  const result = varying(
    getProceduralMotionVectorVertexFn(program)({
      sourcePosition: attribute('sourcePosition', 'vec3'),
      endpointWeight: attribute('endpointWeight', 'float'),
      fieldParamsA: fieldParams.a,
      fieldParamsB: fieldParams.b,
      fieldParamsC: fieldParams.c,
      signalsA: signals.a,
      signalsB: signals.b,
      signalsC: signals.c,
      signalsD: signals.d,
      signalsE: signals.e,
      previousFieldParamsA: previousFieldParams.a,
      previousFieldParamsB: previousFieldParams.b,
      previousFieldParamsC: previousFieldParams.c,
      previousSignalsA: previousSignals.a,
      previousSignalsB: previousSignals.b,
      previousSignalsC: previousSignals.c,
      previousSignalsD: previousSignals.d,
      previousSignalsE: previousSignals.e,
      ...packRegisterVectorArgs(uniforms, program),
      offsets: vec4(
        uniforms.sourceOffsetX,
        uniforms.sourceOffsetY,
        uniforms.previousSourceOffsetX,
        uniforms.previousSourceOffsetY,
      ),
      lengthBlendAlpha: vec4(
        uniforms.explicitLength,
        uniforms.previousExplicitLength,
        uniforms.blendMix,
        uniforms.alpha.mul(uniforms.interactionAlpha),
      ),
      interactionTransform: packInteractionVector(uniforms),
    }),
  ) as TslNode;

  const material = new NodeMaterial();
  material.transparent = true;
  material.userData.fieldProgramSignature = program?.signature ?? 'default';
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(result.x, result.y, result.w, 1.0));
  material.colorNode = Fn(() => {
    Discard(result.z.lessThanEqual(0.0));
    return vec4(uniforms.tint, result.z);
  })();

  return Object.assign(material, { uniforms });
}

function buildCustomWaveProgramWgslCode(
  program: MilkdropGpuFieldProgramDescriptor,
) {
  return `fn milkdropCustomWavePointWithProgram(
    sampleTValue: f32,
    sampleValue1: f32,
    sampleValue2: f32,
    paramCenterX: f32,
    paramCenterY: f32,
    paramScaling: f32,
    paramMystery: f32,
    paramSpectrum: f32,
    paramSamples: f32,${WGSL_SIGNAL_PARAMETERS}
  ) -> vec2<f32> {
${WGSL_SIGNAL_UNPACK}
    var field_sample = sampleTValue;
    var field_value = sampleValue1;
    var field_value1 = sampleValue1;
    var field_value2 = sampleValue2;
    var field_samples = paramSamples;
    var field_spectrum = paramSpectrum;
    var field_scaling = paramScaling;
    var field_mystery = paramMystery;
    let baseY =
      paramCenterY +
      (sampleValue1 - 0.5) * 0.55 * paramScaling * (1.0 + paramMystery * 0.25);
    let orbitalY =
      paramCenterY +
      sin(
        sampleTValue * 3.141592653589793 * 2.0 * (1.0 + paramMystery) +
          signalTimeValue
      ) *
        0.18 *
        paramScaling;
    let rendererPointX = paramCenterX + (-1.0 + sampleTValue * 2.0);
    let rendererPointY = mix(orbitalY, baseY, paramSpectrum);
    // Per-point code reads/writes x,y in MilkDrop [0,1] space (y-down),
    // matching the CPU wave-builder path; rad/ang measure distance from
    // screen center in renderer (zero-centered) space.
    var field_x = rendererPointX / 2.0 + 0.5;
    var field_y = 0.5 - rendererPointY / 2.0;
    var field_rad = length(vec2<f32>(rendererPointX, rendererPointY));
    var field_ang = atan2(rendererPointY, rendererPointX);
    ${buildGpuFieldTemporaryDeclarations(program)}
    ${buildGpuFieldStatementCode(program)}
    return vec2<f32>((field_x - 0.5) * 2.0, (0.5 - field_y) * 2.0);
  }`;
}

function buildCustomWaveVertexWgslCode(hasProgram: boolean) {
  const pointCode = hasProgram
    ? `point = milkdropCustomWavePointWithProgram(
      sampleT,
      blendedSampleValue,
      blendedSampleValue2,
      blendedCenterX,
      blendedCenterY,
      blendedScaling,
      blendedMystery,
      blendedSpectrum,
      blendedSampleCount,
      blendedSignalsA,
      blendedSignalsB,
      blendedSignalsC,
      blendedSignalsD,
      blendedSignalsE
    );`
    : `let x = blendedCenterX + (-1.0 + sampleT * 2.0);
    let baseY =
      blendedCenterY +
      (blendedSampleValue - 0.5) *
        0.55 *
        blendedScaling *
        (1.0 + blendedMystery * 0.25);
    let orbitalY =
      blendedCenterY +
      sin(
        sampleT * 3.141592653589793 * 2.0 * (1.0 + blendedMystery) +
          blendedSignalTime
      ) *
        0.18 *
        blendedScaling;
    point = vec2<f32>(x, mix(orbitalY, baseY, blendedSpectrum));`;

  return `fn computeProceduralCustomWaveVertex(
    sampleT: f32,
    sampleValue: f32,
    sampleValue2: f32,
    previousSampleValue: f32,
    previousSampleValue2: f32,
    waveParams: vec4<f32>,
    previousWaveParams: vec4<f32>,
    waveExtras: vec4<f32>,
    previousWaveExtras: vec4<f32>,${WGSL_SIGNAL_PARAMETERS},
    previousSignalsA: vec4<f32>,
    previousSignalsB: vec4<f32>,
    previousSignalsC: vec4<f32>,
    previousSignalsD: vec4<f32>,
    previousSignalsE: vec4<f32>,
    interactionTransform: vec4<f32>
  ) -> vec2<f32> {
    let blendMix = waveExtras.z;
    let blendedSampleValue = mix(previousSampleValue, sampleValue, blendMix);
    let blendedSampleValue2 = mix(previousSampleValue2, sampleValue2, blendMix);
    let blendedParams = mix(previousWaveParams, waveParams, blendMix);
    let blendedCenterX = blendedParams.x;
    let blendedCenterY = blendedParams.y;
    let blendedScaling = blendedParams.z;
    let blendedMystery = blendedParams.w;
    let blendedSpectrum = mix(previousWaveExtras.x, waveExtras.x, blendMix);
    let blendedSampleCount = mix(previousWaveExtras.y, waveExtras.y, blendMix);
    let blendedSignalsA = mix(previousSignalsA, signalsA, blendMix);
    let blendedSignalsB = mix(previousSignalsB, signalsB, blendMix);
    let blendedSignalsC = mix(previousSignalsC, signalsC, blendMix);
    let blendedSignalsD = mix(previousSignalsD, signalsD, blendMix);
    let blendedSignalsE = mix(previousSignalsE, signalsE, blendMix);
    let blendedSignalTime = blendedSignalsA.x;
    var point = vec2<f32>(0.0, 0.0);
    ${pointCode}
${WGSL_APPLY_INTERACTION}
    return interacted;
  }`;
}

const customWaveVertexFnCache = new Map<string, TslVertexFn>();

function getProceduralCustomWaveVertexFn(
  program: MilkdropGpuFieldProgramDescriptor | null | undefined,
) {
  const key = program?.signature ?? 'default';
  const cached = customWaveVertexFnCache.get(key);
  if (cached) {
    return cached;
  }
  const includes: unknown[] = [MILKDROP_FIELD_WGSL_HELPERS];
  if (program) {
    includes.push(wgsl(buildCustomWaveProgramWgslCode(program)));
  }
  const fn = wgslFn(
    buildCustomWaveVertexWgslCode(Boolean(program)),
    includes,
  ) as TslVertexFn;
  customWaveVertexFnCache.set(key, fn);
  return fn;
}

function createCustomWaveUniformState() {
  return {
    centerX: { value: 0 },
    centerY: { value: 0 },
    scaling: { value: 1 },
    mystery: { value: 0 },
    signalTime: { value: 0 },
    signalFrame: { value: 0 },
    signalFps: { value: 60 },
    signalAspect: { value: 1 },
    signalBass: { value: 0 },
    signalMid: { value: 0 },
    signalMids: { value: 0 },
    signalTreble: { value: 0 },
    signalBassAtt: { value: 0 },
    signalMidAtt: { value: 0 },
    signalMidsAtt: { value: 0 },
    signalTrebleAtt: { value: 0 },
    signalBeat: { value: 0 },
    signalBeatPulse: { value: 0 },
    signalRms: { value: 0 },
    signalVol: { value: 0 },
    signalMusic: { value: 0 },
    signalWeightedEnergy: { value: 0 },
    spectrum: { value: 0 },
    sampleCount: { value: 64 },
    tint: { value: new Color(1, 1, 1) },
    alpha: { value: 1 },
    previousCenterX: { value: 0 },
    previousCenterY: { value: 0 },
    previousScaling: { value: 1 },
    previousMystery: { value: 0 },
    previousSignalTime: { value: 0 },
    previousSignalFrame: { value: 0 },
    previousSignalFps: { value: 60 },
    previousSignalAspect: { value: 1 },
    previousSignalBass: { value: 0 },
    previousSignalMid: { value: 0 },
    previousSignalMids: { value: 0 },
    previousSignalTreble: { value: 0 },
    previousSignalBassAtt: { value: 0 },
    previousSignalMidAtt: { value: 0 },
    previousSignalMidsAtt: { value: 0 },
    previousSignalTrebleAtt: { value: 0 },
    previousSignalBeat: { value: 0 },
    previousSignalBeatPulse: { value: 0 },
    previousSignalRms: { value: 0 },
    previousSignalVol: { value: 0 },
    previousSignalMusic: { value: 0 },
    previousSignalWeightedEnergy: { value: 0 },
    previousSpectrum: { value: 0 },
    previousSampleCount: { value: 64 },
    blendMix: { value: 1 },
    ...createProceduralInteractionUniformState(),
  };
}

export function createProceduralCustomWaveMaterial(
  program?: MilkdropGpuFieldProgramDescriptor | null,
) {
  const uniforms = toUniformNodes(createCustomWaveUniformState());
  const signals = packSignalUniformVectors(uniforms, 'signal');
  const previousSignals = packSignalUniformVectors(uniforms, 'previousSignal');
  const point = getProceduralCustomWaveVertexFn(program)({
    sampleT: attribute('sampleT', 'float'),
    sampleValue: attribute('sampleValue', 'float'),
    sampleValue2: attribute('sampleValue2', 'float'),
    previousSampleValue: attribute('previousSampleValue', 'float'),
    previousSampleValue2: attribute('previousSampleValue2', 'float'),
    waveParams: vec4(
      uniforms.centerX,
      uniforms.centerY,
      uniforms.scaling,
      uniforms.mystery,
    ),
    previousWaveParams: vec4(
      uniforms.previousCenterX,
      uniforms.previousCenterY,
      uniforms.previousScaling,
      uniforms.previousMystery,
    ),
    waveExtras: vec4(
      uniforms.spectrum,
      uniforms.sampleCount,
      uniforms.blendMix,
      0,
    ),
    previousWaveExtras: vec4(
      uniforms.previousSpectrum,
      uniforms.previousSampleCount,
      0,
      0,
    ),
    signalsA: signals.a,
    signalsB: signals.b,
    signalsC: signals.c,
    signalsD: signals.d,
    signalsE: signals.e,
    previousSignalsA: previousSignals.a,
    previousSignalsB: previousSignals.b,
    previousSignalsC: previousSignals.c,
    previousSignalsD: previousSignals.d,
    previousSignalsE: previousSignals.e,
    interactionTransform: packInteractionVector(uniforms),
  });

  const material = new NodeMaterial();
  material.transparent = true;
  material.userData.fieldProgramSignature = program?.signature ?? 'default';
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(point.x, point.y, 0.28, 1.0));
  material.colorNode = vec4(
    uniforms.tint,
    uniforms.alpha.mul(uniforms.interactionAlpha),
  );

  return Object.assign(material, { uniforms });
}

// Same math as the legacy milkdropWavePoint() + applyMilkdropInteraction()
// GLSL functions, merged into one function and with the per-frame
// blending inlined, so it can be wrapped once via wgslFn(). `mode` and every
// other value read from a `uniform`/`varying` in the original shader becomes
// an explicit parameter here, since a wgslFn body only sees what's passed
// in.
// WebGPU's baseline maxVertexBuffers limit is 8. The 12 scalar attributes
// this shader needs (sample + previous-sample, each with value/offset32/
// offset64/offset96, plus parity/velocity/previousVelocity) would each
// claim a separate vertex buffer as individual attribute() nodes, so they
// are packed into two vec4s and one vec3 on the geometry side instead
// (see packProceduralWaveVertexAttributes in procedural-wave-renderer.ts)
// and unpacked here by component.
const PROCEDURAL_WAVE_POINT_WGSL = `
  fn computeProceduralWavePoint(
    mode: f32,
    t: f32,
    sampleData: vec4<f32>,
    previousSampleData: vec4<f32>,
    sampleMisc: vec3<f32>,
    centerX: f32,
    centerY: f32,
    scale: f32,
    mystery: f32,
    signalTime: f32,
    beatPulse: f32,
    trebleAtt: f32,
    previousCenterX: f32,
    previousCenterY: f32,
    previousScale: f32,
    previousMystery: f32,
    previousSignalTime: f32,
    previousBeatPulse: f32,
    previousTrebleAtt: f32,
    blendMix: f32,
    interactionOffsetX: f32,
    interactionOffsetY: f32,
    interactionRotation: f32,
    interactionScale: f32
  ) -> vec2<f32> {
    let blendedSample = mix(previousSampleData, sampleData, blendMix);
    let blendedSampleValue = blendedSample.x;
    let blendedSampleOffset32 = blendedSample.y;
    let blendedSampleOffset64 = blendedSample.z;
    let blendedSampleOffset96 = blendedSample.w;
    let parity = sampleMisc.x;

    let pointCenterX = mix(previousCenterX, centerX, blendMix);
    let pointCenterY = mix(previousCenterY, centerY, blendMix);
    let pointScale = mix(previousScale, scale, blendMix);
    let pointMystery = mix(previousMystery, mystery, blendMix);
    let pointSignalTime = mix(previousSignalTime, signalTime, blendMix);
    let pointBeatPulse = mix(previousBeatPulse, beatPulse, blendMix);
    let pointTrebleAtt = mix(previousTrebleAtt, trebleAtt, blendMix);

    // sampleValue is in [-1, 1] (from sampleByteData: ((data[i] - 128) / 128)).
    // Do NOT recenter with sampleValue - 0.5.
    var x: f32 = 0.0;
    var y: f32 = 0.0;

    if (mode < 0.5) {
      // Circle — matches CPU path (frame-generation.ts mode 0).
      let angle = t * 6.28318 + pointSignalTime * 0.2;
      let radius = 0.5 + 0.4 * blendedSampleValue * pointScale + pointMystery;
      x = pointCenterX + cos(angle) * radius;
      y = pointCenterY + sin(angle) * radius;
    } else if (mode < 1.5) {
      // XYOscillationSpiral — matches CPU path (frame-generation.ts mode 1).
      let sampleR = blendedSampleValue;
      let sampleL = blendedSampleOffset32;
      let radius = 0.53 + 0.43 * sampleR * pointScale + pointMystery;
      let angle = sampleL * pointScale * 1.5708 + pointSignalTime * 2.3;
      x = pointCenterX + cos(angle) * radius;
      y = pointCenterY + sin(angle) * radius;
    } else if (mode < 2.5) {
      x = pointCenterX + blendedSampleValue * pointScale;
      y = pointCenterY + blendedSampleOffset32 * pointScale;
    } else if (mode < 3.5) {
      x = pointCenterX + blendedSampleValue * pointScale;
      y = pointCenterY + blendedSampleOffset32 * pointScale;
    } else if (mode < 4.5) {
      // DerivativeLine (HORIZONTAL) — matches CPU path (frame-generation.ts mode 4).
      let w1 = 0.45 + 0.5 * (pointMystery * 0.5 + 0.5);
      let w2 = 1.0 - w1;
      x = -1.0 + 2.0 * t + pointCenterX + blendedSampleOffset32 * 0.44 * pointScale;
      y = pointCenterY + blendedSampleValue * 0.47 * pointScale;
      // Intra-frame momentum (simplified for GPU).
      x = x * w2 + w1 * blendedSampleOffset64 * pointScale;
      y = y * w2 + w1 * blendedSampleOffset96 * pointScale;
    } else if (mode < 5.5) {
      // ExplosiveHash — mono collapse of MilkDrop's
      // x0 = R[i]*L[i+32] + L[i]*R[i+32], y0 = R[i]^2 - L[i+32]^2,
      // with fWaveScale applied to each factor (pointScale squared).
      let scale2 = pointScale * pointScale;
      let x0 = 2.0 * blendedSampleValue * blendedSampleOffset32 * scale2;
      let y0 = (blendedSampleValue * blendedSampleValue - blendedSampleOffset32 * blendedSampleOffset32) * scale2;
      let rot = pointSignalTime * 0.3;
      let cosR = cos(rot);
      let sinR = sin(rot);
      x = pointCenterX + (x0 * cosR - y0 * sinR);
      y = pointCenterY + (x0 * sinR + y0 * cosR);
    } else if (mode < 6.5) {
      // Line — matches CPU path (frame-generation.ts mode 6).
      x = -1.0 + 2.0 * t;
      y = pointCenterY + blendedSampleValue * 0.25 * pointScale;
    } else {
      let separation = 0.1 + pointMystery * 0.2;
      x = -1.0 + 2.0 * t;
      // select(falseValue, trueValue, condition) — WGSL has no ?: operator.
      y = pointCenterY + select(
        blendedSampleOffset32 * pointScale * 0.25 - separation,
        blendedSampleValue * pointScale * 0.25 + separation,
        parity < 0.5
      );
    }

    let point = vec2<f32>(x, y);

    // applyMilkdropInteraction, inlined.
    let scaled = point * interactionScale;
    let cosRot = cos(interactionRotation);
    let sinRot = sin(interactionRotation);
    return vec2<f32>(
      scaled.x * cosRot - scaled.y * sinRot + interactionOffsetX,
      scaled.x * sinRot + scaled.y * cosRot + interactionOffsetY
    );
  }
`;

const computeProceduralWavePoint = wgslFn(PROCEDURAL_WAVE_POINT_WGSL);

export function createProceduralWaveMaterial() {
  const uniforms = {
    mode: uniform(0),
    centerX: uniform(0),
    centerY: uniform(0),
    scale: uniform(0.34),
    mystery: uniform(0),
    signalTime: uniform(0),
    beatPulse: uniform(0),
    trebleAtt: uniform(0),
    tint: uniform(new Color(1, 1, 1)),
    alpha: uniform(1),
    previousCenterX: uniform(0),
    previousCenterY: uniform(0),
    previousScale: uniform(0.34),
    previousMystery: uniform(0),
    previousSignalTime: uniform(0),
    previousBeatPulse: uniform(0),
    previousTrebleAtt: uniform(0),
    blendMix: uniform(1),
    interactionOffsetX: uniform(0),
    interactionOffsetY: uniform(0),
    interactionRotation: uniform(0),
    interactionScale: uniform(1),
    interactionAlpha: uniform(1),
  };

  const point = computeProceduralWavePoint({
    mode: uniforms.mode,
    t: attribute('sampleT', 'float'),
    sampleData: attribute('sampleData', 'vec4'),
    previousSampleData: attribute('previousSampleData', 'vec4'),
    sampleMisc: attribute('sampleMisc', 'vec3'),
    centerX: uniforms.centerX,
    centerY: uniforms.centerY,
    scale: uniforms.scale,
    mystery: uniforms.mystery,
    signalTime: uniforms.signalTime,
    beatPulse: uniforms.beatPulse,
    trebleAtt: uniforms.trebleAtt,
    previousCenterX: uniforms.previousCenterX,
    previousCenterY: uniforms.previousCenterY,
    previousScale: uniforms.previousScale,
    previousMystery: uniforms.previousMystery,
    previousSignalTime: uniforms.previousSignalTime,
    previousBeatPulse: uniforms.previousBeatPulse,
    previousTrebleAtt: uniforms.previousTrebleAtt,
    blendMix: uniforms.blendMix,
    interactionOffsetX: uniforms.interactionOffsetX,
    interactionOffsetY: uniforms.interactionOffsetY,
    interactionRotation: uniforms.interactionRotation,
    interactionScale: uniforms.interactionScale,
  });

  const material = new NodeMaterial();
  material.transparent = true;
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(point.x, point.y, 0.24, 1.0));
  material.colorNode = vec4(
    uniforms.tint,
    uniforms.alpha.mul(uniforms.interactionAlpha),
  );

  return Object.assign(material, { uniforms });
}

// Register the WebGPU material toolkit for the shared renderer helpers
// (shape/mesh/particle-field/procedural-wave/motion-vector renderers). They
// run on both backends and must not import 'three/webgpu' statically — that
// would drag the WebGPU three.js bundle into the boot path of WebGL-only
// browsers — so this module (which is only reachable through the lazily
// loaded WebGPU adapter graph) hands them NodeMaterial/TSL and the
// procedural factories at module scope. See
// renderer-helpers/webgpu-materials-loader.ts.
registerWebGpuHelperMaterials({
  NodeMaterial,
  TSL,
  createProceduralMeshMaterial,
  createProceduralMotionVectorMaterial,
  createProceduralWaveMaterial,
  createProceduralCustomWaveMaterial,
});
