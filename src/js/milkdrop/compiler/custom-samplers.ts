import { MILKDROP_TEXTURE_FILES } from '../feedback-manager-webgpu-composite';
import { normalizeMilkdropShaderSamplerName } from '../shader-samplers.ts';

export type MilkdropCustomSamplerFilter = 'linear' | 'nearest';
export type MilkdropCustomSamplerWrap = 'repeat' | 'clamp';

export type MilkdropCustomSamplerDeclaration = {
  name: string;
  textureFile: string | null;
  filter: MilkdropCustomSamplerFilter;
  wrap: MilkdropCustomSamplerWrap;
};

const BUNDLED_TEXTURE_FILES = new Set<string>([
  ...Object.values(MILKDROP_TEXTURE_FILES),
  'radial_rainbow_gradient.png',
]);

// MilkDrop's rand00–rand15 samplers pick a random file from the textures
// directory on every preset load; the *_smalltiled variants restrict the pick
// to small tileable textures. We approximate with the bundled set: the 3D
// noise atlas is excluded (sampled as 2D it reads as a slice grid), and the
// smalltiled pool keeps only the seamlessly tiling detail textures.
const RAND_TEXTURE_POOL = [
  MILKDROP_TEXTURE_FILES.noise,
  MILKDROP_TEXTURE_FILES.voronoi,
  MILKDROP_TEXTURE_FILES.aura,
  MILKDROP_TEXTURE_FILES.caustics,
  MILKDROP_TEXTURE_FILES.pattern,
  MILKDROP_TEXTURE_FILES.fractal,
  'radial_rainbow_gradient.png',
] as const;

const RAND_SMALLTILED_TEXTURE_POOL = [
  MILKDROP_TEXTURE_FILES.noise,
  MILKDROP_TEXTURE_FILES.voronoi,
  MILKDROP_TEXTURE_FILES.caustics,
  MILKDROP_TEXTURE_FILES.pattern,
  MILKDROP_TEXTURE_FILES.fractal,
] as const;

const RAND_TEXTURE_PATTERN = /^rand\d{2}(?<smalltiled>_smalltiled)?$/u;

const DECLARATION_PATTERN =
  /\b(?:uniform\s+)?(?:sampler2D|sampler3D|Texture2D|Texture3D)\s+(sampler_[A-Za-z_][A-Za-z0-9_]*)\s*;/gu;

// MilkDrop sampler names may carry a filter/address prefix: f/p (filtered vs
// point) x w/c (wrap vs clamp), e.g. `sampler_pw_mcode1`. Unprefixed names
// default to filtered + wrap.
const SAMPLE_MODE_PREFIX_PATTERN = /^(?<filter>[fp])(?<wrap>[wc])_/u;

function stripSamplerPrefix(name: string): string {
  return name.startsWith('sampler_') ? name.slice('sampler_'.length) : name;
}

export function resolveCustomSamplerSampleMode(name: string): {
  filter: MilkdropCustomSamplerFilter;
  wrap: MilkdropCustomSamplerWrap;
} {
  const match = stripSamplerPrefix(name)
    .toLowerCase()
    .match(SAMPLE_MODE_PREFIX_PATTERN);
  return {
    filter: match?.groups?.filter === 'p' ? 'nearest' : 'linear',
    wrap: match?.groups?.wrap === 'c' ? 'clamp' : 'repeat',
  };
}

export function resolveCustomSamplerTextureFile(name: string): string | null {
  const rawTextureName = stripSamplerPrefix(name);
  const randMatch = rawTextureName.toLowerCase().match(RAND_TEXTURE_PATTERN);
  if (randMatch) {
    const pool = randMatch.groups?.smalltiled
      ? RAND_SMALLTILED_TEXTURE_POOL
      : RAND_TEXTURE_POOL;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const normalized = normalizeMilkdropShaderSamplerName(name);
  if (normalized && normalized !== 'main' && normalized !== 'none') {
    const fileName =
      MILKDROP_TEXTURE_FILES[normalized as keyof typeof MILKDROP_TEXTURE_FILES];
    if (fileName && BUNDLED_TEXTURE_FILES.has(fileName)) {
      return fileName;
    }
  }
  const unprefixedTextureName = rawTextureName.replace(
    SAMPLE_MODE_PREFIX_PATTERN,
    '',
  );
  const candidateNames =
    unprefixedTextureName === rawTextureName
      ? [rawTextureName]
      : [rawTextureName, unprefixedTextureName];
  const candidates = candidateNames.flatMap((candidateName) =>
    candidateName.includes('.')
      ? [candidateName]
      : [
          `${candidateName}.png`,
          `${candidateName}.jpg`,
          `${candidateName}.jpeg`,
          `${candidateName}.webp`,
        ],
  );
  return (
    candidates.find((candidate) => BUNDLED_TEXTURE_FILES.has(candidate)) ?? null
  );
}

export function extractCustomSamplerDeclarations(
  shaderText: string | null,
): MilkdropCustomSamplerDeclaration[] {
  if (!shaderText) return [];
  const declarations = new Map<string, MilkdropCustomSamplerDeclaration>();
  for (const match of shaderText.matchAll(DECLARATION_PATTERN)) {
    const name = match[1];
    if (!name) continue;
    declarations.set(name, {
      name,
      textureFile: resolveCustomSamplerTextureFile(name),
      ...resolveCustomSamplerSampleMode(name),
    });
  }
  return [...declarations.values()];
}
