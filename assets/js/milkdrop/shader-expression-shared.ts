export type MilkdropShaderValueKind = 'scalar' | 'vec2' | 'vec3';

export type MilkdropShaderConstructorPattern =
  | 'vec2-pair'
  | 'vec2-splat'
  | 'vec3-triple'
  | 'vec3-splat'
  | 'vec3-vec2-scalar'
  | 'vec3-scalar-vec2';

export function normalizeMilkdropShaderCallName(value: string) {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case 'float2':
      return 'vec2';
    case 'float3':
      return 'vec3';
    case 'texture':
    case 'texture2d':
    case 'tex2d':
      return 'tex2d';
    case 'texture3d':
    case 'tex3d':
      return 'tex3d';
    default:
      return normalized;
  }
}

export function resolveMilkdropShaderConstructorPattern(
  name: string,
  argKinds: MilkdropShaderValueKind[],
): MilkdropShaderConstructorPattern | null {
  const normalizedName =
    name.toLowerCase() === 'float2'
      ? 'vec2'
      : name.toLowerCase() === 'float3'
        ? 'vec3'
        : name.toLowerCase();

  if (normalizedName === 'vec2') {
    if (argKinds[0] === 'scalar' && argKinds[1] === 'scalar') {
      return 'vec2-pair';
    }
    if (argKinds[0] === 'scalar') {
      return 'vec2-splat';
    }
    return null;
  }

  if (normalizedName === 'vec3') {
    if (
      argKinds[0] === 'scalar' &&
      argKinds[1] === 'scalar' &&
      argKinds[2] === 'scalar'
    ) {
      return 'vec3-triple';
    }
    if (argKinds[0] === 'vec2' && argKinds[1] === 'scalar') {
      return 'vec3-vec2-scalar';
    }
    if (argKinds[0] === 'scalar' && argKinds[1] === 'vec2') {
      return 'vec3-scalar-vec2';
    }
    if (argKinds[0] === 'scalar') {
      return 'vec3-splat';
    }
  }

  return null;
}
