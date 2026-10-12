import { afterEach, describe, expect, test } from 'bun:test';
import {
  installPresetFrameCostDataForTests,
  LOW_TIER_FRAME_WORK_BUDGET_MS,
  parsePresetFrameCostData,
  resetPresetFrameCostData,
  shouldSkipPresetForDeviceTier,
} from '../../src/js/core/preset-cost-signal.ts';

afterEach(() => {
  resetPresetFrameCostData();
});

function snapshot(entries: Record<string, number>) {
  return {
    version: 1,
    entries: Object.fromEntries(
      Object.entries(entries).map(([presetId, frameWorkMs]) => [
        presetId,
        {
          frameWorkMs,
          tier: 'test-machine',
          qualityStep: 1,
          measuredAt: '2026-10-11',
          instrument: 'perf:certification-corpus',
        },
      ]),
    ),
  };
}

describe('shouldSkipPresetForDeviceTier', () => {
  test('skips a preset measured over the budget on a low-tier device', () => {
    installPresetFrameCostDataForTests(
      snapshot({ heavy: LOW_TIER_FRAME_WORK_BUDGET_MS + 0.01 }),
    );

    expect(shouldSkipPresetForDeviceTier('heavy', 'low')).toBe(true);
  });

  test('keeps a measured preset at or under the budget on a low tier', () => {
    installPresetFrameCostDataForTests(
      snapshot({
        atBudget: LOW_TIER_FRAME_WORK_BUDGET_MS,
        underBudget: LOW_TIER_FRAME_WORK_BUDGET_MS - 1,
      }),
    );

    expect(shouldSkipPresetForDeviceTier('atBudget', 'low')).toBe(false);
    expect(shouldSkipPresetForDeviceTier('underBudget', 'low')).toBe(false);
  });

  test('keeps an unmeasured preset on a low tier — absent data changes nothing', () => {
    installPresetFrameCostDataForTests(snapshot({ heavy: 99 }));

    expect(shouldSkipPresetForDeviceTier('unmeasured', 'low')).toBe(false);
  });

  test('keeps every preset, measured or not, on mid and higher tiers', () => {
    installPresetFrameCostDataForTests(
      snapshot({ heavy: LOW_TIER_FRAME_WORK_BUDGET_MS * 10 }),
    );

    expect(shouldSkipPresetForDeviceTier('heavy', 'mid')).toBe(false);
    expect(shouldSkipPresetForDeviceTier('heavy', 'high')).toBe(false);
    expect(shouldSkipPresetForDeviceTier('heavy', 'ultra')).toBe(false);
  });

  test('with an empty sidecar, no preset is gated on any tier', () => {
    installPresetFrameCostDataForTests(snapshot({}));

    for (const tier of ['low', 'mid', 'high', 'ultra'] as const) {
      expect(shouldSkipPresetForDeviceTier('anything', tier)).toBe(false);
    }
  });

  test('the committed sidecar parses and holds no fabricated numbers', async () => {
    // The signal ships before the hardware runs that will populate it, so the
    // committed file must be schema-valid and empty. The coordinator fills it
    // with `lab:cost-ingest`; a hand-edited number here would gate real
    // devices on made-up data.
    const committed = parsePresetFrameCostData(
      await Bun.file('src/data/preset-frame-cost.json').json(),
    );
    expect(Object.keys(committed.entries)).toEqual([]);
  });
});

describe('parsePresetFrameCostData', () => {
  const validEntry = {
    frameWorkMs: 9.4,
    tier: 'test-machine',
    qualityStep: null,
    measuredAt: '2026-10-11',
    instrument: 'perf:certification-corpus',
  };

  test('accepts a valid snapshot and keeps the entry fields intact', () => {
    const parsed = parsePresetFrameCostData({
      version: 1,
      entries: { a: validEntry },
    });
    expect(parsed.entries.a).toEqual(validEntry);
  });

  test('rejects the wrong schema version', () => {
    expect(() => parsePresetFrameCostData({ version: 2, entries: {} })).toThrow(
      /unsupported version/u,
    );
  });

  test('rejects a non-positive frame cost', () => {
    expect(() =>
      parsePresetFrameCostData({
        version: 1,
        entries: { a: { ...validEntry, frameWorkMs: 0 } },
      }),
    ).toThrow(/frameWorkMs/u);
  });

  test('rejects a negative quality step', () => {
    expect(() =>
      parsePresetFrameCostData({
        version: 1,
        entries: { a: { ...validEntry, qualityStep: -1 } },
      }),
    ).toThrow(/qualityStep/u);
  });

  test('rejects a measuredAt that is not a YYYY-MM-DD date', () => {
    expect(() =>
      parsePresetFrameCostData({
        version: 1,
        entries: {
          a: { ...validEntry, measuredAt: '2026-10-11T10:00:00.000Z' },
        },
      }),
    ).toThrow(/measuredAt/u);
  });

  test('rejects an entry without a hardware tier label', () => {
    expect(() =>
      parsePresetFrameCostData({
        version: 1,
        entries: { a: { ...validEntry, tier: '' } },
      }),
    ).toThrow(/tier/u);
  });
});
