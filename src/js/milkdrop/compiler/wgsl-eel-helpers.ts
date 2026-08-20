/**
 * Shared WGSL implementations of EEL scalar semantics — the single source of
 * truth for how MilkDrop expression edge cases behave on the GPU.
 *
 * Two WGSL emitters exist (the per-pixel/per-vertex field-program emitter in
 * renderer-backends/webgpu-procedural-materials.ts and the whole-program
 * compute VM in compiler/wgsl-generator.ts). Before this module each carried
 * its own operator table, and the tables drifted (exact-vs-close-factor
 * `equal`, different log(0) floors, different pow(negative) clamps, different
 * divide guards). Both now compose their prelude from this source, so a
 * semantics fix lands once.
 *
 * The reference semantics are the CPU interpreter's
 * (expression.ts evaluateMilkdropExpression) as pinned by
 * tests/unit/eel-conformance-spec.test.ts and kept in GPU lockstep by the JS
 * mirror in tests/unit/gpu-field-tier-differential.test.ts. The truthiness
 * threshold is MILKDROP_EEL_CLOSE_FACTOR (0.00001) everywhere — a
 * tenfold-tighter constant here has already caused visible cross-tier flips.
 *
 * milkdropPow is sign-decomposed to match JS ** exactly (0^0 = 1, negative
 * bases real for integral exponents) — the real-GPU differential
 * (lab:gpu-differential) showed naive WGSL pow() diverging constantly on
 * boolean-fed pow idioms, so this is NOT an acceptable divergence.
 */
import { EEL_F32_MAX_WGSL } from './eel-function-table.ts';

export const MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE = `
  fn milkdropBool(value: f32) -> f32 {
    return select(0.0, 1.0, abs(value) > 0.00001);
  }

  fn milkdropDiv(left: f32, right: f32) -> f32 {
    return select(left / right, 0.0, right == 0.0);
  }

  fn milkdropFinite(value: f32) -> f32 {
    return select(0.0, value, abs(value) < ${EEL_F32_MAX_WGSL});
  }

  fn milkdropSqrt(value: f32) -> f32 {
    return sqrt(max(value, 0.0));
  }

  fn milkdropInvSqrt(value: f32) -> f32 {
    // 1/sqrt(x) with the CPU's clamps: x <= 0 gives Infinity, which the
    // per-op finite clamp zeroes.
    let v = 1.0 / sqrt(max(value, 0.0));
    return select(0.0, v, abs(v) < ${EEL_F32_MAX_WGSL});
  }

  fn milkdropAsin(value: f32) -> f32 {
    return asin(clamp(value, -1.0, 1.0));
  }

  fn milkdropAcos(value: f32) -> f32 {
    return acos(clamp(value, -1.0, 1.0));
  }

  fn milkdropPow(base: f32, exponent: f32) -> f32 {
    // JS ** semantics (the CPU reference): x^0 = 1 including 0^0 and
    // (-x)^0; a negative base with an integral exponent is real with the
    // parity sign; negative base with fractional exponent is NaN, which the
    // CPU's per-op finite clamp turns into 0. Naive WGSL pow() is NaN for
    // every negative base — the real-GPU differential caught boolean-fed
    // pow idioms (above(..) ^ above(..)) flipping 1 -> 0 constantly.
    if (exponent == 0.0) {
      return 1.0;
    }
    if (base == 0.0) {
      // 0^positive = 0; 0^negative = +Inf, which the finite clamp zeroes.
      return 0.0;
    }
    var v: f32;
    if (base < 0.0) {
      if (exponent != trunc(exponent)) {
        return 0.0;
      }
      let magnitude = pow(-base, exponent);
      v = select(magnitude, -magnitude, abs(trunc(exponent)) % 2.0 == 1.0);
    } else {
      v = pow(base, exponent);
    }
    return select(0.0, v, abs(v) < ${EEL_F32_MAX_WGSL});
  }

  fn milkdropLog(value: f32) -> f32 {
    let v = log(max(value, 0.0));
    return select(0.0, v, abs(v) < ${EEL_F32_MAX_WGSL});
  }

  fn milkdropLog10(value: f32) -> f32 {
    return milkdropLog(value) * 0.4342944819032518;
  }

  fn milkdropBitOr(left: f32, right: f32) -> f32 {
    return f32(i32(left) | i32(right));
  }

  fn milkdropBitAnd(left: f32, right: f32) -> f32 {
    return f32(i32(left) & i32(right));
  }

  fn milkdropFrac(value: f32) -> f32 {
    return value - floor(value);
  }

  fn milkdropSigmoid(value: f32, slope: f32) -> f32 {
    return 1.0 / (1.0 + exp(-value * slope));
  }

  fn milkdropIf(condition: f32, whenTrue: f32, whenFalse: f32) -> f32 {
    return select(whenFalse, whenTrue, abs(condition) > 0.00001);
  }

  fn milkdropAbove(left: f32, right: f32) -> f32 {
    return select(0.0, 1.0, left > right);
  }

  fn milkdropBelow(left: f32, right: f32) -> f32 {
    return select(0.0, 1.0, left < right);
  }

  fn milkdropEqual(left: f32, right: f32) -> f32 {
    return select(0.0, 1.0, abs(left - right) <= 0.00001);
  }

  fn milkdropRand(seed: f32, time: f32) -> f32 {
    return milkdropFrac(sin(dot(vec2<f32>(seed, time), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  }

  fn milkdropTruncInt(value: f32) -> i32 {
    // Non-finite collapses to 0, matching toMilkdropInt. Clamp before the
    // i32 cast: out-of-range float-to-int conversion is undefined in WGSL.
    let finite = value == value && abs(value) < ${EEL_F32_MAX_WGSL};
    let truncated = trunc(select(0.0, value, finite));
    return i32(clamp(truncated, -2147483520.0, 2147483520.0));
  }

  fn milkdropIntMod(left: f32, right: f32) -> f32 {
    // The % OPERATOR: both operands truncate to integers first (see the
    // conformance spec). i32 remainder is exact where the corpus lives
    // (|x| < 2^31); the old float-subtraction form lost exactness past
    // 2^24 in f32.
    let l = milkdropTruncInt(left);
    let r = milkdropTruncInt(right);
    // select() evaluates both arms, so keep the divisor non-zero even when
    // the result is discarded — integer remainder by zero is UB in WGSL.
    let safeRight = select(r, 1, r == 0);
    let m = select(f32(l % safeRight), 0.0, r == 0);
    // C-style remainder carries the dividend's sign onto zero results
    // (-1 % -1 is -0); i32 math yields +0, which atan2 turns into a
    // visible +/-pi flip. sign(left) * 0.0 reconstructs the signed zero.
    return select(m, 0.0 * sign(left), m == 0.0);
  }

  fn milkdropMod(left: f32, right: f32) -> f32 {
    // The mod()/fmod() FUNCTIONS: float truncated remainder (sign follows
    // left), matching HLSL fmod and the CPU tiers' JS %. The zero guard is
    // exact like the CPU (a tolerance guard zeroed tiny-divisor cases the
    // CPU computes).
    let m = select(left - right * trunc(left / right), 0.0, right == 0.0);
    // Dividend-signed zero, matching C fmod and the CPU tier's JS %.
    return select(m, 0.0 * sign(left), m == 0.0);
  }
`;
