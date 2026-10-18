import { describe, expect, test } from 'bun:test';
import type { DecisionResult } from '../../src/js/core/decision-model.ts';
import {
  type DecisionLabRecord,
  evaluateDecisionRecords,
  profileSearchTags,
  promoteVisualProfiles,
} from '../../src/js/core/decision-workflows.ts';

function profile(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    version: 1,
    task: 'visual-profile',
    model: 'clef-flash',
    disposition: 'accepted',
    provenance: {
      questionVersion: 'stims-clef-v1',
      evaluatedAt: '2026-10-17T00:00:00.000Z',
      inputHash: 'a'.repeat(64),
    },
    answers: {
      sufficient_evidence: { type: 'noul', noul: 0.99 },
      motif_tunnel: { type: 'noul', noul: 0.96 },
      motif_particles: { type: 'noul', noul: 0.51 },
      palette: {
        type: 'choice',
        choice: 'cool',
        confidence: 0.98,
        probabilities: {
          warm: 0.005,
          cool: 0.98,
          mixed: 0.005,
          monochrome: 0.005,
          unclear: 0.005,
        },
      },
    },
    ...overrides,
  };
}

function record(
  renderer: 'webgl' | 'webgpu',
  width: number,
  height: number,
): DecisionLabRecord {
  return {
    id: `p-${renderer}-${width}`,
    presetId: 'p',
    family: 'family-p',
    sourceHash: 'source-p',
    context: { renderer, width, height, audioScenario: 'demo' },
    request: { task: 'visual-profile', state: {} },
    result: profile(),
    latencyMs: 12,
  };
}

describe('decision-assisted workflows', () => {
  test('offline reports are bounded before building maps or copying the catalog', () => {
    const records = Array(1001).fill(record('webgl', 1280, 720));
    expect(() => evaluateDecisionRecords(records, [])).toThrow('Too many');
    expect(() =>
      promoteVisualProfiles({ presets: [] }, records, () => null),
    ).toThrow('Too many');
  });
  test('search tags use decisive observed motifs and palette, and abstain on review', () => {
    expect(profileSearchTags(profile())).toEqual(['look:tunnel', 'look:cool']);
    expect(profileSearchTags(profile({ disposition: 'review' }))).toEqual([]);
    expect(profileSearchTags(profile({ task: 'capture-review' }))).toEqual([]);
  });

  test('promotion requires both backends and orientations and current source', () => {
    const catalog = {
      presets: [
        {
          id: 'p',
          file: 'p.milk',
          tags: ['category:fractal', 'look:old'],
          sensoryProfile: { flashRiskLevel: 'high' },
        },
      ],
    };
    const records = [
      record('webgl', 1280, 720),
      record('webgl', 390, 844),
      record('webgpu', 1280, 720),
      record('webgpu', 390, 844),
    ];
    expect(
      promoteVisualProfiles(catalog, records.slice(0, 3), () => 'source-p')
        .manifest.profiles,
    ).toHaveLength(0);
    expect(
      promoteVisualProfiles(catalog, records, () => 'changed').manifest
        .profiles,
    ).toHaveLength(0);
    const promoted = promoteVisualProfiles(catalog, records, () => 'source-p');
    expect(promoted.catalog.presets[0].tags).toEqual([
      'category:fractal',
      'look:tunnel',
      'look:cool',
    ]);
    expect(promoted.catalog.presets[0].sensoryProfile).toEqual({
      flashRiskLevel: 'high',
    });
    expect(promoted.manifest.profiles[0].contexts).toHaveLength(4);
    expect(catalog.presets[0].tags).toContain('look:old');
  });

  test('promotion retains only motifs supported in every measured context', () => {
    const records = [
      record('webgl', 1280, 720),
      record('webgl', 390, 844),
      record('webgpu', 1280, 720),
      record('webgpu', 390, 844),
    ];
    records[3].result = profile({
      answers: {
        sufficient_evidence: { type: 'noul', noul: 0.99 },
        motif_tunnel: { type: 'noul', noul: 0.1 },
      },
    });
    const promoted = promoteVisualProfiles(
      { presets: [{ id: 'p', file: 'p.milk', tags: ['existing'] }] },
      records,
      () => 'source-p',
    );
    expect(promoted.manifest.profiles).toHaveLength(0);
    expect(promoted.catalog.presets[0].tags).toEqual(['existing']);
  });

  test('evaluation rejects renamed and mistyped labels instead of inflating accuracy', () => {
    const records = [
      {
        ...record('webgl', 1280, 720),
        id: 'p',
        request: { task: 'prompt-match' as const, state: { prompt: 'tunnel' } },
        result: profile({
          task: 'prompt-match',
          answers: { structure_match: { type: 'noul', noul: 0.99 } },
        }),
      },
    ];
    expect(() =>
      evaluateDecisionRecords(records, [
        {
          id: 'p',
          family: 'p',
          expected: { structure_match: true, renamed_palette_match: false },
        },
      ]),
    ).toThrow('Invalid label');
    expect(() =>
      evaluateDecisionRecords(records, [
        { id: 'p', family: 'p', expected: { structure_match: 'true' } },
      ]),
    ).toThrow('Invalid label');
    expect(
      evaluateDecisionRecords(records, [
        {
          id: 'p',
          family: 'p',
          expected: { structure_match: true, palette_match: false },
        },
      ]).acceptedAccuracy,
    ).toBe(0.5);
  });

  test('evaluation reports selective accuracy, binary Brier score, and failed coverage', () => {
    const records: DecisionLabRecord[] = [
      {
        id: 'yes',
        request: { task: 'prompt-match', state: { prompt: 'tunnel' } },
        result: profile({
          task: 'prompt-match',
          answers: { structure_match: { type: 'noul', noul: 0.9 } },
        }),
        latencyMs: 10,
      },
      {
        id: 'no',
        request: { task: 'prompt-match', state: { prompt: 'tunnel' } },
        result: profile({
          task: 'prompt-match',
          disposition: 'review',
          answers: { structure_match: { type: 'noul', noul: 0.6 } },
        }),
        latencyMs: 30,
      },
      {
        id: 'failed',
        request: { task: 'prompt-match', state: { prompt: 'tunnel' } },
        error: 'unavailable',
        latencyMs: 50,
      },
    ];
    const report = evaluateDecisionRecords(records, [
      { id: 'yes', family: 'one', expected: { structure_match: true } },
      { id: 'no', family: 'two', expected: { structure_match: false } },
      { id: 'failed', family: 'three', expected: { structure_match: true } },
    ]);
    expect(report.coverage).toBeCloseTo(1 / 3);
    expect(report.acceptedAccuracy).toBe(1);
    expect(report.brier).toBeCloseTo((0.01 + 0.36) / 2);
    expect(report.failedCount).toBe(1);
    expect(report.familyCount).toBe(3);
    expect(report.p95LatencyMs).toBe(50);
  });
});
