/**
 * The single declarative table of EEL operators and functions.
 *
 * Four expression backends execute or emit MilkDrop EEL: the CPU interpreter
 * (expression.ts), the CPU JIT (expression-jit.ts), the compute-VM WGSL
 * generator (compiler/wgsl-generator.ts), and the per-pixel field-program
 * WGSL emitter (renderer-backends/webgpu-procedural-materials.ts). Each used
 * to carry its own switch over the same names, and the switches drifted —
 * the tier-differential fuzzers exist because of it. This module replaces the
 * four switches with one entry per name: declared arity/defaults plus one
 * renderer per backend, so adding or fixing a function lands in one place.
 *
 * The GPU field planner's allowlist (which calls may lower to the per-pixel
 * GPU path) is derived from this table too: a function is field-lowerable
 * exactly when its entry has a `wgslField` renderer.
 *
 * The reference semantics are the interpreter's, pinned by
 * tests/unit/eel-conformance-spec.test.ts; the JIT and both WGSL dialects
 * must match it (tests/unit/eel-tier-differential.test.ts,
 * gpu-field-tier-differential.test.ts). The two WGSL dialects stay separate
 * renderers on purpose — the compute VM emits `f`-suffixed literals and
 * inline `select`s against `state.`/`signals.` bindings, while the field
 * emitter leans on the shared scalar helpers (wgsl-eel-helpers.ts) — but
 * both are rows of the same entry now, so a semantics change is visibly a
 * change to every backend at once.
 *
 * The HLSL/GLSL shader-dialect emitters (shader-analysis-glsl.ts and
 * friends) translate a different language (preset HLSL, not EEL) and stay
 * out of this table.
 */

/** NS-EEL treats values within this distance of zero as false. */
export const MILKDROP_EEL_CLOSE_FACTOR = 0.00001;

/** EEL's float→int conversion: truncate toward zero, non-finite → 0. */
export function toMilkdropInt(value: number) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Runtime services the interpreter renderers may need. */
export type EelEvalHelpers = {
  nextRandom?: () => number;
  megabuf?: (index: number) => number;
  gmegabuf?: (index: number) => number;
  megabufWrite?: (index: number, value: number) => void;
  gmegabufWrite?: (index: number, value: number) => void;
};

/** Temporary-variable allocator for JIT renderers that must avoid splicing an
 * argument string twice (its side effects would run twice). */
export type EelJitContext = {
  temp(): string;
};

const CF = MILKDROP_EEL_CLOSE_FACTOR;

export type EelFunctionSpec = {
  /** Alternate spellings resolving to the same entry (e.g. fmod → mod). */
  aliases?: readonly string[];
  /**
   * Default value per parameter; also declares the arity. Renderers receive
   * an args array padded to this length with backend-formatted defaults
   * (numbers for interp, `"0"` for JS, `"0.0f"` / `"0.0"` for the WGSL
   * dialects). Extra caller args are passed through untruncated.
   */
  defaults: readonly number[];
  /** Variadic entries receive the caller's args verbatim (no padding). */
  variadic?: boolean;
  interp?: (args: number[], helpers: EelEvalHelpers) => number;
  jit?: (args: string[], ctx: EelJitContext) => string;
  wgslVm?: (args: string[]) => string;
  /** Present exactly when the call may lower to the GPU field path. */
  wgslField?: (args: string[]) => string;
};

export type EelBinaryOperatorSpec = {
  /** Absent for the short-circuiting ops (&&, ||) and assignment, which the
   * interpreter must handle lazily before operand evaluation. */
  interp?: (left: number, right: number) => number;
  jit?: (left: string, right: string, ctx: EelJitContext) => string;
  wgslVm?: (left: string, right: string) => string;
  wgslField?: (left: string, right: string) => string;
};

export type EelUnaryOperatorSpec = {
  interp?: (value: number) => number;
  jit?: (value: string) => string;
  wgslVm?: (value: string) => string;
  wgslField?: (value: string) => string;
};

const finiteOrZero = (value: number) => (Number.isFinite(value) ? value : 0);

export const EEL_BINARY_OPERATORS: Record<string, EelBinaryOperatorSpec> = {
  '+': {
    interp: (l, r) => l + r,
    jit: (l, r) => `((${l}) + (${r}))`,
    wgslVm: (l, r) => `(${l} + ${r})`,
    wgslField: (l, r) => `(${l} + ${r})`,
  },
  '-': {
    interp: (l, r) => l - r,
    jit: (l, r) => `((${l}) - (${r}))`,
    wgslVm: (l, r) => `(${l} - ${r})`,
    wgslField: (l, r) => `(${l} - ${r})`,
  },
  '*': {
    interp: (l, r) => l * r,
    jit: (l, r) => `((${l}) * (${r}))`,
    wgslVm: (l, r) => `(${l} * ${r})`,
    wgslField: (l, r) => `(${l} * ${r})`,
  },
  '/': {
    // Exact-zero guard only: a tolerance guard zeroed divisions by
    // tiny-but-nonzero values the CPU computes as large finite results.
    interp: (l, r) => (r === 0 ? 0 : l / r),
    jit: (l, r, ctx) => {
      // Operands land in temporaries so side effects run once, left first.
      const lTemp = ctx.temp();
      const rTemp = ctx.temp();
      return `(${lTemp} = (${l}), ${rTemp} = (${r}), ${rTemp} === 0 ? 0 : ${lTemp} / ${rTemp})`;
    },
    wgslVm: (l, r) => `milkdropDiv(${l}, ${r})`,
    wgslField: (l, r) => `milkdropDiv(${l}, ${r})`,
  },
  '%': {
    // C-style truncated INTEGER modulo — both operands truncate first.
    // Float mod stays available through the mod()/fmod() functions.
    interp: (l, r) => {
      const leftInt = toMilkdropInt(l);
      const rightInt = toMilkdropInt(r);
      return rightInt === 0 ? 0 : leftInt % rightInt;
    },
    jit: (l, r, ctx) => {
      const aTemp = ctx.temp();
      const bTemp = ctx.temp();
      return `(${aTemp} = Math.trunc(${l}) || 0, ${bTemp} = Math.trunc(${r}) || 0, ${bTemp} === 0 ? 0 : ${aTemp} % ${bTemp})`;
    },
    wgslVm: (l, r) => `milkdropIntMod(${l}, ${r})`,
    wgslField: (l, r) => `milkdropIntMod(${l}, ${r})`,
  },
  '^': {
    // Raw pow with a finite clamp: negative base with fractional exponent is
    // NaN on the CPU, which the clamp zeroes; milkdropPow mirrors that.
    interp: (l, r) => finiteOrZero(l ** r),
    jit: (l, r, ctx) => {
      const vTemp = ctx.temp();
      return `(${vTemp} = (${l}) ** (${r}), Number.isFinite(${vTemp}) ? ${vTemp} : 0)`;
    },
    wgslVm: (l, r) => `milkdropPow(${l}, ${r})`,
    wgslField: (l, r) => `milkdropPow(${l}, ${r})`,
  },
  '|': {
    interp: (l, r) => toMilkdropInt(l) | toMilkdropInt(r),
    jit: (l, r) => `((Math.trunc(${l})||0) | (Math.trunc(${r})||0))`,
    wgslVm: (l, r) => `f32(i32(${l}) | i32(${r}))`,
    wgslField: (l, r) => `milkdropBitOr(${l}, ${r})`,
  },
  '&': {
    interp: (l, r) => toMilkdropInt(l) & toMilkdropInt(r),
    jit: (l, r) => `((Math.trunc(${l})||0) & (Math.trunc(${r})||0))`,
    wgslVm: (l, r) => `f32(i32(${l}) & i32(${r}))`,
    wgslField: (l, r) => `milkdropBitAnd(${l}, ${r})`,
  },
  '<': {
    interp: (l, r) => (l < r ? 1 : 0),
    jit: (l, r) => `((${l}) < (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} < ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} < ${r})`,
  },
  '<=': {
    interp: (l, r) => (l <= r ? 1 : 0),
    jit: (l, r) => `((${l}) <= (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} <= ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} <= ${r})`,
  },
  '>': {
    interp: (l, r) => (l > r ? 1 : 0),
    jit: (l, r) => `((${l}) > (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} > ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} > ${r})`,
  },
  '>=': {
    interp: (l, r) => (l >= r ? 1 : 0),
    jit: (l, r) => `((${l}) >= (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} >= ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} >= ${r})`,
  },
  '==': {
    // The == OPERATOR compares exactly; only equal() is close-factor.
    interp: (l, r) => (l === r ? 1 : 0),
    jit: (l, r) => `((${l}) === (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} == ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} == ${r})`,
  },
  '!=': {
    interp: (l, r) => (l !== r ? 1 : 0),
    jit: (l, r) => `((${l}) !== (${r}) ? 1 : 0)`,
    wgslVm: (l, r) => `select(0.0f, 1.0f, ${l} != ${r})`,
    wgslField: (l, r) => `select(0.0, 1.0, ${l} != ${r})`,
  },
  // The interpreter short-circuits && and || itself (the right side of a
  // decided boolean op must not run — presets put assignments there), so
  // these entries carry emitters only. The JIT's emitted JS short-circuits
  // through JS's own && / || evaluation order.
  '&&': {
    jit: (l, r) =>
      `((Math.abs(${l}) > ${CF} && Math.abs(${r}) > ${CF}) ? 1 : 0)`,
    wgslVm: (l, r) =>
      `select(0.0f, 1.0f, abs(${l}) > 0.00001f && abs(${r}) > 0.00001f)`,
    wgslField: (l, r) =>
      `select(0.0, 1.0, milkdropBool(${l}) > 0.5 && milkdropBool(${r}) > 0.5)`,
  },
  '||': {
    jit: (l, r) =>
      `((Math.abs(${l}) > ${CF} || Math.abs(${r}) > ${CF}) ? 1 : 0)`,
    wgslVm: (l, r) =>
      `select(0.0f, 1.0f, abs(${l}) > 0.00001f || abs(${r}) > 0.00001f)`,
    wgslField: (l, r) =>
      `select(0.0, 1.0, milkdropBool(${l}) > 0.5 || milkdropBool(${r}) > 0.5)`,
  },
};

export const EEL_UNARY_OPERATORS: Record<string, EelUnaryOperatorSpec> = {
  '+': {
    interp: (v) => v,
    jit: (v) => `(+(${v}))`,
    wgslVm: (v) => v,
    wgslField: (v) => `(+${v})`,
  },
  '-': {
    interp: (v) => -v,
    jit: (v) => `(-(${v}))`,
    wgslVm: (v) => `(-${v})`,
    wgslField: (v) => `(-${v})`,
  },
  '!': {
    interp: (v) => (Math.abs(v) > CF ? 0 : 1),
    jit: (v) => `(Math.abs(${v}) > ${CF} ? 0 : 1)`,
    wgslVm: (v) => `select(1.0f, 0.0f, abs(${v}) > 0.00001f)`,
    wgslField: (v) => `select(1.0, 0.0, milkdropBool(${v}) > 0.5)`,
  },
};

export const EEL_FUNCTIONS: Record<string, EelFunctionSpec> = {
  sin: {
    defaults: [0],
    interp: (a) => Math.sin(a[0]),
    jit: (a) => `Math.sin(${a[0]})`,
    wgslVm: (a) => `sin(${a[0]})`,
    wgslField: (a) => `sin(${a[0]})`,
  },
  cos: {
    defaults: [0],
    interp: (a) => Math.cos(a[0]),
    jit: (a) => `Math.cos(${a[0]})`,
    wgslVm: (a) => `cos(${a[0]})`,
    wgslField: (a) => `cos(${a[0]})`,
  },
  tan: {
    defaults: [0],
    interp: (a) => Math.tan(a[0]),
    jit: (a) => `Math.tan(${a[0]})`,
    wgslVm: (a) => `tan(${a[0]})`,
    wgslField: (a) => `tan(${a[0]})`,
  },
  // Domain-guarded: the raw GPU builtins return NaN outside [-1, 1], which
  // the CPU tier never produces.
  asin: {
    defaults: [0],
    interp: (a) => Math.asin(Math.min(1, Math.max(-1, a[0]))),
    jit: (a) => `Math.asin(Math.min(1, Math.max(-1, ${a[0]})))`,
    wgslVm: (a) => `asin(clamp(${a[0]}, -1.0f, 1.0f))`,
    wgslField: (a) => `milkdropAsin(${a[0]})`,
  },
  acos: {
    defaults: [0],
    interp: (a) => Math.acos(Math.min(1, Math.max(-1, a[0]))),
    jit: (a) => `Math.acos(Math.min(1, Math.max(-1, ${a[0]})))`,
    wgslVm: (a) => `acos(clamp(${a[0]}, -1.0f, 1.0f))`,
    wgslField: (a) => `milkdropAcos(${a[0]})`,
  },
  atan: {
    defaults: [0],
    interp: (a) => Math.atan(a[0]),
    jit: (a) => `Math.atan(${a[0]})`,
    wgslVm: (a) => `atan(${a[0]})`,
    // HLSL-style two-arg atan is accepted on the field path.
    wgslField: (a) =>
      a.length === 2 ? `atan2(${a[0]}, ${a[1]})` : `atan(${a[0]})`,
  },
  abs: {
    defaults: [0],
    interp: (a) => Math.abs(a[0]),
    jit: (a) => `Math.abs(${a[0]})`,
    wgslVm: (a) => `abs(${a[0]})`,
    wgslField: (a) => `abs(${a[0]})`,
  },
  sqrt: {
    defaults: [0],
    interp: (a) => Math.sqrt(Math.max(0, a[0])),
    jit: (a) => `Math.sqrt(Math.max(0, ${a[0]}))`,
    wgslVm: (a) => `milkdropSqrt(${a[0]})`,
    wgslField: (a) => `milkdropSqrt(${a[0]})`,
  },
  // ns-eel's reciprocal square root. MilkDrop's implementation is the
  // Quake-style fast approximation; we use the exact reciprocal, which is
  // strictly closer to the ideal and keeps every tier bit-comparable. A
  // non-positive input gives 1/0 = Infinity, which the usual finite clamp
  // turns into 0.
  invsqrt: {
    defaults: [0],
    interp: (a) => finiteOrZero(1 / Math.sqrt(Math.max(0, a[0]))),
    jit: (a, ctx) => {
      const vTemp = ctx.temp();
      return `(${vTemp} = 1 / Math.sqrt(Math.max(0, ${a[0]})), Number.isFinite(${vTemp}) ? ${vTemp} : 0)`;
    },
    wgslVm: (a) => `milkdropInvSqrt(${a[0]})`,
    wgslField: (a) => `milkdropInvSqrt(${a[0]})`,
  },
  pow: {
    defaults: [0, 0],
    interp: (a) => finiteOrZero(a[0] ** a[1]),
    jit: (a, ctx) => {
      const vTemp = ctx.temp();
      return `(${vTemp} = (${a[0]}) ** (${a[1]}), Number.isFinite(${vTemp}) ? ${vTemp} : 0)`;
    },
    wgslVm: (a) => `milkdropPow(${a[0]}, ${a[1]})`,
    wgslField: (a) => `milkdropPow(${a[0]}, ${a[1]})`,
  },
  // Float truncated remainder (sign follows the dividend), unlike the
  // integer % operator.
  mod: {
    aliases: ['fmod'],
    defaults: [0, 0],
    interp: (a) => (a[1] === 0 ? 0 : a[0] % a[1]),
    jit: (a, ctx) => {
      const aTemp = ctx.temp();
      const bTemp = ctx.temp();
      return `(${aTemp} = ${a[0]}, ${bTemp} = ${a[1]}, ${bTemp} === 0 ? 0 : ${aTemp} % ${bTemp})`;
    },
    wgslVm: (a) => `milkdropMod(${a[0]}, ${a[1]})`,
    wgslField: (a) => `milkdropMod(${a[0]}, ${a[1]})`,
  },
  min: {
    defaults: [0, 0],
    variadic: true,
    interp: (a) => Math.min(...a),
    jit: (a) => `Math.min(${a.join(',') || '0'})`,
    wgslVm: (a) => (a.length >= 2 ? `min(${a[0]}, ${a[1]})` : (a[0] ?? '0.0f')),
    wgslField: (a) => `min(${a.join(', ')})`,
  },
  max: {
    defaults: [0, 0],
    variadic: true,
    interp: (a) => Math.max(...a),
    jit: (a) => `Math.max(${a.join(',') || '0'})`,
    wgslVm: (a) => (a.length >= 2 ? `max(${a[0]}, ${a[1]})` : (a[0] ?? '0.0f')),
    wgslField: (a) => `max(${a.join(', ')})`,
  },
  mix: {
    aliases: ['lerp'],
    defaults: [0, 0, 0],
    interp: (a) => a[0] + (a[1] - a[0]) * a[2],
    jit: (a) => `((${a[0]}) + ((${a[1]}) - (${a[0]})) * (${a[2]}))`,
    wgslVm: (a) => `mix(${a[0]}, ${a[1]}, ${a[2]})`,
    wgslField: (a) => `mix(${a[0]}, ${a[1]}, ${a[2]})`,
  },
  floor: {
    defaults: [0],
    interp: (a) => Math.floor(a[0]),
    jit: (a) => `Math.floor(${a[0]})`,
    wgslVm: (a) => `floor(${a[0]})`,
    wgslField: (a) => `floor(${a[0]})`,
  },
  // int() truncates toward zero (not floor — they differ for negatives).
  int: {
    defaults: [0],
    interp: (a) => toMilkdropInt(a[0]),
    jit: (a) => `(Math.trunc(${a[0]})||0)`,
    wgslVm: (a) => `sign(${a[0]}) * floor(abs(${a[0]}))`,
    wgslField: (a) => `trunc(${a[0]})`,
  },
  ceil: {
    defaults: [0],
    interp: (a) => Math.ceil(a[0]),
    jit: (a) => `Math.ceil(${a[0]})`,
    wgslVm: (a) => `ceil(${a[0]})`,
    wgslField: (a) => `ceil(${a[0]})`,
  },
  sqr: {
    defaults: [0],
    interp: (a) => a[0] * a[0],
    jit: (a, ctx) => {
      const sTemp = ctx.temp();
      return `(${sTemp} = ${a[0]}, ${sTemp} * ${sTemp})`;
    },
    wgslVm: (a) => `(${a[0]} * ${a[0]})`,
    wgslField: (a) => `((${a[0]}) * (${a[0]}))`,
  },
  clamp: {
    defaults: [0, 0, 1],
    interp: (a) => Math.min(Math.max(a[0], a[1]), a[2]),
    jit: (a) => `Math.min(Math.max(${a[0]}, ${a[1]}), ${a[2]})`,
    wgslVm: (a) => `clamp(${a[0]}, ${a[1]}, ${a[2]})`,
    wgslField: (a) => `clamp(${a[0]}, ${a[1]}, ${a[2]})`,
  },
  step: {
    defaults: [0, 0],
    interp: (a) => (a[1] < a[0] ? 0 : 1),
    jit: (a) => `((${a[1]}) < (${a[0]}) ? 0 : 1)`,
    wgslVm: (a) => `select(0.0f, 1.0f, ${a[1]} >= ${a[0]})`,
    wgslField: (a) => `step(${a[0]}, ${a[1]})`,
  },
  smoothstep: {
    defaults: [0, 1, 0],
    interp: (a) => {
      const [edge0, edge1, value] = a as [number, number, number];
      if (edge0 === edge1) {
        return value < edge0 ? 0 : 1;
      }
      const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
      return t * t * (3 - 2 * t);
    },
    jit: (a) =>
      `((function(e0,e1,v){if(e0===e1)return v<e0?0:1;var t=Math.min(Math.max((v-e0)/(e1-e0),0),1);return t*t*(3-2*t)})(${a[0]},${a[1]},${a[2]}))`,
    wgslVm: (a) => `smoothstep(${a[0]}, ${a[1]}, ${a[2]})`,
    wgslField: (a) => `smoothstep(${a[0]}, ${a[1]}, ${a[2]})`,
  },
  // Finite-clamped: log(0) is -Infinity on the CPU, which the clamp zeroes,
  // and comparisons against the raw -Inf flipped across tiers.
  log: {
    defaults: [0],
    interp: (a) => finiteOrZero(Math.log(Math.max(0, a[0]))),
    jit: (a, ctx) => {
      const temp = ctx.temp();
      return `(${temp} = Math.log(Math.max(0, ${a[0]})), Number.isFinite(${temp}) ? ${temp} : 0)`;
    },
    wgslVm: (a) => `milkdropLog(${a[0]})`,
    wgslField: (a) => `milkdropLog(${a[0]})`,
  },
  log10: {
    defaults: [0],
    interp: (a) => finiteOrZero(Math.log10(Math.max(0, a[0]))),
    jit: (a, ctx) => {
      const temp = ctx.temp();
      return `(${temp} = Math.log10(Math.max(0, ${a[0]})), Number.isFinite(${temp}) ? ${temp} : 0)`;
    },
    wgslVm: (a) => `milkdropLog10(${a[0]})`,
    wgslField: (a) => `milkdropLog10(${a[0]})`,
  },
  exp: {
    defaults: [0],
    interp: (a) => Math.exp(a[0]),
    jit: (a) => `Math.exp(${a[0]})`,
    wgslVm: (a) => `exp(${a[0]})`,
    wgslField: (a) => `exp(${a[0]})`,
  },
  sigmoid: {
    defaults: [0, 1],
    interp: (a) => 1 / (1 + Math.exp(-a[0] * a[1])),
    jit: (a) => `(1 / (1 + Math.exp(-(${a[0]}) * (${a[1]}))))`,
    wgslVm: (a) => `(1.0f / (1.0f + exp(-(${a[0]}) * (${a[1]}))))`,
    wgslField: (a) => `milkdropSigmoid(${a[0]}, ${a[1]})`,
  },
  sign: {
    defaults: [0],
    interp: (a) => Math.sign(a[0]) || 0,
    jit: (a) => `(Math.sign(${a[0]})||0)`,
    wgslVm: (a) => `sign(${a[0]})`,
    wgslField: (a) => `sign(${a[0]})`,
  },
  bor: {
    defaults: [0, 0],
    interp: (a) => (Math.abs(a[0]) > CF || Math.abs(a[1]) > CF ? 1 : 0),
    jit: (a) =>
      `((Math.abs(${a[0]}) > ${CF} || Math.abs(${a[1]}) > ${CF}) ? 1 : 0)`,
    wgslVm: (a) =>
      `select(0.0f, 1.0f, abs(${a[0]}) > 0.00001f || abs(${a[1]}) > 0.00001f)`,
    wgslField: (a) =>
      `select(0.0, 1.0, milkdropBool(${a[0]}) > 0.5 || milkdropBool(${a[1]}) > 0.5)`,
  },
  band: {
    defaults: [0, 0],
    interp: (a) => (Math.abs(a[0]) > CF && Math.abs(a[1]) > CF ? 1 : 0),
    jit: (a) =>
      `((Math.abs(${a[0]}) > ${CF} && Math.abs(${a[1]}) > ${CF}) ? 1 : 0)`,
    wgslVm: (a) =>
      `select(0.0f, 1.0f, abs(${a[0]}) > 0.00001f && abs(${a[1]}) > 0.00001f)`,
    wgslField: (a) =>
      `select(0.0, 1.0, milkdropBool(${a[0]}) > 0.5 && milkdropBool(${a[1]}) > 0.5)`,
  },
  bnot: {
    defaults: [0],
    interp: (a) => (Math.abs(a[0]) > CF ? 0 : 1),
    jit: (a) => `(Math.abs(${a[0]}) > ${CF} ? 0 : 1)`,
    wgslVm: (a) => `select(1.0f, 0.0f, abs(${a[0]}) > 0.00001f)`,
    wgslField: (a) => `select(1.0, 0.0, milkdropBool(${a[0]}) > 0.5)`,
  },
  atan2: {
    defaults: [0, 0],
    interp: (a) => Math.atan2(a[0], a[1]),
    jit: (a) => `Math.atan2(${a[0]}, ${a[1]})`,
    wgslVm: (a) => `atan2(${a[0]}, ${a[1]})`,
    wgslField: (a) => `atan2(${a[0]}, ${a[1]})`,
  },
  frac: {
    defaults: [0],
    interp: (a) => a[0] - Math.floor(a[0]),
    jit: (a, ctx) => {
      // Temp so the argument's side effects run once.
      const temp = ctx.temp();
      return `(${temp} = (${a[0]}), ${temp} - Math.floor(${temp}))`;
    },
    wgslVm: (a) => `(${a[0]} - floor(${a[0]}))`,
    wgslField: (a) => `milkdropFrac(${a[0]})`,
  },
  // The interpreter evaluates `if` lazily (only the taken branch runs, for
  // side effects) before reaching this table; this eager entry serves the
  // emitters, whose targets have no side effects in expression position.
  if: {
    defaults: [0, 0, 0],
    interp: (a) => (Math.abs(a[0]) > CF ? a[1] : a[2]),
    jit: (a) => `(Math.abs(${a[0]}) > ${CF} ? (${a[1]}) : (${a[2]}))`,
    wgslVm: (a) =>
      `select(f32(${a[2]}), f32(${a[1]}), abs(${a[0]}) > 0.00001f)`,
    wgslField: (a) => `milkdropIf(${a[0]}, ${a[1]}, ${a[2]})`,
  },
  above: {
    defaults: [0, 0],
    interp: (a) => (a[0] > a[1] ? 1 : 0),
    jit: (a) => `((${a[0]}) > (${a[1]}) ? 1 : 0)`,
    wgslVm: (a) => `select(0.0f, 1.0f, (${a[0]}) > (${a[1]}))`,
    wgslField: (a) => `milkdropAbove(${a[0]}, ${a[1]})`,
  },
  below: {
    defaults: [0, 0],
    interp: (a) => (a[0] < a[1] ? 1 : 0),
    jit: (a) => `((${a[0]}) < (${a[1]}) ? 1 : 0)`,
    wgslVm: (a) => `select(0.0f, 1.0f, (${a[0]}) < (${a[1]}))`,
    wgslField: (a) => `milkdropBelow(${a[0]}, ${a[1]})`,
  },
  // equal() is close-factor equality — only the == operator compares exactly.
  equal: {
    defaults: [0, 0],
    interp: (a) => (Math.abs(a[0] - a[1]) <= CF ? 1 : 0),
    jit: (a) => `(Math.abs((${a[0]}) - (${a[1]})) <= ${CF} ? 1 : 0)`,
    wgslVm: (a) => `milkdropEqual(${a[0]}, ${a[1]})`,
    wgslField: (a) => `milkdropEqual(${a[0]}, ${a[1]})`,
  },
  rand: {
    defaults: [1],
    interp: (a, helpers) => (helpers.nextRandom?.() ?? 0.5) * a[0],
    jit: (a) => `(rnd() * (${a[0]}))`,
    wgslVm: () => 'rand()',
    // The field path has no per-vertex RNG state; a hash of (seed, time)
    // stands in.
    wgslField: (a) => `milkdropRand(${a[0]}, signalTimeValue)`,
  },
  randint: {
    defaults: [1],
    interp: (a, helpers) => Math.floor((helpers.nextRandom?.() ?? 0.5) * a[0]),
    jit: (a) => `Math.floor(rnd() * (${a[0]}))`,
    wgslVm: (a) => `floor(rand() * max(0.0f, ${a[0]}))`,
  },
  megabuf: {
    defaults: [0],
    interp: (a, helpers) => helpers.megabuf?.(a[0]) ?? 0,
    // The JIT special-cases megabuf before argument compilation
    // (bounds-checked buffer reads), so that renderer lives in the backend.
    // The compute VM reads through a @binding(2) storage array; the helper
    // is emitted by wgsl-generator because it references a module-scope
    // storage variable (docs/architecture/eel-guest-memory.md). The field
    // path still refuses to lower buffer programs.
    wgslVm: (a) => `milkdropMegabufRead(${a[0] ?? '0.0f'})`,
  },
  gmegabuf: {
    defaults: [0],
    interp: (a, helpers) => helpers.gmegabuf?.(a[0]) ?? 0,
    wgslVm: (a) => `milkdropGmegabufRead(${a[0] ?? '0.0f'})`,
  },
  exec2: {
    aliases: ['exec3'],
    defaults: [],
    variadic: true,
    interp: (a) => a[a.length - 1] ?? 0,
    jit: (a) =>
      a.length > 0 ? `(${a.map((arg) => `(${arg})`).join(', ')})` : '(0)',
    wgslVm: (a) => a[a.length - 1] ?? '0.0f',
    wgslField: (a) => a[a.length - 1] ?? '0.0',
  },
  // Shader-dialect extras accepted only by the compute-VM emitter (they show
  // up when whole shader-ish blocks route through it); no CPU or field-path
  // equivalents exist.
  saturate: {
    defaults: [0],
    wgslVm: (a) => `saturate(${a[0]})`,
  },
  ddx: {
    defaults: [0],
    wgslVm: (a) => `dpdx(${a[0]})`,
  },
  ddy: {
    defaults: [0],
    wgslVm: (a) => `dpdy(${a[0]})`,
  },
  mul: {
    defaults: [0, 0],
    wgslVm: (a) => `(${a[0]} * ${a[1]})`,
  },
};

/** Canonical entry for a (lowercased) function name, following aliases. */
const FUNCTION_LOOKUP: ReadonlyMap<string, EelFunctionSpec> = (() => {
  const lookup = new Map<string, EelFunctionSpec>();
  for (const [name, spec] of Object.entries(EEL_FUNCTIONS)) {
    lookup.set(name, spec);
    for (const alias of spec.aliases ?? []) {
      lookup.set(alias, spec);
    }
  }
  return lookup;
})();

export function getEelFunctionSpec(name: string): EelFunctionSpec | undefined {
  return FUNCTION_LOOKUP.get(name);
}

/**
 * Function names (aliases included) eligible for the GPU field path —
 * exactly the entries with a `wgslField` renderer. The gpu-field-planner
 * consumes this instead of maintaining its own allowlist.
 */
export const GPU_FIELD_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  [...FUNCTION_LOOKUP.entries()]
    .filter(([, spec]) => spec.wgslField !== undefined)
    .map(([name]) => name),
);

/** Pads `args` with backend-formatted defaults up to the declared arity.
 * Extra caller arguments are kept (some renderers inspect them). */
function padArgs<T>(
  spec: EelFunctionSpec,
  args: readonly T[],
  formatDefault: (value: number) => T,
): T[] {
  if (spec.variadic || args.length >= spec.defaults.length) {
    return [...args];
  }
  const padded = [...args];
  for (let i = args.length; i < spec.defaults.length; i += 1) {
    padded.push(formatDefault(spec.defaults[i] as number));
  }
  return padded;
}

const formatJsDefault = (value: number) => String(value);
const formatWgslVmDefault = (value: number) =>
  Number.isInteger(value) ? `${value}.0f` : `${value}f`;
const formatWgslFieldDefault = (value: number) =>
  Number.isInteger(value) ? `${value}.0` : String(value);

/** Interprets a call with already-evaluated arguments. Unknown names return
 * 0, matching EEL's ignore-unknown-calls behavior. */
export function evaluateEelCall(
  name: string,
  args: readonly number[],
  helpers: EelEvalHelpers,
): number {
  const spec = FUNCTION_LOOKUP.get(name);
  if (!spec?.interp) {
    return 0;
  }
  return spec.interp(
    padArgs(spec, args, (value) => value),
    helpers,
  );
}

/** Emits the JS expression for a call; null when the backend must fall back
 * to its own default (unknown or CPU-unsupported name). */
export function emitEelCallJs(
  name: string,
  args: readonly string[],
  ctx: EelJitContext,
): string | null {
  const spec = FUNCTION_LOOKUP.get(name);
  if (!spec?.jit) {
    return null;
  }
  return spec.jit(padArgs(spec, args, formatJsDefault), ctx);
}

/** Emits the compute-VM WGSL expression for a call; null when unknown. */
export function emitEelCallWgslVm(
  name: string,
  args: readonly string[],
): string | null {
  const spec = FUNCTION_LOOKUP.get(name);
  if (!spec?.wgslVm) {
    return null;
  }
  return spec.wgslVm(padArgs(spec, args, formatWgslVmDefault));
}

/** Emits the field-program WGSL expression for a call; null when the name is
 * not field-lowerable (the planner should have rejected it already). */
export function emitEelCallWgslField(
  name: string,
  args: readonly string[],
): string | null {
  const spec = FUNCTION_LOOKUP.get(name);
  if (!spec?.wgslField) {
    return null;
  }
  return spec.wgslField(padArgs(spec, args, formatWgslFieldDefault));
}
