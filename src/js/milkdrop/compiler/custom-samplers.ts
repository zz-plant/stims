import { MILKDROP_TEXTURE_FILES } from '../feedback-manager-webgpu-composite';

export type MilkdropCustomSamplerDeclaration = {
  name: string;
  textureFile: string | null;
};

const BUNDLED_TEXTURE_FILES = new Set<string>([
  ...Object.values(MILKDROP_TEXTURE_FILES),
  'radial_rainbow_gradient.png',
]);

const DECLARATION_PATTERN =
  /\buniform\s+sampler2D\s+(sampler_[A-Za-z_][A-Za-z0-9_]*)\s*;/gu;

export function resolveCustomSamplerTextureFile(name: string): string | null {
  const rawTextureName = name.startsWith('sampler_')
    ? name.slice('sampler_'.length)
    : name;
  const candidates = rawTextureName.includes('.')
    ? [rawTextureName]
    : [
        `${rawTextureName}.png`,
        `${rawTextureName}.jpg`,
        `${rawTextureName}.jpeg`,
        `${rawTextureName}.webp`,
      ];
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
    });
  }
  return [...declarations.values()];
}
