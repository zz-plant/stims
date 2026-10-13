/**
 * lab:generation-bench scoring: compile success via the real compiler, the
 * reactivity probe verdict, and the aggregate math. Fixture presets cover
 * the three outcomes a generation can have — reactive, static-but-valid,
 * and rejected by the compiler — plus generation failures degrading to
 * records instead of aborting the run.
 */
import { describe, expect, test } from 'bun:test';
import {
  compareGenerationBenchReports,
  formatGenerationBenchText,
  type GenerationBenchReport,
  runGenerationBench,
  scoreGeneratedPreset,
} from '../../scripts/preset-lab-generation-bench.ts';

const reactiveSource = `[preset00]
fDecay=0.98
per_frame_1=zoom = 1.0 + 0.05 * bass_att;
per_frame_2=wave_r = 0.5 + 0.5 * sin(time);
`;

const staticSource = `[preset00]
fDecay=0.98
per_frame_1=zoom = 1.0 + 0.01 * sin(time);
`;

const brokenSource = `[preset00]
per_frame_1=zoom = sin(time;
`;

describe('scoreGeneratedPreset', () => {
  test('scores an audio-reactive preset as compiled and reactive', () => {
    const result = scoreGeneratedPreset('bench reactive', reactiveSource, 0);
    expect(result.status).toBe('ok');
    expect(result.compileErrorCount).toBe(0);
    expect(result.reactivityVerdict).toBe('reactive');
    expect(result.reactivityScore).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(100);
  });

  test('scores a static preset as compiled but not reactive', () => {
    const result = scoreGeneratedPreset('bench static', staticSource, 1);
    expect(result.status).toBe('ok');
    expect(result.reactivityVerdict).toBe('static');
    expect(result.score).toBeLessThan(
      scoreGeneratedPreset('bench reactive', reactiveSource, 0).score,
    );
  });

  test('rejects a source the real compiler refuses', () => {
    const result = scoreGeneratedPreset('bench broken', brokenSource, 2);
    expect(result.status).toBe('compile-failed');
    expect(result.compileErrorCount).toBeGreaterThan(0);
    expect(result.compileErrors[0]).toMatch(/;/u);
    expect(result.score).toBe(0);
    expect(result.reactivityVerdict).toBeNull();
  });
});

describe('runGenerationBench', () => {
  test('records generation failures without aborting the run', async () => {
    const report = await runGenerationBench({
      prompts: ['good prompt', 'dead provider', 'another good one'],
      provider: 'test',
      model: null,
      generate: (prompt) => {
        if (prompt === 'dead provider') {
          throw new Error('provider unreachable');
        }
        return reactiveSource;
      },
    });

    expect(report.results).toHaveLength(3);
    expect(report.aggregate.promptCount).toBe(3);
    expect(report.aggregate.okCount).toBe(2);
    expect(report.aggregate.generationFailedCount).toBe(1);
    const failed = report.results[1];
    expect(failed?.status).toBe('generation-failed');
    expect(failed?.failure).toBe('provider unreachable');
    expect(failed?.source).toBeNull();
  });

  test('aggregates compile success and reactivity rates', async () => {
    const report = await runGenerationBench({
      prompts: ['a', 'b', 'c'],
      provider: 'test',
      model: null,
      generate: (_prompt, index) =>
        index === 0
          ? reactiveSource
          : index === 1
            ? staticSource
            : brokenSource,
    });

    expect(report.aggregate.okCount).toBe(2);
    expect(report.aggregate.compileFailedCount).toBe(1);
    expect(report.aggregate.compileSuccessRate).toBeCloseTo(2 / 3, 10);
    expect(report.aggregate.reactiveRate).toBe(0.5);
    expect(report.aggregate.meanCompositeScore).toBeGreaterThan(0);
  });
});

describe('report text and comparison', () => {
  const baselineReport: GenerationBenchReport = {
    version: 1,
    provider: 'deterministic',
    model: null,
    promptFile: 'fixtures/generation-bench-prompts.json',
    results: [
      {
        prompt: 'a static prompt',
        status: 'ok',
        compileErrorCount: 0,
        compileWarningCount: 0,
        compileErrors: [],
        reactivityVerdict: 'static',
        reactivityScore: 0,
        respondingVariables: [],
        score: 100,
        source: staticSource,
      },
    ],
    aggregate: {
      promptCount: 1,
      okCount: 1,
      compileFailedCount: 0,
      generationFailedCount: 0,
      reactiveCount: 0,
      staticCount: 1,
      compileSuccessRate: 1,
      reactiveRate: 0,
      meanReactivityScore: 0,
      meanCompositeScore: 100,
    },
  };

  const improvedReport: GenerationBenchReport = {
    ...baselineReport,
    results: [
      {
        prompt: 'a static prompt',
        status: 'ok',
        compileErrorCount: 0,
        compileWarningCount: 0,
        compileErrors: [],
        reactivityVerdict: 'reactive',
        reactivityScore: 0.4,
        respondingVariables: ['zoom'],
        score: 154,
        source: reactiveSource,
      },
    ],
    aggregate: {
      promptCount: 1,
      okCount: 1,
      compileFailedCount: 0,
      generationFailedCount: 0,
      reactiveCount: 1,
      staticCount: 0,
      compileSuccessRate: 1,
      reactiveRate: 1,
      meanReactivityScore: 0.4,
      meanCompositeScore: 154,
    },
  };

  test('renders per-prompt rows and the aggregate', () => {
    const text = formatGenerationBenchText(baselineReport);
    expect(text).toContain('a static prompt');
    expect(text).toContain('static');
    expect(text).toContain('compiled: 1/1');
  });

  test('comparison reports the improved metrics', () => {
    const text = compareGenerationBenchReports(baselineReport, improvedReport);
    expect(text).toContain('reactive presets');
    expect(text).toContain('mean reactivity score');
  });
});
