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
export const MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE = `
  fn milkdropBool(value: f32) -> f32 {
    return select(0.0, 1.0, abs(value) > 0.00001);
  }

  fn milkdropDiv(left: f32, right: f32) -> f32 {
    return select(left / right, 0.0, right == 0.0);
  }

  fn milkdropFinite(value: f32) -> f32 {
    return select(0.0, value, abs(value) < 3.402823e38);
  }

  fn milkdropSqrt(value: f32) -> f32 {
    return sqrt(max(value, 0.0));
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
    return select(0.0, v, abs(v) < 3.402823e38);
  }

  fn milkdropLog(value: f32) -> f32 {
    let v = log(max(value, 0.0));
    return select(0.0, v, abs(v) < 3.402823e38);
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
`;
