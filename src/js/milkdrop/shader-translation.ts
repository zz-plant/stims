/**
 * What a preset's warp and composite shaders become on the GPU.
 *
 * MilkDrop shaders are HLSL. On the WebGL path Stims either converts a
 * native `shader_body { … }` as a whole (`rawGlsl`) or rebuilds the shader
 * from its parsed statements. Authors had no way to see that result, so "why
 * does my shader look different here" had no answer short of reading the
 * renderer. This returns the text the WebGL feedback manager compiles, via
 * the same call (`rawGlsl ?? generateGlslFromShaderStatements`), so it cannot
 * drift from what actually runs.
 *
 * Whether each renderer runs the shader as written, or substitutes an
 * approximation, comes from `resolveShaderExecutionMode`, the one shared
 * answer the dock, HUD and agent snapshot also use. WebGPU builds its own
 * shader from the same statements; only its mode is reported here.
 */
import { generateGlslFromShaderStatements } from './compiler/shader-analysis-glsl.ts';
import {
  type MilkdropShaderExecutionMode,
  resolveShaderExecutionMode,
} from './shader-execution-mode.ts';
import type { MilkdropCompiledPreset } from './types.ts';

export type ShaderStage = 'warp' | 'comp';

export type ShaderTranslation = {
  stage: ShaderStage;
  /** The shader text as written in the preset. */
  source: string;
  /** What the WebGL path compiles, or null when nothing was produced. */
  glsl: string | null;
  /** 'body': the native shader body converted as a whole; 'statements':
   * rebuilt from the parsed statements; 'none': nothing was produced. */
  path: 'body' | 'statements' | 'none';
  /** Per renderer, for the preset as a whole (see shader-execution-mode.ts). */
  execution: {
    webgl: MilkdropShaderExecutionMode | null;
    webgpu: MilkdropShaderExecutionMode | null;
  };
};

export function describeShaderTranslations(
  compiled: MilkdropCompiledPreset,
): ShaderTranslation[] {
  const { shaderText } = compiled.ir;
  const execution = {
    webgl: resolveShaderExecutionMode(compiled, 'webgl'),
    webgpu: resolveShaderExecutionMode(compiled, 'webgpu'),
  };
  const stages: Array<
    [ShaderStage, string | null, typeof shaderText.warpProgram]
  > = [
    ['warp', shaderText.warp, shaderText.warpProgram],
    ['comp', shaderText.comp, shaderText.compProgram],
  ];
  return stages
    .filter(([, source]) => Boolean(source?.trim()))
    .map(([stage, source, program]) => {
      const glsl = program
        ? (program.rawGlsl ??
          generateGlslFromShaderStatements(program.statements, stage) ??
          null)
        : null;
      return {
        stage,
        source: source as string,
        glsl,
        path: glsl === null ? 'none' : program?.rawGlsl ? 'body' : 'statements',
        execution,
      };
    });
}

/** One plain sentence per renderer, for the editor. */
export function describeExecutionMode(
  mode: MilkdropShaderExecutionMode | null,
): string {
  switch (mode) {
    case 'direct':
      return 'runs it as written';
    case 'translated':
      return 'cannot lower it, so shows an approximation';
    case 'unsupported':
      return 'shows an approximation (lines outside the supported subset)';
    case 'none':
      return 'has no shader to run';
    default:
      return 'not known yet';
  }
}
