import type { MilkdropShaderTextureSampler } from './types';

export const MILKDROP_SHADER_TEXTURE_SAMPLERS = new Set<
  MilkdropShaderTextureSampler | 'main'
>([
  'main',
  'none',
  'noise',
  'noise_lq',
  'noisevol',
  'perlin',
  'simplex',
  'voronoi',
  'aura',
  'caustics',
  'pattern',
  'fractal',
  'glyph',
  'organic',
  'video',
  'pw_main',
  'pc_main',
  'fc_main',
  'blur1',
  'blur2',
  'blur3',
]);

const MILKDROP_VOLUME_SHADER_TEXTURE_SAMPLERS =
  new Set<MilkdropShaderTextureSampler>([
    'simplex',
    'noise',
    // noise_lq is a 2D texture in projectM, but presets do call tex3D on it;
    // keeping it here is what lets those lines resolve at all (dropping it
    // made the whole shader read as unsupported-shader-text).
    'noise_lq',
    'noisevol',
    'perlin',
    'voronoi',
    'aura',
    'caustics',
    'pattern',
    'fractal',
    'video',
  ]);

const SHADER_TEXTURE_SAMPLER_ALIASES: Record<
  string,
  MilkdropShaderTextureSampler | 'main'
> = {
  fw_noise_lq: 'noise_lq',
  fw_noise_mq: 'noise',
  fw_noise_hq: 'noise',
  fw_noise: 'noise',
  noise: 'noise',
  noise_lq: 'noise_lq',
  noise_hq: 'noise',
  noise_mq: 'noise',
  fw_noisevol: 'noisevol',
  fw_noisevol_lq: 'noisevol',
  fw_noisevol_mq: 'noisevol',
  fw_noisevol_hq: 'noisevol',
  pw_noisevol: 'noisevol',
  pw_noisevol_lq: 'noisevol',
  pw_noisevol_mq: 'noisevol',
  pw_noisevol_hq: 'noisevol',
  noisevol: 'noisevol',
  noisevol_lq: 'noisevol',
  noisevol_mq: 'noisevol',
  noisevol_hq: 'noisevol',
  fc_main: 'fc_main',
  // MilkDrop names the main-texture samplers by filter and address mode:
  // f/p (filtered/point) x c/w (clamp/wrap). `fw_main` is the plain filtered
  // read of the current frame, which is what `sampler_main` resolves to as
  // well — `shader-analysis.ts` already rewrites both to `currentTex`. Without
  // this entry `resolveDirectShaderSamplerBinding` returned null for the 107
  // bundled presets that sample it, pushing them off the direct WebGPU path.
  fw_main: 'main',
  pw_main: 'pw_main',
  pc_main: 'pc_main',
  sampler_pc_main: 'pc_main',
  sampler_pw_main: 'pw_main',
  sampler_fc_main: 'fc_main',
  pw_noise_lq: 'noise_lq',
  sampler_pw_noise_lq: 'noise',
  // MilkDrop's pw_mcode1 is a matrix-code glyph sheet; the smalltiled_*
  // names are small tileable detail textures. Both map onto the bundled
  // glyph mosaic rather than plain noise/pattern/voronoi stand-ins.
  pw_mcode1: 'glyph',
  smalltiled_electric_nebula: 'glyph',
  smalltiled_colors3: 'glyph',
  smalltiled_ensign_meat: 'glyph',
  smalltiled_lizard_scales: 'glyph',
  fw_clouds: 'perlin',
  clouds2: 'perlin',
  cells: 'voronoi',
  rand00: 'noise',
  rand01: 'noise',
  rand00_smalltiled: 'noise',
  // onefish/manyfish/seaweed/moss1/lichen are photographic organic
  // textures in the original preset packs; the crystal fractal/pattern
  // stand-ins read as crystalline/technical, so route them to the bundled
  // organic mottle texture instead.
  seaweed: 'organic',
  lichen: 'organic',
  moss1: 'organic',
  prayerwheel: 'pattern',
  sunrise: 'pattern',
  paper: 'pattern',
  // Keys are looked up after `normalizeMilkdropShaderSamplerName` lowercases
  // the name, so a camelCased key here would never match.
  anandamidectfree00: 'noise',
  cartunemask1: 'pattern',
  manyfish: 'organic',
  onefish: 'organic',
  sampler_blur1: 'blur1',
  sampler_blur2: 'blur2',
  sampler_blur3: 'blur3',
};

export function normalizeMilkdropShaderSamplerName(
  value: string,
): MilkdropShaderTextureSampler | 'main' | null {
  const normalized = value.trim().toLowerCase();
  const sampler = normalized.startsWith('sampler_')
    ? normalized.slice('sampler_'.length)
    : normalized;
  const canonicalSampler = SHADER_TEXTURE_SAMPLER_ALIASES[sampler] ?? sampler;
  return MILKDROP_SHADER_TEXTURE_SAMPLERS.has(canonicalSampler)
    ? canonicalSampler
    : null;
}

export function isMilkdropShaderSamplerName(
  value: string,
): value is MilkdropShaderTextureSampler | 'main' {
  return MILKDROP_SHADER_TEXTURE_SAMPLERS.has(
    value as MilkdropShaderTextureSampler | 'main',
  );
}

export function isMilkdropVolumeShaderSamplerName(
  value: string,
): value is MilkdropShaderTextureSampler {
  return MILKDROP_VOLUME_SHADER_TEXTURE_SAMPLERS.has(
    value as MilkdropShaderTextureSampler,
  );
}

export type Tex3dSamplerEquivalence = 'not-equivalent' | 'semantic-supported';

export const TEX3D_NOT_EQUIVALENT_SAMPLERS: ReadonlySet<MilkdropShaderTextureSampler> =
  MILKDROP_VOLUME_SHADER_TEXTURE_SAMPLERS;

export function classifyTex3dSamplerEquivalence(
  dimension: string | null | undefined,
  source: string,
): Tex3dSamplerEquivalence {
  // Bundled volume samplers are backed by native Data3DTexture on WebGPU and
  // an interpolated atlas path on WebGL. They are semantically supported;
  // non-volume 2D textures sampled via tex3D are not equivalent to native volume textures.
  if (dimension === '3d' && !isMilkdropVolumeShaderSamplerName(source)) {
    return 'not-equivalent';
  }
  return 'semantic-supported';
}

/**
 * Canonical aux-texture source ids shared by the GLSL aux sampling path
 * (shader-analysis-glsl.ts), the WebGPU direct-sampler binding table
 * (feedback-manager-webgpu-bindings.ts), and the WebGPU aux sampler node
 * (feedback-manager-webgpu-composite.ts). Keeping the ids in one place is
 * what keeps perlin/glyph/organic resolving to their own textures instead
 * of degrading to noise or the neutral fallback on one backend.
 */
export const MILKDROP_SHADER_AUX_TEXTURE_SOURCE_IDS: Readonly<
  Record<string, number>
> = {
  noise: 1,
  simplex: 2,
  voronoi: 3,
  aura: 4,
  caustics: 5,
  pattern: 6,
  fractal: 7,
  video: 8,
  perlin: 9,
  // projectM generates these rather than shipping PNGs: noise_lq is 256x256
  // grayscale white noise and noisevol a 32^3 volume of the same
  // (PerlinNoise.cpp). They must not share the perlin/simplex slots, whose
  // assets are smooth.
  noise_lq: 10,
  noisevol: 11,
  glyph: 12,
  organic: 13,
  blur1: 14,
  blur2: 15,
  blur3: 16,
};

export function getMilkdropShaderAuxTextureSourceId(name: string): number {
  return MILKDROP_SHADER_AUX_TEXTURE_SOURCE_IDS[name.toLowerCase()] ?? 0;
}
