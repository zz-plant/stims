import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  collectBundledCatalogIds,
  PRESET_FRAME_COST_PATH,
  serializePresetFrameCostData,
} from '../../scripts/preset-lab-cost-ingest.ts';
import { parsePresetFrameCostData } from '../../src/js/core/preset-cost-signal.ts';

/**
 * Guards the shipped per-preset frame-cost sidecar the way
 * bundled-first-run-preset.test.ts guards the first-run evidence: the file is
 * a measurement record, so anything that drifts from what the instrument
 * writes — hand-edited numbers, stale formatting, ids the catalog no longer
 * contains — fails here rather than shipping behind the autoplay gate.
 *
 * Regenerating is the deliberate act of re-measuring; the command sequence
 * is at the top of scripts/preset-lab-cost-ingest.ts.
 */

describe('bundled preset frame-cost sidecar', () => {
  const sidecarText = readFileSync(PRESET_FRAME_COST_PATH, 'utf8');
  // A malformed file throws here and fails the whole suite before any
  // follow-on assertion can misreport the problem.
  const sidecar = parsePresetFrameCostData(JSON.parse(sidecarText));

  test('is valid against the schema the runtime gate reads', () => {
    // parsePresetFrameCostData above throws (and fails the suite) on any
    // malformed entry; reaching here with an object is the assertion.
    expect(sidecar.version).toBe(1);
  });

  test('only names presets the bundled catalog actually ships', () => {
    const catalogIds = collectBundledCatalogIds();

    const unknown = Object.keys(sidecar.entries).filter(
      (presetId) => !catalogIds.has(presetId),
    );
    expect(unknown).toEqual([]);
  });

  test('is written in the ingest script’s canonical form', () => {
    expect(sidecarText).toBe(serializePresetFrameCostData(sidecar));
  });
});
