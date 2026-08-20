import { describe, expect, test } from 'bun:test';
import { classifyMilkdropShaderProgramExecution } from '../../src/js/milkdrop/compiler/shader-execution-classification.ts';
import type { MilkdropShaderProgramPayload } from '../../src/js/milkdrop/types.ts';

function createProgram(
  overrides: Partial<MilkdropShaderProgramPayload> = {},
): MilkdropShaderProgramPayload {
  return {
    stage: 'comp',
    source: 'ret = tex2d(sampler_main, uv).rgb',
    normalizedLines: ['ret = tex2d(sampler_main, uv).rgb'],
    statements: [],
    execution: {
      kind: 'direct-feedback-program',
      stage: 'comp',
      entryTarget: 'ret',
      supportedBackends: ['webgl', 'webgpu'],
      requiresControlFallback: false,
      statementTargets: ['ret'],
    },
    ...overrides,
  };
}

describe('milkdrop shader execution classification', () => {
  test('identifies backend-executable direct programs', () => {
    expect(classifyMilkdropShaderProgramExecution(createProgram())).toEqual({
      kind: 'backend-executable',
      backends: ['webgl', 'webgpu'],
      preservesRawGlsl: false,
      requiresControlFallback: false,
    });
  });

  test('identifies executable programs that still need control fallback', () => {
    expect(
      classifyMilkdropShaderProgramExecution(
        createProgram({
          execution: {
            kind: 'direct-feedback-program',
            stage: 'comp',
            entryTarget: 'ret',
            supportedBackends: ['webgl'],
            requiresControlFallback: true,
            statementTargets: ['ret'],
          },
        }),
      ),
    ).toEqual({
      kind: 'backend-executable-with-control-fallback',
      backends: ['webgl'],
      preservesRawGlsl: false,
      requiresControlFallback: true,
    });
  });

  test('keeps the control-fallback flag on raw-preserved programs', () => {
    // Raw GLSL makes the program executable on WebGL; it does not remove a
    // control-fallback requirement. This previously returned the plain
    // `backend-executable` kind alongside `requiresControlFallback: true`,
    // so the object contradicted itself.
    expect(
      classifyMilkdropShaderProgramExecution(
        createProgram({
          rawGlsl: 'ret = custom_glsl_only_value',
          execution: {
            kind: 'direct-feedback-program',
            stage: 'comp',
            entryTarget: 'ret',
            supportedBackends: [],
            requiresControlFallback: true,
            statementTargets: ['ret'],
          },
        }),
      ),
    ).toEqual({
      kind: 'backend-executable-with-control-fallback',
      backends: ['webgl'],
      preservesRawGlsl: true,
      requiresControlFallback: true,
    });
  });

  test('identifies raw-preserved programs as backend-executable on webgl', () => {
    expect(
      classifyMilkdropShaderProgramExecution(
        createProgram({
          rawGlsl: 'ret = custom_glsl_only_value',
          execution: {
            kind: 'direct-feedback-program',
            stage: 'comp',
            entryTarget: 'ret',
            supportedBackends: [],
            requiresControlFallback: false,
            statementTargets: ['ret'],
          },
        }),
      ),
    ).toEqual({
      kind: 'backend-executable',
      backends: ['webgl'],
      preservesRawGlsl: true,
      requiresControlFallback: false,
    });
  });
});
