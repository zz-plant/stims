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
  fw_noise_hq: 'noise',
  noise_lq: 'noise',
  noise_hq: 'noise',
  fw_noisevol: 'simplex',
  fw_noisevol_lq: 'simplex',
  fw_noisevol_hq: 'simplex',
  noisevol: 'simplex',
  noisevol_lq: 'simplex',
  noisevol_hq: 'simplex',
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
