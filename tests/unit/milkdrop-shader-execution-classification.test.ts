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

  test('identifies raw-preserved programs that must stay on control fallback', () => {
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
      kind: 'raw-preserved-fallback-required',
      backends: [],
      preservesRawGlsl: true,
      requiresControlFallback: true,
    });
  });
});
