import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildShaderProgramPayload,
  extractShaderControls,
} from '../assets/js/milkdrop/compiler/shader-analysis.ts';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import { parseMilkdropShaderStatement } from '../assets/js/milkdrop/shader-ast.ts';

const legacySupportedFeedbackFixture = readFileSync(
  join(
    import.meta.dir,
    'fixtures/milkdrop/legacy/legacy-supported-feedback-subset.milk',
  ),
  'utf8',
);

const legacyUnsupportedShaderFixture = readFileSync(
  join(
    import.meta.dir,
    'fixtures/milkdrop/legacy/legacy-unsupported-full-shader-code.milk',
  ),
  'utf8',
);

describe('milkdrop compiler shader analysis', () => {
  test('extracts supported shader controls from the legacy feedback fixture', () => {
    const compiled = compileMilkdropPresetSource(
      legacySupportedFeedbackFixture,
      {
        id: 'legacy-supported-feedback-subset',
      },
    );

    const warpAnalysis = extractShaderControls(compiled.ir.shaderText.warp);
    const compAnalysis = extractShaderControls(compiled.ir.shaderText.comp);

    expect(warpAnalysis.supported).toBe(true);
    expect(warpAnalysis.unsupportedLines).toEqual([]);
    expect(warpAnalysis.controls.warpScale).toBeCloseTo(0.65, 6);
    expect(warpAnalysis.controls.offsetX).toBeCloseTo(0.03, 6);
    expect(warpAnalysis.controls.offsetY).toBeCloseTo(-0.02, 6);

    expect(compAnalysis.supported).toBe(true);
    expect(compAnalysis.controls.mixAlpha).toBeCloseTo(0.24, 6);
    expect(compAnalysis.controls.tint).toMatchObject({
      r: 1,
      g: 0.7,
      b: 0.5,
    });
    expect(compAnalysis.controls.saturation).toBeCloseTo(1.2, 6);
    expect(compAnalysis.controls.contrast).toBeCloseTo(1.08, 6);
  });

  test('builds direct shader payloads from parsed shader statements', () => {
    const compiled = compileMilkdropPresetSource(
      legacyUnsupportedShaderFixture,
      {
        id: 'legacy-unsupported-full-shader-code',
      },
    );

    expect(compiled.ir.shaderText.supported).toBe(true);
    expect(compiled.ir.shaderText.unsupportedLines).toEqual([]);

    const statement = parseMilkdropShaderStatement(
      'ret=tex2d(sampler_main,uv).rgb*gain',
    );
    expect(statement).not.toBeNull();
    if (!statement) {
      throw new Error('Expected direct shader statement to parse');
    }
    const payload = buildShaderProgramPayload({
      stage: 'comp',
      statements: [statement],
      normalizedLines: ['ret=tex2d(sampler_main,uv).rgb*gain'],
      requiresControlFallback: true,
      supportedBackends: ['webgl', 'webgpu'],
    });

    expect(payload.execution.kind).toBe('direct-feedback-program');
    expect(payload.execution.entryTarget).toBe('ret');
    expect(payload.execution.statementTargets).toEqual(['ret']);
    expect(payload.execution.requiresControlFallback).toBe(true);
    expect(payload.source).toBe('ret=tex2d(sampler_main,uv).rgb*gain');
  });
});
