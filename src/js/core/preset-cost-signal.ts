/**
 * Per-preset performance-cost signal — the one place a measured frame cost
 * becomes an autoplay/shuffle skip.
 *
 * The catalog has no cost field (it is generated from .milk sources and
 * guards, and a cost is a property of a *measurement*, not of the file), so
 * the numbers live in a sidecar: `src/data/preset-frame-cost.json`, keyed by
 * preset id. Entries are written by `bun run lab:cost-ingest` from a
 * `perf:certification-corpus` run; `tests/unit/bundled-preset-frame-cost.test.ts`
 * and `bun run check:preset-cost` gate what ships. An absent entry means
 * "unmeasured", and unmeasured presets are kept — same contract as the flash
 * safety profile (see sensory-profile.ts): hiding everything the lab has not
 * covered would shrink the pool to whatever happens to be measured and imply
 * the rest had been cleared.
 *
 * Only the `low` device tier reads this signal today, and only autoplay and
 * shuffle consume it — Browse ranking is deliberately untouched (a heavy
 * preset someone explicitly searches for must still be there).
 */

import committedFrameCostJson from '../../data/preset-frame-cost.json' with {
  type: 'json',
};
import { type DeviceTier, getDeviceTier } from './device-profile.ts';

/** Schema marker; bump and migrate when the entry shape changes. */
export const PRESET_FRAME_COST_SCHEMA_VERSION = 1;

/** One preset's measured frame cost, as the ingest script recorded it. */
export type PresetFrameCostEntry = {
  /**
   * Median average frame work in ms, sampled by the perf suite's sampler
   * (see `aggregateMetrics.medianAverageFrameMs` in
   * scripts/run-certification-corpus-perf-suite.ts). Measured on reference
   * hardware at the run's viewport and quality step, not on the device the
   * gate runs on — that translation is the threshold below.
   */
  frameWorkMs: number;
  /** Hardware label of the machine the run measured on, e.g. 'apple-m2-pro'. */
  tier: string;
  /**
   * 0-based adaptive-quality step index the run pinned with
   * `--lock-quality-step`, or null when the run let quality adapt. Numbers
   * from an adaptive run are not comparable to pinned ones, which is why the
   * step ships with the measurement.
   */
  qualityStep: number | null;
  /** ISO date (YYYY-MM-DD) of the measurement run. */
  measuredAt: string;
  /** The npm script that produced the measurement, e.g. 'perf:certification-corpus'. */
  instrument: string;
};

/** The committed sidecar: one entry per measured preset id. */
export type PresetFrameCostData = {
  version: typeof PRESET_FRAME_COST_SCHEMA_VERSION;
  entries: Record<string, PresetFrameCostEntry>;
};

/**
 * Above this recorded frame work (ms, on the measurement hardware), a `low`
 * tier device stops being handed the preset during autoplay and shuffle.
 *
 * The measurements come from reference hardware against the 16.7ms frame
 * budget. A low-tier device sustains a fraction of that throughput — the
 * perf suite models one with a 4x CPU throttle (`perf:low-resource`) and
 * still measures misses in multiples, not percentages — so a preset that
 * already needs more than ~70% of the reference budget cannot hold 60fps
 * there. 12ms keeps the gate conservative in both directions: presets well
 * under it are never excluded on partial data, and anything above it is
 * expensive enough that a weak device gains more from skipping it than the
 * pool loses from holding it.
 */
export const LOW_TIER_FRAME_WORK_BUDGET_MS = 12;

const MEASURED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Parses and validates a sidecar snapshot. Throws on anything invalid so a
 * bad ingest fails at the tool boundary instead of shipping a gate that
 * silently reads garbage.
 */
export function parsePresetFrameCostData(raw: unknown): PresetFrameCostData {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Preset frame-cost data must be an object.');
  }
  const { version, entries } = raw as {
    version?: unknown;
    entries?: unknown;
  };
  if (version !== PRESET_FRAME_COST_SCHEMA_VERSION) {
    throw new Error(
      `Preset frame-cost data has unsupported version ${String(version)} ` +
        `(expected ${PRESET_FRAME_COST_SCHEMA_VERSION}).`,
    );
  }
  if (
    typeof entries !== 'object' ||
    entries === null ||
    Array.isArray(entries)
  ) {
    throw new Error('Preset frame-cost data needs an `entries` object.');
  }
  const parsed: Record<string, PresetFrameCostEntry> = {};
  for (const [presetId, entry] of Object.entries(
    entries as Record<string, unknown>,
  )) {
    if (!presetId) {
      throw new Error('Preset frame-cost entries need preset ids as keys.');
    }
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Frame-cost entry for "${presetId}" must be an object.`);
    }
    const candidate = entry as Record<string, unknown>;
    const { frameWorkMs, tier, qualityStep, measuredAt, instrument } =
      candidate;
    if (
      typeof frameWorkMs !== 'number' ||
      !Number.isFinite(frameWorkMs) ||
      frameWorkMs <= 0
    ) {
      throw new Error(
        `Frame-cost entry for "${presetId}" needs a positive finite frameWorkMs.`,
      );
    }
    if (typeof tier !== 'string' || tier.length === 0) {
      throw new Error(
        `Frame-cost entry for "${presetId}" needs a hardware tier label.`,
      );
    }
    if (
      qualityStep !== null &&
      (typeof qualityStep !== 'number' ||
        !Number.isInteger(qualityStep) ||
        qualityStep < 0)
    ) {
      throw new Error(
        `Frame-cost entry for "${presetId}" needs qualityStep as a non-negative integer or null.`,
      );
    }
    if (
      typeof measuredAt !== 'string' ||
      !MEASURED_AT_PATTERN.test(measuredAt)
    ) {
      throw new Error(
        `Frame-cost entry for "${presetId}" needs measuredAt as a YYYY-MM-DD date.`,
      );
    }
    if (typeof instrument !== 'string' || instrument.length === 0) {
      throw new Error(
        `Frame-cost entry for "${presetId}" needs the instrument that measured it.`,
      );
    }
    parsed[presetId] = {
      frameWorkMs,
      tier,
      qualityStep,
      measuredAt,
      instrument,
    };
  }
  return { version: PRESET_FRAME_COST_SCHEMA_VERSION, entries: parsed };
}

/**
 * The committed sidecar, or null when it fails to parse. Null rather than a
 * throw on purpose: this runs at module load in the app, and a malformed data
 * file must degrade to "no signal" (today's behaviour), never take the stage
 * down with it. The guard test fails such a file before it can ship anyway.
 */
function readCommittedData(): PresetFrameCostData | null {
  try {
    return parsePresetFrameCostData(committedFrameCostJson);
  } catch {
    return null;
  }
}

const committedData = readCommittedData();

let activeData: PresetFrameCostData | null = committedData;

/** Test seam: installs a snapshot the gate reads instead of the committed one. */
export function installPresetFrameCostDataForTests(raw: unknown): void {
  activeData = parsePresetFrameCostData(raw);
}

/** Test seam: returns to the committed sidecar. */
export function resetPresetFrameCostData(): void {
  activeData = committedData;
}

/** Recorded frame work for a preset in ms, or null when it is unmeasured. */
export function getPresetFrameWorkMs(presetId: string): number | null {
  const entry = activeData?.entries[presetId];
  return entry ? entry.frameWorkMs : null;
}

/**
 * Whether autoplay and shuffle should skip this preset on the given device
 * tier. False whenever the preset is unmeasured, so a sparse sidecar changes
 * nothing: an empty `entries` object is exactly the pre-signal selection pool.
 */
export function shouldSkipPresetForDeviceTier(
  presetId: string,
  tier: DeviceTier = getDeviceTier(),
): boolean {
  if (tier !== 'low') return false;
  const frameWorkMs = getPresetFrameWorkMs(presetId);
  return frameWorkMs !== null && frameWorkMs > LOW_TIER_FRAME_WORK_BUDGET_MS;
}
