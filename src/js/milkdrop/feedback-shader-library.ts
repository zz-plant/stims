/**
 * The GLSL shader library for MilkDrop's feedback passes: the builtin
 * declarations every fragment shader embeds (q/t variables, samplers, noise
 * and video-echo helpers, HLSL-to-GLSL promotions), and the fixed
 * warp/blend/composite shader sources that turn per-frame equations into
 * running programs.
 *
 * Extracted from feedback-manager-shared.ts so that file is assembly logic
 * and this one is the strings it assembles — the GLSL lives here, readable in
 * one place, next to nothing else.
 */
import {
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_BLEND_SCALE,
  MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD,
} from './feedback-composite-profile.ts';
import {
  AUX_TEXTURE_ATLAS_GRID_SIZE,
  AUX_TEXTURE_ATLAS_SLICE_COUNT,
} from './feedback-volume-sampling.ts';

/**
 * MilkDrop shader-input surface referenced by transpiled preset bodies:
 * q1..q32 (packed into vec4 uniforms _qa.._qh, matching butterchurn),
 * vec4 aspect (.xy = aspect multipliers, .zw = inverses), rand_preset,
 * and the roam oscillators (derived from time on the GPU with the same
 * frequencies butterchurn computes on the CPU).
 */
export const MILKDROP_SHADER_BUILTIN_DECLARATIONS = `
        uniform vec4 aspect;
        // (width, height, 1/width, 1/height) of the feedback texture custom
        // shader bodies sample — MilkDrop's texsize builtin. Neighbor-tap
        // shaders read texsize.zw as the one-texel offset (see the WebGPU/TSL
        // backend's texsize comment for why this must be the feedback
        // texture's own size, not the viewport). Without this declaration,
        // extractReferencedPerFrameVariables below auto-declares any custom
        // shader body that references texsize as \`uniform float texsize\` —
        // wrong type, and a compile error the instant a body does
        // \`texsize.zw\`.
        uniform vec4 texsize;
        uniform vec4 _qa;
        uniform vec4 _qb;
        uniform vec4 _qc;
        uniform vec4 _qd;
        uniform vec4 _qe;
        uniform vec4 _qf;
        uniform vec4 _qg;
        uniform vec4 _qh;
        uniform vec4 rand_preset;
        #define q1 _qa.x
        #define q2 _qa.y
        #define q3 _qa.z
        #define q4 _qa.w
        #define q5 _qb.x
        #define q6 _qb.y
        #define q7 _qb.z
        #define q8 _qb.w
        #define q9 _qc.x
        #define q10 _qc.y
        #define q11 _qc.z
        #define q12 _qc.w
        #define q13 _qd.x
        #define q14 _qd.y
        #define q15 _qd.z
        #define q16 _qd.w
        #define q17 _qe.x
        #define q18 _qe.y
        #define q19 _qe.z
        #define q20 _qe.w
        #define q21 _qf.x
        #define q22 _qf.y
        #define q23 _qf.z
        #define q24 _qf.w
        #define q25 _qg.x
        #define q26 _qg.y
        #define q27 _qg.z
        #define q28 _qg.w
        #define q29 _qh.x
        #define q30 _qh.y
        #define q31 _qh.z
        #define q32 _qh.w
        #define blur1_min bias1
        #define blur1_max (bias1 + scale1)
        #define blur2_min bias2
        #define blur2_max (bias2 + scale2)
        #define blur3_min bias3
        #define blur3_max (bias3 + scale3)
        #define roam_cos (0.5 + 0.5 * cos(signalTime * vec4(0.3, 1.3, 5.0, 20.0)))
        #define roam_sin (0.5 + 0.5 * sin(signalTime * vec4(0.3, 1.3, 5.0, 20.0)))
        #define slow_roam_cos (0.5 + 0.5 * cos(signalTime * vec4(0.005, 0.008, 0.013, 0.022)))
        #define slow_roam_sin (0.5 + 0.5 * sin(signalTime * vec4(0.005, 0.008, 0.013, 0.022)))
`;

export const Q_VAR_NAMES: readonly (readonly [
  string,
  string,
  string,
  string,
])[] = [
  ['q1', 'q2', 'q3', 'q4'],
  ['q5', 'q6', 'q7', 'q8'],
  ['q9', 'q10', 'q11', 'q12'],
  ['q13', 'q14', 'q15', 'q16'],
  ['q17', 'q18', 'q19', 'q20'],
  ['q21', 'q22', 'q23', 'q24'],
  ['q25', 'q26', 'q27', 'q28'],
  ['q29', 'q30', 'q31', 'q32'],
];
export const Q_UNIFORM_NAMES = [
  '_qa',
  '_qb',
  '_qc',
  '_qd',
  '_qe',
  '_qf',
  '_qg',
  '_qh',
] as const;

/**
 * Emulated 3D noise sampling for preset bodies transpiled from
 * tex3D(sampler_noisevol*, ...): routes through the simplex atlas
 * (source 2.0) with slice blending. The vec2 overload covers bodies
 * that sample the volume texture with a flat coordinate.
 */
export const MILKDROP_NOISE_VOLUME_HELPERS = `
        vec4 sampleNoiseVolume(vec3 p) {
          return sampleAuxTexture(2.0, 1.0, p.xy, p.z);
        }

        vec4 sampleNoiseVolume(vec2 p) {
          return sampleAuxTexture2d(2.0, p);
        }
`;

/**
 * MilkDrop's video echo: the display stage draws the frame a second time,
 * zoomed by fVideoEchoZoom and flipped per nVideoEchoOrientation (bit 0 = x,
 * bit 1 = y), blended over the first by fVideoEchoAlpha. It is a display
 * effect and must not touch the accumulator — flipping the feedback sample
 * instead rotates the carried history every frame, which breaks the
 * invariant the effect is defined by: at alpha 0.5 with orientation 3 the
 * output is exactly its own 180-degree rotation (projectM reference:
 * self-correlation 0.9994; ours before this fix: 0.66).
 */
const MILKDROP_VIDEO_ECHO_HELPER = `
        vec2 applyVideoEchoOrientationTransform(vec2 uv, float orientation) {
          float flipU = step(0.5, mod(orientation, 2.0));
          float flipV = step(1.5, mod(orientation, 4.0));
          return vec2(
            mix(uv.x, 1.0 - uv.x, flipU),
            mix(uv.y, 1.0 - uv.y, flipV)
          );
        }

        vec3 applyVideoEcho(
          sampler2D tex,
          vec2 uv,
          vec3 base,
          float alpha,
          float zoom,
          float orientation,
          float wrap
        ) {
          if (alpha < 0.0001) {
            return base;
          }
          vec2 echoUv = (uv - 0.5) / max(zoom, 0.0001) + 0.5;
          echoUv = applyVideoEchoOrientationTransform(echoUv, orientation);
          vec3 echo = texture2D(tex, sampleUv(echoUv, wrap)).rgb;
          return mix(base, echo, clamp(alpha, 0.0, 1.0));
        }
`;

// HLSL intrinsics promote a scalar argument to the vector width of the
// other arguments — lerp(float3, float, float), max(float, float3),
// pow(float, float3), dot(float3, float) are all legal there and mean
// "splat the scalar first". GLSL's mix/max/pow/dot have no such overloads
// and reject the call, which took the whole program down: the largest
// classes in the offline GLSL corpus scan (mix 70 presets, max 56, pow 18)
// were exactly this. The emitter has no type inference, but GLSL has
// function overloading, so these helpers let the GLSL compiler resolve the
// promotion at compile time instead. The vector/vector and vector/scalar
// forms GLSL already accepts are included so the emitter can call the
// helper unconditionally.
/**
 * HLSL arithmetic truncates the wider vector operand to the narrower one's
 * width (`roam_sin * roam_cos.yzx` is float4 * float3 → float3, a MilkDrop
 * 2 idiom); GLSL rejects mixed widths. The emitter routes `+ - * /` here
 * whenever neither operand is provably scalar, so every width pairing needs
 * a form: same width, vector/scalar, the six mismatched pairs, and the
 * matrix products `mul()` lowers to.
 */
function buildMilkdropArithmeticHelpers(): string {
  const ops = [
    ['milkdropAdd', '+'],
    ['milkdropSub', '-'],
    ['milkdropMul', '*'],
    ['milkdropDiv', '/'],
  ] as const;
  const swizzle = ['', '', 'xy', 'xyz', 'xyzw'];
  const lines: string[] = [];
  for (const [name, op] of ops) {
    lines.push(`float ${name}(float a, float b) { return a ${op} b; }`);
    for (const n of [2, 3, 4]) {
      const v = `vec${n}`;
      lines.push(`${v} ${name}(${v} a, ${v} b) { return a ${op} b; }`);
      lines.push(`${v} ${name}(${v} a, float b) { return a ${op} b; }`);
      lines.push(`${v} ${name}(float a, ${v} b) { return a ${op} b; }`);
      for (const m of [2, 3, 4]) {
        if (m === n) continue;
        const k = Math.min(n, m);
        lines.push(
          `vec${k} ${name}(${v} a, vec${m} b) { return a.${swizzle[k]} ${op} b.${swizzle[k]}; }`,
        );
      }
      const mat = `mat${n}`;
      if (op === '*') {
        lines.push(`${mat} ${name}(${mat} a, ${mat} b) { return a * b; }`);
        lines.push(`${v} ${name}(${mat} a, ${v} b) { return a * b; }`);
        lines.push(`${v} ${name}(${v} a, ${mat} b) { return a * b; }`);
        lines.push(`${mat} ${name}(${mat} a, float b) { return a * b; }`);
        lines.push(`${mat} ${name}(float a, ${mat} b) { return a * b; }`);
      } else if (op === '+' || op === '-') {
        lines.push(`${mat} ${name}(${mat} a, ${mat} b) { return a ${op} b; }`);
      } else {
        lines.push(`${mat} ${name}(${mat} a, float b) { return a / b; }`);
      }
    }
  }
  return lines.map((line) => `        ${line}`).join('\n');
}

const MILKDROP_HLSL_PROMOTION_HELPERS = `
        // MilkDrop 2's shader preamble (include.fx) defines these, so preset
        // bodies use them undeclared. Note M_PI_2 is 2*pi, not C's pi/2.
        // Missing, they were hoisted as zero uniforms and angle math such as
        // cotc-royal-mashup-59's \`ang * M_INV_PI_2\` collapsed to a constant.
        #define M_PI 3.14159265359
        #define M_PI_2 6.28318530718
        #define M_INV_PI_2 0.159154943091895
        float milkdropLerp(float a, float b, float t) { return mix(a, b, t); }
        vec2 milkdropLerp(vec2 a, vec2 b, float t) { return mix(a, b, t); }
        vec2 milkdropLerp(vec2 a, vec2 b, vec2 t) { return mix(a, b, t); }
        vec2 milkdropLerp(vec2 a, float b, float t) { return mix(a, vec2(b), t); }
        vec2 milkdropLerp(float a, vec2 b, float t) { return mix(vec2(a), b, t); }
        vec2 milkdropLerp(vec2 a, float b, vec2 t) { return mix(a, vec2(b), t); }
        vec2 milkdropLerp(float a, vec2 b, vec2 t) { return mix(vec2(a), b, t); }
        vec2 milkdropLerp(float a, float b, vec2 t) { return mix(vec2(a), vec2(b), t); }
        vec3 milkdropLerp(vec3 a, vec3 b, float t) { return mix(a, b, t); }
        vec3 milkdropLerp(vec3 a, vec3 b, vec3 t) { return mix(a, b, t); }
        vec3 milkdropLerp(vec3 a, float b, float t) { return mix(a, vec3(b), t); }
        vec3 milkdropLerp(float a, vec3 b, float t) { return mix(vec3(a), b, t); }
        vec3 milkdropLerp(vec3 a, float b, vec3 t) { return mix(a, vec3(b), t); }
        vec3 milkdropLerp(float a, vec3 b, vec3 t) { return mix(vec3(a), b, t); }
        vec3 milkdropLerp(float a, float b, vec3 t) { return mix(vec3(a), vec3(b), t); }
        vec4 milkdropLerp(vec4 a, vec4 b, float t) { return mix(a, b, t); }
        vec4 milkdropLerp(vec4 a, vec4 b, vec4 t) { return mix(a, b, t); }
        vec4 milkdropLerp(vec4 a, float b, float t) { return mix(a, vec4(b), t); }
        vec4 milkdropLerp(float a, vec4 b, float t) { return mix(vec4(a), b, t); }
        vec4 milkdropLerp(vec4 a, float b, vec4 t) { return mix(a, vec4(b), t); }
        vec4 milkdropLerp(float a, vec4 b, vec4 t) { return mix(vec4(a), b, t); }
        vec4 milkdropLerp(float a, float b, vec4 t) { return mix(vec4(a), vec4(b), t); }

        float milkdropMax(float a, float b) { return max(a, b); }
        vec2 milkdropMax(vec2 a, vec2 b) { return max(a, b); }
        vec2 milkdropMax(vec2 a, float b) { return max(a, b); }
        vec2 milkdropMax(float a, vec2 b) { return max(vec2(a), b); }
        vec3 milkdropMax(vec3 a, vec3 b) { return max(a, b); }
        vec3 milkdropMax(vec3 a, float b) { return max(a, b); }
        vec3 milkdropMax(float a, vec3 b) { return max(vec3(a), b); }
        vec4 milkdropMax(vec4 a, vec4 b) { return max(a, b); }
        vec4 milkdropMax(vec4 a, float b) { return max(a, b); }
        vec4 milkdropMax(float a, vec4 b) { return max(vec4(a), b); }

        float milkdropMin(float a, float b) { return min(a, b); }
        vec2 milkdropMin(vec2 a, vec2 b) { return min(a, b); }
        vec2 milkdropMin(vec2 a, float b) { return min(a, b); }
        vec2 milkdropMin(float a, vec2 b) { return min(vec2(a), b); }
        vec3 milkdropMin(vec3 a, vec3 b) { return min(a, b); }
        vec3 milkdropMin(vec3 a, float b) { return min(a, b); }
        vec3 milkdropMin(float a, vec3 b) { return min(vec3(a), b); }
        vec4 milkdropMin(vec4 a, vec4 b) { return min(a, b); }
        vec4 milkdropMin(vec4 a, float b) { return min(a, b); }
        vec4 milkdropMin(float a, vec4 b) { return min(vec4(a), b); }

        // The base is floored at zero: pow() of a negative base is undefined
        // in GLSL, and MilkDrop bodies feed it signal values that dip below.
        float milkdropPow(float a, float b) { return pow(max(0.0, a), b); }
        vec2 milkdropPow(vec2 a, vec2 b) { return pow(max(vec2(0.0), a), b); }
        vec2 milkdropPow(vec2 a, float b) { return pow(max(vec2(0.0), a), vec2(b)); }
        vec2 milkdropPow(float a, vec2 b) { return pow(vec2(max(0.0, a)), b); }
        vec3 milkdropPow(vec3 a, vec3 b) { return pow(max(vec3(0.0), a), b); }
        vec3 milkdropPow(vec3 a, float b) { return pow(max(vec3(0.0), a), vec3(b)); }
        vec3 milkdropPow(float a, vec3 b) { return pow(vec3(max(0.0, a)), b); }
        vec4 milkdropPow(vec4 a, vec4 b) { return pow(max(vec4(0.0), a), b); }
        vec4 milkdropPow(vec4 a, float b) { return pow(max(vec4(0.0), a), vec4(b)); }
        vec4 milkdropPow(float a, vec4 b) { return pow(vec4(max(0.0, a)), b); }

        // HLSL truncates a vector assigned to a float to its first
        // component (\`float bl = GetBlur2(uv);\`); GLSL rejects it.
        float milkdropScalar(float v) { return v; }
        float milkdropScalar(vec2 v) { return v.x; }
        float milkdropScalar(vec3 v) { return v.x; }
        float milkdropScalar(vec4 v) { return v.x; }

        float milkdropDot(float a, float b) { return a * b; }
        float milkdropDot(vec2 a, vec2 b) { return dot(a, b); }
        float milkdropDot(vec2 a, float b) { return dot(a, vec2(b)); }
        float milkdropDot(float a, vec2 b) { return dot(vec2(a), b); }
        float milkdropDot(vec3 a, vec3 b) { return dot(a, b); }
        float milkdropDot(vec3 a, float b) { return dot(a, vec3(b)); }
        float milkdropDot(float a, vec3 b) { return dot(vec3(a), b); }
        float milkdropDot(vec4 a, vec4 b) { return dot(a, b); }
        float milkdropDot(vec4 a, float b) { return dot(a, vec4(b)); }
        float milkdropDot(float a, vec4 b) { return dot(vec4(a), b); }
        // HLSL relational operators work component-wise and yield a mask of
        // the operands' width (\`left > 0.5\` on a float3 is a float3); GLSL
        // only defines them on scalars. The emitter sends every comparison
        // here, and a scalar pair still gives the old 1.0/0.0.
        float milkdropLt(float a, float b) { return (a < b) ? 1.0 : 0.0; }
        vec2 milkdropLt(vec2 a, vec2 b) { return vec2(lessThan(a, b)); }
        vec2 milkdropLt(vec2 a, float b) { return vec2(lessThan(a, vec2(b))); }
        vec2 milkdropLt(float a, vec2 b) { return vec2(lessThan(vec2(a), b)); }
        vec3 milkdropLt(vec3 a, vec3 b) { return vec3(lessThan(a, b)); }
        vec3 milkdropLt(vec3 a, float b) { return vec3(lessThan(a, vec3(b))); }
        vec3 milkdropLt(float a, vec3 b) { return vec3(lessThan(vec3(a), b)); }
        vec4 milkdropLt(vec4 a, vec4 b) { return vec4(lessThan(a, b)); }
        vec4 milkdropLt(vec4 a, float b) { return vec4(lessThan(a, vec4(b))); }
        vec4 milkdropLt(float a, vec4 b) { return vec4(lessThan(vec4(a), b)); }
        float milkdropLe(float a, float b) { return (a <= b) ? 1.0 : 0.0; }
        vec2 milkdropLe(vec2 a, vec2 b) { return vec2(lessThanEqual(a, b)); }
        vec2 milkdropLe(vec2 a, float b) { return vec2(lessThanEqual(a, vec2(b))); }
        vec2 milkdropLe(float a, vec2 b) { return vec2(lessThanEqual(vec2(a), b)); }
        vec3 milkdropLe(vec3 a, vec3 b) { return vec3(lessThanEqual(a, b)); }
        vec3 milkdropLe(vec3 a, float b) { return vec3(lessThanEqual(a, vec3(b))); }
        vec3 milkdropLe(float a, vec3 b) { return vec3(lessThanEqual(vec3(a), b)); }
        vec4 milkdropLe(vec4 a, vec4 b) { return vec4(lessThanEqual(a, b)); }
        vec4 milkdropLe(vec4 a, float b) { return vec4(lessThanEqual(a, vec4(b))); }
        vec4 milkdropLe(float a, vec4 b) { return vec4(lessThanEqual(vec4(a), b)); }
        float milkdropGt(float a, float b) { return (a > b) ? 1.0 : 0.0; }
        vec2 milkdropGt(vec2 a, vec2 b) { return vec2(greaterThan(a, b)); }
        vec2 milkdropGt(vec2 a, float b) { return vec2(greaterThan(a, vec2(b))); }
        vec2 milkdropGt(float a, vec2 b) { return vec2(greaterThan(vec2(a), b)); }
        vec3 milkdropGt(vec3 a, vec3 b) { return vec3(greaterThan(a, b)); }
        vec3 milkdropGt(vec3 a, float b) { return vec3(greaterThan(a, vec3(b))); }
        vec3 milkdropGt(float a, vec3 b) { return vec3(greaterThan(vec3(a), b)); }
        vec4 milkdropGt(vec4 a, vec4 b) { return vec4(greaterThan(a, b)); }
        vec4 milkdropGt(vec4 a, float b) { return vec4(greaterThan(a, vec4(b))); }
        vec4 milkdropGt(float a, vec4 b) { return vec4(greaterThan(vec4(a), b)); }
        float milkdropGe(float a, float b) { return (a >= b) ? 1.0 : 0.0; }
        vec2 milkdropGe(vec2 a, vec2 b) { return vec2(greaterThanEqual(a, b)); }
        vec2 milkdropGe(vec2 a, float b) { return vec2(greaterThanEqual(a, vec2(b))); }
        vec2 milkdropGe(float a, vec2 b) { return vec2(greaterThanEqual(vec2(a), b)); }
        vec3 milkdropGe(vec3 a, vec3 b) { return vec3(greaterThanEqual(a, b)); }
        vec3 milkdropGe(vec3 a, float b) { return vec3(greaterThanEqual(a, vec3(b))); }
        vec3 milkdropGe(float a, vec3 b) { return vec3(greaterThanEqual(vec3(a), b)); }
        vec4 milkdropGe(vec4 a, vec4 b) { return vec4(greaterThanEqual(a, b)); }
        vec4 milkdropGe(vec4 a, float b) { return vec4(greaterThanEqual(a, vec4(b))); }
        vec4 milkdropGe(float a, vec4 b) { return vec4(greaterThanEqual(vec4(a), b)); }
        float milkdropEq(float a, float b) { return (a == b) ? 1.0 : 0.0; }
        vec2 milkdropEq(vec2 a, vec2 b) { return vec2(equal(a, b)); }
        vec2 milkdropEq(vec2 a, float b) { return vec2(equal(a, vec2(b))); }
        vec2 milkdropEq(float a, vec2 b) { return vec2(equal(vec2(a), b)); }
        vec3 milkdropEq(vec3 a, vec3 b) { return vec3(equal(a, b)); }
        vec3 milkdropEq(vec3 a, float b) { return vec3(equal(a, vec3(b))); }
        vec3 milkdropEq(float a, vec3 b) { return vec3(equal(vec3(a), b)); }
        vec4 milkdropEq(vec4 a, vec4 b) { return vec4(equal(a, b)); }
        vec4 milkdropEq(vec4 a, float b) { return vec4(equal(a, vec4(b))); }
        vec4 milkdropEq(float a, vec4 b) { return vec4(equal(vec4(a), b)); }
        float milkdropNe(float a, float b) { return (a != b) ? 1.0 : 0.0; }
        vec2 milkdropNe(vec2 a, vec2 b) { return vec2(notEqual(a, b)); }
        vec2 milkdropNe(vec2 a, float b) { return vec2(notEqual(a, vec2(b))); }
        vec2 milkdropNe(float a, vec2 b) { return vec2(notEqual(vec2(a), b)); }
        vec3 milkdropNe(vec3 a, vec3 b) { return vec3(notEqual(a, b)); }
        vec3 milkdropNe(vec3 a, float b) { return vec3(notEqual(a, vec3(b))); }
        vec3 milkdropNe(float a, vec3 b) { return vec3(notEqual(vec3(a), b)); }
        vec4 milkdropNe(vec4 a, vec4 b) { return vec4(notEqual(a, b)); }
        vec4 milkdropNe(vec4 a, float b) { return vec4(notEqual(a, vec4(b))); }
        vec4 milkdropNe(float a, vec4 b) { return vec4(notEqual(vec4(a), b)); }

        // HLSL constructors take any split of components across arguments
        // (\`float3(uv, z)\`, \`float4(uv, 0, 1)\`); which argument is the
        // vector is a type question the emitter cannot answer from text, so
        // these overloads let the GLSL compiler pick. An all-scalar short
        // call pads with zeros, as the emitter used to.
        vec3 milkdropVec3(vec2 a, float b) { return vec3(a, b); }
        vec3 milkdropVec3(float a, vec2 b) { return vec3(a, b); }
        vec3 milkdropVec3(float a, float b) { return vec3(a, b, 0.0); }
        vec4 milkdropVec4(vec2 a, vec2 b) { return vec4(a, b); }
        vec4 milkdropVec4(vec3 a, float b) { return vec4(a, b); }
        vec4 milkdropVec4(float a, vec3 b) { return vec4(a, b); }
        vec4 milkdropVec4(float a, float b) { return vec4(a, b, 0.0, 0.0); }
        vec4 milkdropVec4(vec2 a, float b, float c) { return vec4(a, b, c); }
        vec4 milkdropVec4(float a, vec2 b, float c) { return vec4(a, b, c); }
        vec4 milkdropVec4(float a, float b, vec2 c) { return vec4(a, b, c); }
        vec4 milkdropVec4(float a, float b, float c) { return vec4(a, b, c, 0.0); }

${buildMilkdropArithmeticHelpers()}
`;

// Aux-texture sampling and the control-driven feedback warp are needed by
// both the feedback-blend pass (warp-texture displacement, legacy warp) and
// the composite pass (overlay/comp-body sampling), so they live in one
// shared chunk instead of drifting apart as duplicates.
export const MILKDROP_AUX_SAMPLING_HELPERS = `
        // MilkDrop 2's shader preamble ships lum(), so preset bodies call it
        // without ever declaring it — the same gap that made GetPixel/GetBlur
        // blank the cream-of-the-crop library. Its weights are MilkDrop's own,
        // confirmed against the vendored butterchurn corpus, where the same
        // expression appears inlined as dot(rgb, vec3(0.32, 0.49, 0.29)).
        //
        // The scalar overload matches HLSL, not intuition: there a float
        // argument promotes to float3 before the dot, so lum(x) is x * 1.10.
        float lum(vec3 v) { return dot(v, vec3(0.32, 0.49, 0.29)); }
        float lum(vec4 v) { return lum(v.xyz); }
        float lum(float v) { return v * 1.10; }

        vec2 sampleUv(vec2 uv, float wrapMode) {
          return wrapMode > 0.5 ? fract(uv) : clamp(uv, 0.0, 1.0);
        }
        // tex2D(sampler, float3/float4) reads the coordinate's .xy in HLSL
        // (\`tex2D(sampler_main, ret)\` with a float3 ret is common in
        // feedback presets); GLSL has no such truncation.
        vec2 sampleUv(vec3 uv, float wrapMode) { return sampleUv(uv.xy, wrapMode); }
        vec2 sampleUv(vec4 uv, float wrapMode) { return sampleUv(uv.xy, wrapMode); }
        vec2 sampleUv(float uv, float wrapMode) { return sampleUv(vec2(uv), wrapMode); }

        // Zoom divisor floor that keeps the sign: zoom = -1 (zoomexp 1) is
        // MilkDrop's point mirror through the centre, and max(zoom, 0.0001)
        // turned it into a 10000x magnification of the centre pixel. Same
        // rule as floorWarpZoomDivisor (warp-sample-transform.ts).
        float signedZoomDivisor(float zoomValue) {
          return zoomValue < 0.0 ? min(zoomValue, -0.0001) : max(zoomValue, 0.0001);
        }

        vec4 sampleAuxTexture2d(float source, vec2 uv) {
          if (source < 0.5) {
            return vec4(0.5, 0.5, 0.5, 1.0);
          }
          if (source < 1.5) {
            return texture2D(noiseTex, uv);
          }
          if (source < 2.5) {
            return texture2D(simplexTex, uv);
          }
          if (source < 3.5) {
            return texture2D(voronoiTex, uv);
          }
          if (source < 4.5) {
            return texture2D(auraTex, uv);
          }
          if (source < 5.5) {
            return texture2D(causticsTex, uv);
          }
          if (source < 6.5) {
            return texture2D(patternTex, uv);
          }
          if (source < 7.5) {
            return texture2D(fractalTex, uv);
          }
          if (source < 8.5) {
            return texture2D(videoTex, uv);
          }
          if (source < 9.5) {
            return texture2D(perlinTex, uv);
          }
          if (source < 10.5) {
            return texture2D(noiseLqTex, uv);
          }
          if (source < 11.5) {
            return texture2D(noisevolTex, uv);
          }
          return vec4(0.5, 0.5, 0.5, 1.0);
        }

        vec2 atlasSliceUv(vec2 uv, float sliceIndex) {
          vec2 localUv = mix(vec2(0.01), vec2(0.99), fract(uv));
          float gridSize = ${AUX_TEXTURE_ATLAS_GRID_SIZE.toFixed(1)};
          vec2 tileSize = vec2(1.0 / gridSize);
          float column = mod(sliceIndex, gridSize);
          float row = floor(sliceIndex / gridSize);
          return (vec2(column, row) + localUv) * tileSize;
        }

        vec4 sampleAuxTexture(float source, float sampleDimension, vec2 uv, float sliceZ) {
          vec2 wrappedUv = fract(uv);
          if (sampleDimension < 0.5) {
            return sampleAuxTexture2d(source, wrappedUv);
          }
          float sliceCount = ${AUX_TEXTURE_ATLAS_SLICE_COUNT.toFixed(1)};
          float wrappedSliceZ = fract(sliceZ);
          float scaledSlice = wrappedSliceZ * sliceCount;
          float sliceIndexA = mod(floor(scaledSlice), sliceCount);
          float sliceIndexB = mod(sliceIndexA + 1.0, sliceCount);
          float sliceBlend = fract(scaledSlice);
          float edgeMargin = 0.02;
          if (sliceBlend < edgeMargin) {
            return sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexA));
          }
          if (sliceBlend > 1.0 - edgeMargin) {
            return sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexB));
          }
          vec4 sliceA = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexA));
          vec4 sliceB = sampleAuxTexture2d(source, atlasSliceUv(wrappedUv, sliceIndexB));
          return mix(sliceA, sliceB, sliceBlend);
        }
${MILKDROP_HLSL_PROMOTION_HELPERS}
`;

// The control-driven feedback warp is shared by the warp pass and the
// feedback-blend pass, and by the WebGPU feedback node, so every stage warps
// with identical math. The warp pass must not define its own variant here —
// divergent formulas made the feedback chain and the fresh-scene sample
// disagree and drove WebGL away from WebGPU.

export const MILKDROP_FEEDBACK_WARP_HELPER = `
        vec2 applyFeedbackWarp(vec2 uv, float amount, float rotationAmount) {
          // Zero warp + zero rotation is an identity polar round-trip; skip
          // the atan/sin/cos entirely. Both inputs are uniform-driven, so the
          // branch is coherent across the whole pass.
          if (abs(amount) < 0.000001 && abs(rotationAmount) < 0.000001) {
            return uv;
          }
          vec2 centered = uv - 0.5;
          float radius = length(centered);
          float angle = atan(centered.y, centered.x);
          float spiral = sin(radius * 18.0 - angle * 4.0) * amount * 0.08;
          angle += spiral + rotationAmount * 0.22;
          radius *= 1.0 + cos(angle * 3.0 + radius * 10.0) * amount * 0.05;
          return vec2(cos(angle), sin(angle)) * radius + 0.5;
        }
`;

/**
 * Builds this frame's internal image — the warped previous frame with fresh
 * geometry on top — which is what feeds the next frame's warp pass. MilkDrop
 * never feeds the comp shader's output back into the loop; keeping this
 * blend in its own pass lets the composite pass stay display-only.
 */
/**
 * Warp-mesh pass. Vertex positions are the transformed lattice and the uvs are
 * where each vertex reads from the previous frame, so an arbitrary per-pixel
 * warp is expressed by the geometry rather than by uniforms the fragment
 * shader would have to re-derive. This is how MilkDrop itself warps.
 */
// The gather lattice: each vertex sits at its own lattice position and
// carries the coordinate MilkDrop samples the previous frame from there.
// Rasterised, that is a per-pixel "where does this pixel read from" map — the
// \`uv\` a warp shader sees. The scatter mesh below serves presets without one.
export const MILKDROP_WARP_UV_VERTEX_SHADER = `
        attribute vec2 sampleUvAttr;
        varying vec2 vSampleUv;
        void main() {
          vSampleUv = sampleUvAttr;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `;

export const MILKDROP_WARP_UV_FRAGMENT_SHADER = `
        varying vec2 vSampleUv;
        void main() {
          gl_FragColor = vec4(vSampleUv, 0.0, 1.0);
        }
      `;

export const MILKDROP_WARP_MESH_VERTEX_SHADER = `
        attribute vec2 warpUvAttr;
        varying vec2 vWarpUv;
        void main() {
          vWarpUv = warpUvAttr;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `;

export const MILKDROP_WARP_MESH_FRAGMENT_SHADER = `
        uniform sampler2D previousTex;
        uniform float textureWrap;
        varying vec2 vWarpUv;
        void main() {
          vec2 uv = textureWrap > 0.5 ? fract(vWarpUv) : clamp(vWarpUv, 0.0, 1.0);
          gl_FragColor = vec4(texture2D(previousTex, uv).rgb, 1.0);
        }
      `;

export const MILKDROP_FEEDBACK_BLEND_FRAGMENT_SHADER = `
        uniform sampler2D currentTex;
        uniform sampler2D warpTex;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform sampler2D noiseLqTex;
        uniform sampler2D noisevolTex;
        uniform float videoEchoAlpha;
        uniform float textureWrap;
        uniform float warpScale;
        uniform float offsetX;
        uniform float offsetY;
        uniform float rotation;
        uniform float zoomMul;
        uniform float feedbackSoftness;
        uniform float decay;
        uniform float hasDirectWarp;
        uniform vec2 texelSize;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        varying vec2 vUv;
${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_FEEDBACK_WARP_HELPER}
        void main() {
          vec2 centeredUv = vUv - 0.5;
          // Sampling coordinates must invert the intended image transform
          // (rotate backward to find where displayed content came from), so
          // this uses -rotation to make the image visually rotate by +rot,
          // matching the CPU/GPU mesh and motion-vector transform direction.
          float rotSin = -sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(
            centeredUv.x * rotCos - centeredUv.y * rotSin,
            centeredUv.x * rotSin + centeredUv.y * rotCos
          );
          vec2 transformedUv = rotatedUv / signedZoomDivisor(zoomMul) + vec2(offsetX, offsetY);

          vec2 currentUv = hasDirectWarp > 0.5
            ? transformedUv + 0.5
            : applyFeedbackWarp(transformedUv + 0.5, warpScale, rotation);
          if (warpTextureSource > 0.5 && warpTextureAmount > 0.0001) {
            vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;
            vec2 warpVector =
              sampleAuxTexture(
                warpTextureSource,
                warpTextureSampleDimension,
                warpUv,
                warpTextureVolumeSliceZ
              ).rg - 0.5;
            currentUv += warpVector * warpTextureAmount * 0.12;
          }
          // Direct-warp presets draw fresh geometry over the already-warped
          // previous frame, so the scene must not be re-warped here.
          vec2 sceneUv = hasDirectWarp > 0.5 ? vUv : currentUv;
          vec4 current = texture2D(currentTex, sampleUv(sceneUv, textureWrap));
          vec4 previous = texture2D(warpTex, sampleUv(vUv, textureWrap));
          vec3 previousColor = previous.rgb;
          if (feedbackSoftness > ${MILKDROP_FEEDBACK_SOFTNESS_THRESHOLD.toFixed(2)}) {
            vec2 off = texelSize * (0.75 + feedbackSoftness * 0.5);
            vec3 softened = (
              previous.rgb * 4.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, 0.0), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, 0.0), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(0.0, off.y), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv - vec2(0.0, off.y), textureWrap)).rgb * 2.0 +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv + vec2(off.x, -off.y), textureWrap)).rgb +
              texture2D(warpTex, sampleUv(vUv - vec2(off.x, -off.y), textureWrap)).rgb
            ) / 16.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * ${MILKDROP_FEEDBACK_BLUR_BLEND_SCALE.toFixed(2)}, 0.0, ${MILKDROP_FEEDBACK_BLUR_BLEND_CAP.toFixed(1)})
            );
          }
          // Apply decay to the previous frame color so history dissipates over time.
          previousColor *= decay;
          // The internal frame is the warped, decayed previous frame with this
          // frame's geometry drawn over it. Control-driven presets used to
          // blend the two by videoEchoAlpha instead, so a preset without video
          // echo (alpha 0) discarded its history outright: fDecay did nothing
          // and no warp variable could accumulate, because there was never
          // anything left to move. Video echo is a display-stage effect in
          // MilkDrop, not the mechanism that carries feedback.
          //
          // The scene colour arrives premultiplied — three.js blends src.rgb
          // times src.a into a target that starts at zero — so this is a
          // straight over, not a mix (a mix darkens covered pixels twice).
          float coverage = clamp(current.a, 0.0, 1.0);
          vec3 color = hasDirectWarp > 0.5
            ? previousColor + current.rgb
            : previousColor * (1.0 - coverage) + current.rgb;
          // MilkDrop's internal buffer is 8-bit, so every frame it carries is
          // implicitly clamped to [0,1]. Ours is half-float for decay
          // precision, which removed that clamp: a sharpening warp such as
          // Geiss's reaction-diffusion \`ret += (ret - GetBlur1(uv)) * 0.3\`
          // is bounded in MilkDrop but grew without limit here, and the blur
          // spread it until six cotc presets rendered solid white. Clamping
          // the value that feeds the next frame restores the bound without
          // giving up half-float's sub-1/255 decay steps.
          gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
      `;

export const MILKDROP_BASE_COMPOSITE_FRAGMENT_SHADER = `
        uniform sampler2D internalTex;
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform sampler2D noiseLqTex;
        uniform sampler2D noisevolTex;
        uniform sampler2D audioTex;
        uniform sampler2D warpTex;
        uniform sampler2D blur1Tex;
        uniform sampler2D blur2Tex;
        uniform sampler2D blur3Tex;
        uniform float scale1;
        uniform float bias1;
        uniform float scale2;
        uniform float bias2;
        uniform float scale3;
        uniform float bias3;
        uniform float videoEchoAlpha;
        uniform float videoEchoZoom;
        uniform float videoEchoOrientation;
        uniform float brighten;
        uniform float darken;
        uniform float darkenCenter;
        uniform float solarize;
        uniform float invert;
        uniform float redBlueStereo;
        uniform float gammaAdj;
        uniform float textureWrap;
        uniform float warpScale;
        uniform float offsetX;
        uniform float offsetY;
        uniform float rotation;
        uniform float zoomMul;
        uniform float saturation;
        uniform float contrast;
        uniform vec3 colorScale;
        uniform float hueShift;
        uniform float brightenBoost;
        uniform float invertBoost;
        uniform float solarizeBoost;
        uniform float vignette;
        uniform float chromaticAberration;
        uniform vec3 tint;
        uniform float feedbackSoftness;
        uniform float currentFrameBoost;
        uniform float overlayTextureSource;
        uniform float overlayTextureMode;
        uniform float overlayTextureSampleDimension;
        uniform float overlayTextureInvert;
        uniform float overlayTextureAmount;
        uniform vec2 overlayTextureScale;
        uniform vec2 overlayTextureOffset;
        uniform float overlayTextureVolumeSliceZ;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        uniform float signalBass;
        uniform float signalMid;
        uniform float signalTreb;
        uniform float signalBassAtt;
        uniform float signalMidAtt;
        uniform float signalTrebAtt;
        uniform float signalPercussive;
        uniform float signalHarmonic;
        uniform float signalPercussiveLow;
        uniform float signalPercussiveMid;
        uniform float signalPercussiveHigh;
        uniform float signalPercussiveRatio;
        uniform float signalBeat;
        uniform float signalBeatPulse;
        uniform float signalEnergy;
        uniform float signalTime;
        uniform float signalFrame;
        uniform float signalFps;
        uniform float decay;
${MILKDROP_SHADER_BUILTIN_DECLARATIONS}
        uniform float hasDirectWarp;
        uniform vec2 texelSize;
        varying vec2 vUv;

        vec3 hueRotate(vec3 color, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          mat3 mat = mat3(
            0.213 + c * 0.787 - s * 0.213,
            0.715 - c * 0.715 - s * 0.715,
            0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143,
            0.715 + c * 0.285 + s * 0.140,
            0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787,
            0.715 - c * 0.715 + s * 0.715,
            0.072 + c * 0.928 + s * 0.072
          );
          return clamp(mat * color, 0.0, 1.0);
        }

        vec3 applySaturation(vec3 color, float amount) {
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          return mix(vec3(luminance), color, amount);
        }

        vec3 applyContrast(vec3 color, float amount) {
          return clamp((color - 0.5) * amount + 0.5, 0.0, 1.0);
        }

        float milkdropTrunc(float value) {
          return sign(value) * floor(abs(value));
        }

        float milkdropIntMod(float left, float right) {
          float l = milkdropTrunc(left);
          float r = milkdropTrunc(right);
          if (abs(r) <= 0.000001) return 0.0;
          return l - r * milkdropTrunc(l / r);
        }

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p, int octaves) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * noise(p * frequency);
            amplitude *= 0.5;
            frequency *= 2.0;
          }
          return value;
        }

${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_NOISE_VOLUME_HELPERS}
${MILKDROP_VIDEO_ECHO_HELPER}
        // MilkDrop's comp shader reads sampler_main as the current
        // *composited* frame — the internal image the feedback-blend pass
        // wrote this frame (warped feedback + geometry). Injected comp
        // bodies have their sampler_main samples rewritten to this helper.
        vec4 sampleCompFrame(vec2 sampleCoord) {
          return texture2D(internalTex, sampleUv(sampleCoord, textureWrap));
        }

        // --- DIRECT_WARP_START ---
        // --- DIRECT_WARP_END ---

        // --- DIRECT_COMP_START ---
        // --- DIRECT_COMP_END ---

        void main() {
          // The feedback-blend pass already built this frame's internal
          // image (warped feedback + geometry). This pass is display-only,
          // matching MilkDrop: nothing computed here feeds the next frame.
          vec3 color = texture2D(internalTex, sampleUv(vUv, textureWrap)).rgb;
          color = applyVideoEcho(
            internalTex,
            vUv,
            color,
            videoEchoAlpha,
            videoEchoZoom,
            videoEchoOrientation,
            textureWrap
          );
          // Uniform branch: skip the sin/cos + mat3 build when no hue shift
          // is active (the common case) — mobile GPUs run transcendentals on
          // a slow special-function unit.
          if (abs(hueShift) > 0.0001) {
            color = hueRotate(color, hueShift);
          }
          color = applySaturation(color, saturation);
          color = applyContrast(color, contrast);
          color *= colorScale;
          color *= tint;

          vec2 uv = vUv;
          vec2 uv_orig = vUv;
          vec3 ret = color;
          float rad = length(vec2((uv.x - 0.5) * aspect.x, (uv.y - 0.5) * aspect.y)) * 2.0;
          float ang = atan(uv.y - 0.5, uv.x - 0.5);

          // --- DIRECT_COMP_START ---
          // --- DIRECT_COMP_END ---

          color = ret;
          bool overlayReplace = overlayTextureMode > 0.5 && overlayTextureMode < 1.5;
          bool overlayBlend = overlayTextureMode >= 1.5 && overlayTextureAmount > 0.0001;
          if (overlayTextureSource > 0.5 && (overlayReplace || overlayBlend)) {
            vec2 overlayUv = vUv * overlayTextureScale + overlayTextureOffset;
            vec3 overlayColor = sampleAuxTexture(
              overlayTextureSource,
              overlayTextureSampleDimension,
              overlayUv,
              overlayTextureVolumeSliceZ
            ).rgb;
            if (overlayTextureInvert > 0.5) {
              overlayColor = 1.0 - overlayColor;
            }
            float amount = clamp(overlayTextureAmount, 0.0, 1.5);
            if (overlayTextureMode < 1.5) {
              color = overlayColor;
            } else if (overlayTextureMode < 2.5) {
              color = mix(color, overlayColor, clamp(amount, 0.0, 1.0));
            } else if (overlayTextureMode < 3.5) {
              color = min(vec3(1.0), color + overlayColor * amount);
            } else if (overlayTextureMode < 4.5) {
              color *= mix(vec3(1.0), overlayColor, clamp(amount, 0.0, 1.0));
            } else {
              color = max(vec3(0.0), color - overlayColor * amount);
            }
          }
          // MilkDrop's own curves, in MilkDrop's order (gamma already applied
          // above): brighten = sqrt, darken = square, solarize = c(1-c)4,
          // invert = 1-c. Verified against Butterchurn's composite shader.
          //
          // Each was previously an approximation that changed the shape of the
          // curve, and solarize's was wrong at the black end in a way that
          // showed: abs(c - 0.5) * 2 maps 0 to WHITE, so any preset with
          // bSolarize on a dark frame rendered as a white field. MilkDrop's
          // curve maps 0 to 0 and peaks at c=0.5.
          //
          // The boosts stay as the mix amount so the audio-reactive
          // modulation still rides on top of the correct curve; a plain flag
          // (amount 1) now reproduces MilkDrop exactly.
          if (brighten > 0.01 || brightenBoost > 0.01) {
            float amount = clamp(max(brighten, brightenBoost), 0.0, 1.0);
            color = mix(color, sqrt(max(color, vec3(0.0))), amount);
          }
          if (darken > 0.5) {
            color = color * color;
          }
          if (solarize > 0.01 || solarizeBoost > 0.01) {
            float amount = clamp(max(solarize, solarizeBoost), 0.0, 1.0);
            color = mix(color, color * (1.0 - color) * 4.0, amount);
          }
          if (invert > 0.01 || invertBoost > 0.01) {
            float amount = clamp(max(invert, invertBoost), 0.0, 1.0);
            color = mix(color, 1.0 - color, amount);
          }
          if (darkenCenter > 0.5) {
            float centerDist = length(vUv - vec2(0.5));
            float centerMask = clamp(1.0 - centerDist * 1.4, 0.0, 1.0);
            color = mix(color, color * 0.97, smoothstep(0.0, 0.35, centerMask));
          }
          if (vignette > 0.01) {
            float dist = length(vUv - vec2(0.5));
            float vig = clamp(1.0 - dist * (1.0 + vignette * 0.8), 0.0, 1.0);
            color *= mix(vec3(1.0), vec3(vig), clamp(vignette, 0.0, 1.0));
          }
          if (chromaticAberration > 0.01) {
            float amount = clamp(chromaticAberration, 0.0, 1.0);
            vec2 dir = (vUv - vec2(0.5)) * amount * 0.02;
            float r = texture2D(internalTex, sampleUv(vUv + dir, textureWrap)).r;
            float b = texture2D(internalTex, sampleUv(vUv - dir, textureWrap)).b;
            color = vec3(r, color.g, b);
          }
          if (redBlueStereo > 0.5) {
            float stereoOffset = 0.003 + signalEnergy * 0.003;
            vec2 stereoShift = vec2(stereoOffset, 0.0);
            vec3 leftColor = texture2D(internalTex, sampleUv(vUv - stereoShift, textureWrap)).rgb;
            vec3 rightColor = texture2D(internalTex, sampleUv(vUv + stereoShift, textureWrap)).rgb;
            color = mix(color, vec3(leftColor.r, rightColor.g, rightColor.b), 0.85);
          }
          // Gamma stays a power at the END of the chain. Butterchurn's
          // composite reads as ret *= gammaAdj immediately after the echo,
          // and moving it there to match cost 260-compshader-noise_lq
          // 0.337 -> 0.916 mismatch against a 0.002-wide noise band, plus
          // 261-compshader and rovastar-parallel-universe. The exponent form
          // is what projectM was MEASURED to do -- see the note on
          // DEFAULT_PROJECTM_GAMMA_ADJ in compiler/default-state.ts, which
          // warns that three attempts to derive this from renderer source got
          // it wrong. projectM, not Butterchurn, is this repo's oracle.
          if (abs(gammaAdj - 1.0) > 0.0001) {
            color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `;

export const MILKDROP_WARP_FRAGMENT_SHADER = `
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform sampler2D warpTex;
        uniform sampler2D blur1Tex;
        uniform sampler2D blur2Tex;
        uniform sampler2D blur3Tex;
        uniform vec2 texelSize;
        uniform sampler2D noiseTex;
        uniform sampler2D simplexTex;
        uniform sampler2D voronoiTex;
        uniform sampler2D auraTex;
        uniform sampler2D causticsTex;
        uniform sampler2D patternTex;
        uniform sampler2D fractalTex;
        uniform sampler2D videoTex;
        uniform sampler2D perlinTex;
        uniform sampler2D noiseLqTex;
        uniform sampler2D noisevolTex;
        uniform sampler2D audioTex;
        uniform float scale1;
        uniform float bias1;
        uniform float scale2;
        uniform float bias2;
        uniform float scale3;
        uniform float bias3;
        uniform float warpScale;
        uniform float zoom;
        uniform float zoomMul;
        uniform float rotation;
        uniform float offsetX;
        uniform float offsetY;
        uniform float textureWrap;
        uniform float warpTextureSource;
        uniform float warpTextureSampleDimension;
        uniform float warpTextureAmount;
        uniform vec2 warpTextureScale;
        uniform vec2 warpTextureOffset;
        uniform float warpTextureVolumeSliceZ;
        uniform float hasDirectWarp;
        uniform sampler2D warpUvTex;
        uniform float hasWarpUvField;
        uniform float signalBass;
        uniform float signalMid;
        uniform float signalTreb;
        uniform float signalBassAtt;
        uniform float signalMidAtt;
        uniform float signalTrebAtt;
        uniform float signalPercussive;
        uniform float signalHarmonic;
        uniform float signalPercussiveLow;
        uniform float signalPercussiveMid;
        uniform float signalPercussiveHigh;
        uniform float signalPercussiveRatio;
        uniform float signalBeat;
        uniform float signalBeatPulse;
        uniform float signalEnergy;
        uniform float signalTime;
        uniform float signalFrame;
        uniform float signalFps;
        uniform float videoEchoOrientation;
${MILKDROP_SHADER_BUILTIN_DECLARATIONS}
        varying vec2 vUv;

        float sq(float x) { return x * x; }
        float cube(float x) { return x * x * x; }
        float sigmoid(float x, float sharpness) { return 1.0 / (1.0 + exp(-x * sharpness)); }
        float between(float val, float low, float high) { return step(low, val) * step(val, high); }
        float above(float val, float threshold) { return step(threshold, val); }
        float below(float val, float threshold) { return 1.0 - step(threshold, val); }
        float equalF(float a, float b) { return 1.0 - step(0.0001, abs(a - b)); }
        float milkdropTrunc(float value) { return sign(value) * floor(abs(value)); }
        float milkdropIntMod(float left, float right) {
          float l = milkdropTrunc(left);
          float r = milkdropTrunc(right);
          if (abs(r) <= 0.000001) return 0.0;
          return l - r * milkdropTrunc(l / r);
        }
        float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 uv) { vec2 i = floor(uv); vec2 f = fract(uv); f = f*f*(3.0-2.0*f); return mix(mix(rand(i+vec2(0.0,0.0)), rand(i+vec2(1.0,0.0)), f.x), mix(rand(i+vec2(0.0,1.0)), rand(i+vec2(1.0,1.0)), f.x), f.y); }

${MILKDROP_AUX_SAMPLING_HELPERS}
${MILKDROP_NOISE_VOLUME_HELPERS}
${MILKDROP_FEEDBACK_WARP_HELPER}

        // --- DIRECT_WARP_GLOBALS_START ---
        // --- DIRECT_WARP_GLOBALS_END ---

        void main() {
          vec2 centeredUv = vUv - 0.5;
          // See the composite pass's identical comment: sampling coords
          // invert the rotation direction relative to point transforms.
          float rotSin = -sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(centeredUv.x * rotCos - centeredUv.y * rotSin, centeredUv.x * rotSin + centeredUv.y * rotCos);
          vec2 transformedUv = rotatedUv / signedZoomDivisor(zoomMul) + vec2(offsetX, offsetY);

          // MilkDrop's warp-shader \`uv\` is the per-vertex warped coordinate:
          // per-frame and per-pixel zoom/rot/dx/dy/sx/sy, interpolated across
          // the mesh. When the preset has per-pixel motion the gather mesh
          // was rasterised into warpUvTex; otherwise the per-frame uniforms
          // are the whole transform.
          vec2 uv = hasWarpUvField > 0.5
            ? texture2D(warpUvTex, vUv).xy
            : transformedUv + 0.5;
          vec2 uv_orig = vUv;
          vec3 ret = texture2D(currentTex, sampleUv(uv, textureWrap)).rgb;
          float rad = length(vec2((uv.x - 0.5) * aspect.x, (uv.y - 0.5) * aspect.y)) * 2.0;
          float ang = atan(uv.y - 0.5, uv.x - 0.5);

          // --- DIRECT_WARP_START ---
          // --- DIRECT_WARP_END ---

          if (hasDirectWarp > 0.5) {
            // The injected warp body computed this fragment's warped feedback
            // sample into ret; it IS this pass's output.
            gl_FragColor = vec4(ret, 1.0);
            return;
          }

          vec2 currentUv = hasDirectWarp > 0.5
            ? transformedUv + 0.5
            : applyFeedbackWarp(transformedUv + 0.5, warpScale, rotation);
          vec2 prevUv = hasDirectWarp > 0.5
            ? (currentUv - 0.5) / signedZoomDivisor(zoom) + 0.5
            : applyFeedbackWarp(
                (currentUv - 0.5) / signedZoomDivisor(zoom) + 0.5,
                warpScale * 0.8,
                rotation * 0.6
              );
          if (warpTextureSource > 0.5 && warpTextureAmount > 0.0001) {
            vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;
            vec2 warpVector =
              sampleAuxTexture(
                warpTextureSource,
                warpTextureSampleDimension,
                warpUv,
                warpTextureVolumeSliceZ
              ).rg - 0.5;
            prevUv += warpVector * warpTextureAmount * 0.08;
          }
          gl_FragColor = texture2D(previousTex, sampleUv(prevUv, textureWrap));
        }
      `;
