/**
 * Harmonic/percussive signals exposed to warp and composite shader bodies.
 *
 * The CPU VM (`vm/shared.ts`) seeds the same values before audio arrives:
 * the relative energies sit at 1 (the MilkDrop-relative scale, where 1 means
 * "at the track's own average") and `percussive_ratio` at 0.5. A shader that
 * reads them on frame 0 therefore sees exactly what a per-frame equation sees.
 */
export const HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS = {
  signalPercussive: 1,
  signalHarmonic: 1,
  signalPercussiveLow: 1,
  signalPercussiveMid: 1,
  signalPercussiveHigh: 1,
  signalPercussiveRatio: 0.5,
} as const;

export type HarmonicPercussiveShaderUniformName =
  keyof typeof HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS;

export const HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES = Object.keys(
  HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS,
) as HarmonicPercussiveShaderUniformName[];

type UniformHolder = { value: number };

/**
 * Copies the harmonic/percussive block of the composite state onto a uniform
 * bag. Works for both the WebGL `ShaderMaterial.uniforms` map and the WebGPU
 * TSL `uniform()` nodes — both expose a mutable `.value`.
 */
export function applyHarmonicPercussiveUniforms(
  uniforms: Partial<Record<HarmonicPercussiveShaderUniformName, UniformHolder>>,
  state: Partial<
    Record<HarmonicPercussiveShaderUniformName, number | undefined>
  >,
): void {
  for (const name of HARMONIC_PERCUSSIVE_SHADER_UNIFORM_NAMES) {
    const holder = uniforms[name];
    if (!holder) {
      continue;
    }
    const value = state[name];
    holder.value =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : HARMONIC_PERCUSSIVE_SHADER_UNIFORM_DEFAULTS[name];
  }
}
