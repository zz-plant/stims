import type { MilkdropShaderTextureSampler } from './types';

export const MILKDROP_SHADER_TEXTURE_SAMPLERS = new Set<
  MilkdropShaderTextureSampler | 'main'
>([
  'main',
  'none',
  'noise',
  'perlin',
  'simplex',
  'voronoi',
  'aura',
  'caustics',
  'pattern',
  'fractal',
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
  fw_noise_lq: 'noise',
  fw_noise_mq: 'noise',
  fw_noise_hq: 'noise',
  fw_noise: 'noise',
  noise: 'noise',
  noise_lq: 'noise',
  noise_hq: 'noise',
  noise_mq: 'noise',
  fw_noisevol: 'simplex',
  fw_noisevol_lq: 'simplex',
  fw_noisevol_hq: 'simplex',
  noisevol: 'simplex',
  noisevol_lq: 'simplex',
  noisevol_hq: 'simplex',
  fc_main: 'fc_main',
  pw_main: 'pw_main',
  pc_main: 'pc_main',
  sampler_pc_main: 'pc_main',
  sampler_pw_main: 'pw_main',
  sampler_fc_main: 'fc_main',
  pw_noise_lq: 'noise',
  sampler_pw_noise_lq: 'noise',
  pw_mcode1: 'noise',
  fw_clouds: 'perlin',
  clouds2: 'perlin',
  cells: 'voronoi',
  rand00: 'noise',
  rand01: 'noise',
  rand00_smalltiled: 'noise',
  seaweed: 'fractal',
  lichen: 'pattern',
  moss1: 'pattern',
  smalltiled_electric_nebula: 'fractal',
  smalltiled_colors3: 'pattern',
  smalltiled_ensign_meat: 'pattern',
  smalltiled_lizard_scales: 'voronoi',
  prayerwheel: 'pattern',
  sunrise: 'pattern',
  paper: 'pattern',
  anandamideCTFree00: 'noise',
  cartunemask1: 'pattern',
  manyfish: 'fractal',
  onefish: 'fractal',
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
  if (dimension === '3d' && isMilkdropVolumeShaderSamplerName(source)) {
    return 'not-equivalent';
  }
  return 'semantic-supported';
}
