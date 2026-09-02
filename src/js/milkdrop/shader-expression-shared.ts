export type MilkdropShaderValueKind = 'scalar' | 'vec2' | 'vec3' | 'vec4';

/** Value kinds the WebGPU node executor adds on top of the scalar/vector set. */
export type MilkdropShaderMatrixKind = 'mat2' | 'mat3' | 'mat4';

export type MilkdropShaderConstructorPattern =
  | 'vec2-pair'
  | 'vec2-splat'
  | 'vec2-copy'
  | 'vec3-triple'
  | 'vec3-splat'
  | 'vec3-vec2-scalar'
  | 'vec3-scalar-vec2'
  | 'vec3-copy'
  | 'vec4-quad'
  | 'vec4-splat'
  | 'vec4-vec3-scalar'
  | 'vec4-scalar-vec3'
  | 'vec4-vec2-vec2'
  | 'vec4-copy'
  | 'mat2-quad'
  | 'mat2-pair'
  | 'mat2-splat'
  | 'mat2-copy'
  | 'mat3-nine'
  | 'mat3-triple'
  | 'mat3-splat'
  | 'mat3-copy'
  | 'mat4-sixteen'
  | 'mat4-quad'
  | 'mat4-splat'
  | 'mat4-copy';

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
  if (isLowerAlphaEquals(value, 'float4')) return 'vec4';
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
  argKinds: Array<MilkdropShaderValueKind | MilkdropShaderMatrixKind>,
): MilkdropShaderConstructorPattern | null {
  let normalizedName: string;
  if (isLowerAlphaEquals(name, 'float2')) {
    normalizedName = 'vec2';
  } else if (isLowerAlphaEquals(name, 'float3')) {
    normalizedName = 'vec3';
  } else if (isLowerAlphaEquals(name, 'float4')) {
    normalizedName = 'vec4';
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
    if (argKinds[0] === 'vec2') {
      return 'vec2-copy';
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
    if (argKinds[0] === 'vec3') {
      return 'vec3-copy';
    }
  }

  if (isLowerAlphaEquals(normalizedName, 'vec4')) {
    if (
      argKinds[0] === 'scalar' &&
      argKinds[1] === 'scalar' &&
      argKinds[2] === 'scalar' &&
      argKinds[3] === 'scalar'
    ) {
      return 'vec4-quad';
    }
    if (argKinds[0] === 'vec3' && argKinds[1] === 'scalar') {
      return 'vec4-vec3-scalar';
    }
    if (argKinds[0] === 'scalar' && argKinds[1] === 'vec3') {
      return 'vec4-scalar-vec3';
    }
    if (argKinds[0] === 'vec2' && argKinds[1] === 'vec2') {
      return 'vec4-vec2-vec2';
    }
    if (argKinds[0] === 'scalar') {
      return 'vec4-splat';
    }
    if (argKinds[0] === 'vec4') {
      return 'vec4-copy';
    }
  }

  if (isLowerAlphaEquals(normalizedName, 'mat2')) {
    if (
      argKinds[0] === 'scalar' &&
      argKinds[1] === 'scalar' &&
      argKinds[2] === 'scalar' &&
      argKinds[3] === 'scalar'
    ) {
      return 'mat2-quad';
    }
    if (argKinds[0] === 'vec2' && argKinds[1] === 'vec2') {
      return 'mat2-pair';
    }
    if (argKinds.length === 1 && argKinds[0] === 'scalar') {
      return 'mat2-splat';
    }
    if (argKinds.length === 1 && argKinds[0] === 'mat2') {
      return 'mat2-copy';
    }
  }

  // GLSL matrix constructors are column-major: `mat3(a, b, c, d, e, f, g, h,
  // i)` fills column 0 with (a, b, c). `matN(s)` is the diagonal matrix, and
  // `matN(vecN, ...)` takes one column per argument.
  if (isLowerAlphaEquals(normalizedName, 'mat3')) {
    if (argKinds.length === 9 && argKinds.every((kind) => kind === 'scalar')) {
      return 'mat3-nine';
    }
    if (argKinds.length === 3 && argKinds.every((kind) => kind === 'vec3')) {
      return 'mat3-triple';
    }
    if (argKinds.length === 1 && argKinds[0] === 'scalar') {
      return 'mat3-splat';
    }
    if (argKinds.length === 1 && argKinds[0] === 'mat3') {
      return 'mat3-copy';
    }
  }

  if (isLowerAlphaEquals(normalizedName, 'mat4')) {
    if (argKinds.length === 16 && argKinds.every((kind) => kind === 'scalar')) {
      return 'mat4-sixteen';
    }
    if (argKinds.length === 4 && argKinds.every((kind) => kind === 'vec4')) {
      return 'mat4-quad';
    }
    if (argKinds.length === 1 && argKinds[0] === 'scalar') {
      return 'mat4-splat';
    }
    if (argKinds.length === 1 && argKinds[0] === 'mat4') {
      return 'mat4-copy';
    }
  }

  return null;
}
