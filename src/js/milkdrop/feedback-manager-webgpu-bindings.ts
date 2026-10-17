import {
  getMilkdropShaderAuxTextureSourceId,
  normalizeMilkdropShaderSamplerName,
} from 'milkdrop-toolchain/src/shader-samplers.ts';
import type { MilkdropShaderTextureSampler } from './types';

export type DirectShaderValueKind = 'vec2' | 'vec3';

export type DirectShaderSwizzleSpec = {
  kind: DirectShaderValueKind | 'scalar';
  components: Array<'x' | 'y' | 'z'>;
};

export type DirectShaderSamplerBinding = {
  canonicalSource: MilkdropShaderTextureSampler | 'main';
  sourceId: number;
};

function getDirectShaderSamplerSourceId(
  canonicalSource: MilkdropShaderTextureSampler | 'main',
) {
  switch (canonicalSource) {
    case 'main':
      return 0;
    // pw_main/pc_main/fc_main are routed to the previous/warp framebuffer
    // textures by the TSL dispatch before the aux sampler is reached, so
    // their ids are never consumed by the aux path.
    case 'pw_main':
      return 9;
    case 'pc_main':
      return 10;
    case 'fc_main':
      return 11;
    default:
      return getMilkdropShaderAuxTextureSourceId(canonicalSource);
  }
}

export function resolveDirectShaderSamplerBinding(
  sourceName: string,
  sampleDimension: '2d' | '3d',
): DirectShaderSamplerBinding | null {
  const canonicalSource = normalizeMilkdropShaderSamplerName(sourceName);
  if (!canonicalSource) {
    return null;
  }
  if (sampleDimension === '3d' && canonicalSource === 'main') {
    return null;
  }
  return {
    canonicalSource,
    sourceId: getDirectShaderSamplerSourceId(canonicalSource),
  };
}

const VEC2_SWIZZLE_COMPONENT_MAP: Readonly<Record<string, 'x' | 'y' | 'z'>> = {
  x: 'x',
  y: 'y',
  r: 'x',
  g: 'y',
};

const VEC3_SWIZZLE_COMPONENT_MAP: Readonly<Record<string, 'x' | 'y' | 'z'>> = {
  x: 'x',
  y: 'y',
  z: 'z',
  r: 'x',
  g: 'y',
  b: 'z',
};

export function resolveDirectShaderSwizzle(
  kind: DirectShaderValueKind,
  property: string,
): DirectShaderSwizzleSpec | null {
  const normalized = property.toLowerCase();
  if (normalized.length < 1 || normalized.length > 3) {
    return null;
  }
  const componentMap =
    kind === 'vec2' ? VEC2_SWIZZLE_COMPONENT_MAP : VEC3_SWIZZLE_COMPONENT_MAP;
  const components: Array<'x' | 'y' | 'z'> = [];
  for (let i = 0; i < normalized.length; i += 1) {
    const mapped = componentMap[normalized[i]!];
    if (!mapped) {
      return null;
    }
    components.push(mapped);
  }
  return {
    kind:
      components.length === 1
        ? 'scalar'
        : components.length === 2
          ? 'vec2'
          : 'vec3',
    components,
  };
}
