import {
  isMilkdropVolumeShaderSamplerName,
  normalizeMilkdropShaderSamplerName,
} from './shader-samplers.ts';
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
    case 'noise':
    case 'perlin':
      return 1;
    case 'simplex':
      return 2;
    case 'voronoi':
      return 3;
    case 'aura':
      return 4;
    case 'caustics':
      return 5;
    case 'pattern':
      return 6;
    case 'fractal':
      return 7;
    default:
      return 0;
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
  if (
    sampleDimension === '3d' &&
    (canonicalSource === 'main' ||
      !isMilkdropVolumeShaderSamplerName(canonicalSource))
  ) {
    return null;
  }
  return {
    canonicalSource,
    sourceId: getDirectShaderSamplerSourceId(canonicalSource),
  };
}

export function resolveDirectShaderSwizzle(
  kind: DirectShaderValueKind,
  property: string,
): DirectShaderSwizzleSpec | null {
  const normalized = property.toLowerCase();
  const componentMap: Record<string, 'x' | 'y' | 'z'> =
    kind === 'vec2'
      ? {
          x: 'x',
          y: 'y',
          r: 'x',
          g: 'y',
        }
      : {
          x: 'x',
          y: 'y',
          z: 'z',
          r: 'x',
          g: 'y',
          b: 'z',
        };
  if (
    normalized.length < 1 ||
    normalized.length > 3 ||
    [...normalized].some((entry) => !(entry in componentMap))
  ) {
    return null;
  }
  const components = [...normalized].map((entry) => componentMap[entry]);
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
