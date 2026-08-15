export interface CustomShaderBlock {
  type: 'wgsl' | 'glsl';
  code: string;
}

/**
 * Parses custom WGSL or GLSL shader blocks embedded inside a preset source string.
 * Supports `[custom_shader_wgsl]`, `[custom_shader_glsl]`, `[custom_shader]`, or
 * `// custom_shader_wgsl:` / `// custom_shader_glsl:` annotations.
 */
export function parseCustomShaderBlock(
  presetSource: string,
): CustomShaderBlock | null {
  const wgslMatch =
    presetSource.match(
      /(?:\/\/|#)\s*custom_shader_wgsl:\s*([\s\S]*?)(?:$|\n\[|\/\/\s*custom_shader)/iu,
    ) || presetSource.match(/\[custom_shader_wgsl\]\s*([\s\S]*?)(?:$|\n\[)/iu);
  if (wgslMatch?.[1]?.trim()) {
    return { type: 'wgsl', code: wgslMatch[1].trim() };
  }

  const glslMatch =
    presetSource.match(
      /(?:\/\/|#)\s*custom_shader_glsl:\s*([\s\S]*?)(?:$|\n\[|\/\/\s*custom_shader)/iu,
    ) ||
    presetSource.match(/\[custom_shader_glsl\]\s*([\s\S]*?)(?:$|\n\[)/iu) ||
    presetSource.match(/\[custom_shader\]\s*([\s\S]*?)(?:$|\n\[)/iu);
  if (glslMatch?.[1]?.trim()) {
    return { type: 'glsl', code: glslMatch[1].trim() };
  }

  return null;
}
