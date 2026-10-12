import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPresetFrameCostData,
  collectBundledCatalogIds,
  serializePresetFrameCostData,
} from '../../scripts/preset-lab-cost-ingest.ts';
import type { CertificationCorpusPerfSummary } from '../../scripts/run-certification-corpus-perf-suite.ts';
import {
  type PresetFrameCostData,
  parsePresetFrameCostData,
} from '../../src/js/core/preset-cost-signal.ts';

/**
 * A trimmed `perf:certification-corpus` summary: one measured pass, one
 * measured over-budget fail (a fail is still a measurement — heavy presets
 * are exactly the point of the signal), one error with no metrics (nothing
 * to record), and one fixture id the bundled catalog does not contain (the
 * certification corpus deliberately includes such presets).
 */
const FIXTURE_SUMMARY = {
  version: 1,
  generatedAt: '2026-10-11T10:00:00.000Z',
  reports: [
    {
      presetId: 'shifter-curlique',
      aggregateMetrics: { medianAverageFrameMs: 9.456789 },
      status: 'pass',
    },
    {
      presetId: 'krash-rovastar-cerebral-demons-stars',
      aggregateMetrics: { medianAverageFrameMs: 27.004 },
      status: 'fail',
    },
    {
      presetId: 'projectm-fixture-outside-catalog',
      aggregateMetrics: { medianAverageFrameMs: 5 },
      status: 'pass',
    },
    {
      presetId: 'shifter-glassworms-flare',
      aggregateMetrics: null,
      status: 'error',
    },
  ],
} as unknown as CertificationCorpusPerfSummary;

const CATALOG_IDS = collectBundledCatalogIds();

/**
 * The tests merge into a synthetic empty base, not the committed sidecar, so
 * they keep failing on real ingest bugs after the coordinator populates the
 * shipped file with real hardware data.
 */
const EMPTY_SIDECAR: PresetFrameCostData = parsePresetFrameCostData({
  version: 1,
  entries: {},
});

function ingestFixture(existing: PresetFrameCostData = EMPTY_SIDECAR) {
  return buildPresetFrameCostData({
    existing,
    summary: FIXTURE_SUMMARY,
    tier: 'apple-m2-pro',
    qualityStep: 1,
    catalogIds: CATALOG_IDS,
  });
}

describe('preset frame-cost ingest', () => {
  test('turns a perf summary into a valid sidecar', () => {
    const { data } = ingestFixture();

    // Round-trips through the runtime's own parser, so what the ingest writes
    // is exactly what the gate can read.
    const reparsed = parsePresetFrameCostData(JSON.parse(JSON.stringify(data)));
    expect(Object.keys(reparsed.entries).sort()).toEqual([
      'krash-rovastar-cerebral-demons-stars',
      'shifter-curlique',
    ]);
  });

  test('records frame work rounded, with the run provenance attached', () => {
    const { data } = ingestFixture();

    expect(data.entries['shifter-curlique']).toEqual({
      frameWorkMs: 9.46,
      tier: 'apple-m2-pro',
      qualityStep: 1,
      measuredAt: '2026-10-11',
      instrument: 'perf:certification-corpus',
    });
    // The over-budget fail is recorded too — a measured cost is a measured
    // cost, and this one is the reason the signal exists.
    expect(
      data.entries['krash-rovastar-cerebral-demons-stars']?.frameWorkMs,
    ).toBe(27);
  });

  test('skips fixture presets the bundled catalog does not contain', () => {
    const { skipped } = ingestFixture();
    expect(skipped).toEqual(['projectm-fixture-outside-catalog']);
  });

  test('ignores error reports that measured nothing', () => {
    const { data } = ingestFixture();
    expect(data.entries['shifter-glassworms-flare']).toBeUndefined();
  });

  test('keeps entries from earlier runs that this run did not measure', () => {
    const existing = parsePresetFrameCostData({
      version: 1,
      entries: {
        'krash - geom - 4d-tunnel': {
          frameWorkMs: 7.1,
          tier: 'apple-m1-max',
          qualityStep: null,
          measuredAt: '2026-09-01',
          instrument: 'perf:certification-corpus',
        },
      },
    });

    const { data } = ingestFixture(existing);
    expect(data.entries['krash - geom - 4d-tunnel']).toBeDefined();
    expect(data.entries['shifter-curlique']).toBeDefined();
  });

  test('re-ingesting the same run is idempotent', () => {
    const once = ingestFixture().data;
    const { data } = ingestFixture(once);
    expect(data).toEqual(once);
  });

  test('serializes canonically so drift is a byte comparison', () => {
    const { data } = ingestFixture();
    const text = serializePresetFrameCostData(data);
    // Same content, and the byte form never depends on the run's
    // iteration order — key order is sorted, formatting is fixed.
    expect(JSON.parse(text)).toEqual({
      version: 1,
      entries: data.entries,
    });
    expect(Object.keys(JSON.parse(text).entries)).toEqual([
      'krash-rovastar-cerebral-demons-stars',
      'shifter-curlique',
    ]);
  });
});

describe('preset frame-cost drift check', () => {
  test('--check flags a sidecar that does not match the given summary', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'stims-cost-drift-'));
    try {
      const summaryPath = join(scratch, 'summary.json');
      writeFileSync(summaryPath, JSON.stringify(FIXTURE_SUMMARY));
      // The committed sidecar does not carry this run's measurements, so the
      // check must fail: this is the drift the flag exists to catch. Runs the
      // real script, not a re-implementation of its comparison.
      const result = spawnSync(
        'bun',
        [
          'run',
          'scripts/preset-lab-cost-ingest.ts',
          '--check',
          '--summary',
          summaryPath,
          '--tier',
          'apple-m2-pro',
          '--quality-step',
          '1',
        ],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('stale or malformed');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('--check passes against the committed sidecar when no summary is given', () => {
    const result = spawnSync(
      'bun',
      ['run', 'scripts/preset-lab-cost-ingest.ts', '--check'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('valid and canonical');
  });
});
