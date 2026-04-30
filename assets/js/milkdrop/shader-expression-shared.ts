export type MilkdropShaderValueKind = 'scalar' | 'vec2' | 'vec3';

export type MilkdropShaderConstructorPattern =
  | 'vec2-pair'
  | 'vec2-splat'
  | 'vec3-triple'
  | 'vec3-splat'
  | 'vec3-vec2-scalar'
  | 'vec3-scalar-vec2';

/**
 * Fast case-insensitive check that avoids creating a new string when the
 * value is already known to be lowercase (the overwhelmingly common case).
 */
function isLowerAlphaEquals(value: string, target: string): boolean {
  if (value.length !== target.length) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    // Fast path: exact match
    if (c === target.charCodeAt(i)) {
      continue;
    }
    // Lowercase comparison: if c is uppercase, convert
    if (c >= 65 && c <= 90) {
      if (c + 32 === target.charCodeAt(i)) {
        continue;
      }
    }
    return false;
  }
  return true;
}

export function normalizeMilkdropShaderCallName(value: string) {
  // Fast path: most calls are already lowercase
  if (isLowerAlphaEquals(value, 'float2')) return 'vec2';
  if (isLowerAlphaEquals(value, 'float3')) return 'vec3';
  if (
    isLowerAlphaEquals(value, 'texture') ||
    isLowerAlphaEquals(value, 'texture2d') ||
    isLowerAlphaEquals(value, 'tex2d')
  )
    return 'tex2d';
  if (
    isLowerAlphaEquals(value, 'texture3d') ||
    isLowerAlphaEquals(value, 'tex3d')
  )
    return 'tex3d';
  return value;
}

export function resolveMilkdropShaderConstructorPattern(
  name: string,
  argKinds: MilkdropShaderValueKind[],
): MilkdropShaderConstructorPattern | null {
  let normalizedName: string;
  if (isLowerAlphaEquals(name, 'float2')) {
    normalizedName = 'vec2';
  } else if (isLowerAlphaEquals(name, 'float3')) {
    normalizedName = 'vec3';
  } else {
    normalizedName = name;
  }

  if (isLowerAlphaEquals(normalizedName, 'vec2')) {
    if (argKinds[0] === 'scalar' && argKinds[1] === 'scalar') {
      return 'vec2-pair';
    }
    if (argKinds[0] === 'scalar') {
      return 'vec2-splat';
    }
    return null;
  }

  if (isLowerAlphaEquals(normalizedName, 'vec3')) {
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
