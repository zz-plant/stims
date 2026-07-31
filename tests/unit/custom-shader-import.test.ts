import { describe, expect, it } from 'bun:test';
import { parseCustomShaderBlock } from '../../src/js/milkdrop/compiler/tsl-generator.ts';

describe('Custom Shader Block Parser', () => {
  it('parses WGSL custom shader blocks correctly', () => {
    const presetWithWgsl = `
[preset00]
per_frame_1=zoom=1.05;
// custom_shader_wgsl:
// @fragment fn main() -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
`;
    const result = parseCustomShaderBlock(presetWithWgsl);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('wgsl');
    expect(result?.code).toContain('@fragment fn main()');
  });

  it('parses GLSL custom shader blocks correctly', () => {
    const presetWithGlsl = `
[preset00]
per_frame_1=zoom=1.02;
[custom_shader_glsl]
void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }
`;
    const result = parseCustomShaderBlock(presetWithGlsl);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('glsl');
    expect(result?.code).toContain('gl_FragColor');
  });

  it('returns null for presets without custom shader blocks', () => {
    const plainPreset = `
[preset00]
per_frame_1=zoom=1.0;
`;
    const result = parseCustomShaderBlock(plainPreset);
    expect(result).toBeNull();
  });
});
