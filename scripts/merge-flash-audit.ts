/**
 * Merge a photosensitivity audit report into the bundled preset catalog.
 *
 * scripts/analyze-preset-flash.ts measures presets and writes a report; this
 * turns that report into the `sensoryProfile` field the catalog ships and the
 * UI reads. Until this existed the audit's findings died in a JSON file on
 * someone's disk — the type was declared, the instrument ran, and no measured
 * result ever reached a user.
 *
 * Merging is additive and idempotent. Presets absent from the report keep
 * whatever profile they already had (usually none), because a partial audit
 * must never look like a clean bill of health for the rest of the catalog:
 * the UI distinguishes "measured, calm" from "not measured".
 *
 * Pass one report per display rate, and a preset's profile is the worse of
 * them, channel by channel. The audit at 60 fps is what most visitors see;
 * power saving caps the stage at 30, where time-driven colour moves twice as
 * far per frame and some presets flash that are calm at 60. A preset only
 * one of the reports covers is merged from that one, and the summary names
 * how many were.
 *
 * Usage:
 *   bun run scripts/merge-flash-audit.ts --in=flash-audit.json
 *   bun run scripts/merge-flash-audit.ts --in=audit-60.json --in=audit-30.json
 *   bun run scripts/merge-flash-audit.ts --in=report.json --check
 *   bun run scripts/merge-flash-audit.ts --in=report.json --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type FlashMeasurement,
  type PresetSensoryProfile,
  toSensoryProfile,
} from '../src/js/core/sensory-profile.ts';

const CATALOG_PATH = join(
  import.meta.dir,
  '..',
  'public',
  'milkdrop-presets',
  'catalog.json',
);

export type FlashReport = {
  /** The audit writes `presetId`; older reports in scratch/ used `id`. */
  presetId?: string;
  id?: string;
  error?: string;
  peakFlashesPerSecond?: number;
  peakRedFlashesPerSecond?: number;
  meanLuminance?: number;
  luminanceVolatility?: number;
  /** Absent from reports written before the audit recorded it. */
  maxFlashLuminanceDelta?: number;
};

/** A report file as `lab:flash-audit` writes it. */
type AuditFile = {
  generatedAt?: string;
  /** Display rate the frames were stepped at; reports before it ran at 60. */
  fps?: number;
  reports?: FlashReport[];
};

type CatalogEntry = {
  id: string;
  sensoryProfile?: PresetSensoryProfile;
  [key: string]: unknown;
};

function parseArgs(argv: string[]) {
  const get = (name: string) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  const inputs = argv
    .filter((a) => a.startsWith('--in='))
    .flatMap((a) => a.slice('--in='.length).split(','))
    .filter(Boolean);
  return {
    in: inputs.length > 0 ? inputs : ['flash-audit.json'],
    check: argv.includes('--check'),
    dryRun: argv.includes('--dry-run'),
    // The audit records when it ran; allow overriding for reproducible tests.
    measuredAt: get('measured-at'),
  };
}

/**
 * A capture whose picture is uniformly black or white and still. It cannot
 * show a flash: nothing changes, and the WCAG rule needs the darker frame
 * under 0.8. Presets that stay dark under the audit's synthetic
 * signal read this way (eos-heater-core-c at a mean luminance of 0.001,
 * even after a 15 s warm-up), and so do presets that saturate to white.
 */
const BLANK_LUMINANCE_FLOOR = 0.005;
const BLANK_LUMINANCE_CEILING = 0.95;
const BLANK_VOLATILITY_MAX = 0.001;

/**
 * A report row is usable only if it completed, carries both flash channels,
 * and captured a picture that could have flashed.
 *
 * The red channel is required, not defaulted to zero. Reports predating it
 * (scratch/flash-audit-sample50.json) would otherwise be merged as though a
 * red-flash measurement had been taken and come back clean — turning "not
 * measured" into "measured safe", which is the one direction a
 * photosensitivity signal must never fail in. Re-run the audit instead.
 * A blank capture is refused for the same reason: its zero says nothing
 * about the preset. A longer `--warmup` helps slow feedback builds; the
 * rest need real audio to be measured.
 */
export function toMeasurement(report: FlashReport): FlashMeasurement | null {
  if (report.error) return null;
  if (
    typeof report.peakFlashesPerSecond !== 'number' ||
    typeof report.peakRedFlashesPerSecond !== 'number' ||
    typeof report.meanLuminance !== 'number' ||
    typeof report.luminanceVolatility !== 'number'
  ) {
    return null;
  }
  if (
    report.luminanceVolatility < BLANK_VOLATILITY_MAX &&
    (report.meanLuminance < BLANK_LUMINANCE_FLOOR ||
      report.meanLuminance > BLANK_LUMINANCE_CEILING)
  ) {
    return null;
  }
  return {
    peakFlashesPerSecond: report.peakFlashesPerSecond,
    peakRedFlashesPerSecond: report.peakRedFlashesPerSecond,
    meanLuminance: report.meanLuminance,
    luminanceVolatility: report.luminanceVolatility,
    // Optional, unlike the red channel: without it the profile carries no
    // swing and the governor primes gently, which claims nothing.
    ...(typeof report.maxFlashLuminanceDelta === 'number'
      ? { maxFlashLuminanceDelta: report.maxFlashLuminanceDelta }
      : {}),
  };
}

/**
 * One preset's measurements at several display rates, as the worse of them.
 *
 * Each flash channel takes its own maximum, so red flashes at one rate and
 * general flashes at another both count. Mean luminance describes the
 * picture rather than a risk, so it is averaged.
 */
export function combineMeasurements(
  measurements: FlashMeasurement[],
): FlashMeasurement {
  if (measurements.length === 0) {
    throw new Error('combineMeasurements needs at least one measurement');
  }
  const max = (pick: (m: FlashMeasurement) => number) =>
    Math.max(...measurements.map(pick));
  return {
    peakFlashesPerSecond: max((m) => m.peakFlashesPerSecond),
    peakRedFlashesPerSecond: max((m) => m.peakRedFlashesPerSecond),
    luminanceVolatility: max((m) => m.luminanceVolatility),
    meanLuminance:
      measurements.reduce((sum, m) => sum + m.meanLuminance, 0) /
      measurements.length,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const measured = new Map<
    string,
    { measurements: FlashMeasurement[]; rates: Set<number>; at: string }
  >();
  const rates = new Set<number>();
  let skipped = 0;
  for (const file of args.in) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as AuditFile;
    const reports = raw.reports ?? [];
    if (reports.length === 0) {
      console.error(`No reports found in ${file}.`);
      process.exit(1);
    }
    const fps = raw.fps ?? 60;
    rates.add(fps);
    const at = args.measuredAt ?? raw.generatedAt ?? new Date().toISOString();
    for (const report of reports) {
      const id = report.presetId ?? report.id;
      if (!id) continue;
      const measurement = toMeasurement(report);
      if (!measurement) {
        skipped += 1;
        continue;
      }
      const entry = measured.get(id) ?? {
        measurements: [],
        rates: new Set<number>(),
        at,
      };
      entry.measurements.push(measurement);
      entry.rates.add(fps);
      if (at > entry.at) entry.at = at;
      measured.set(id, entry);
    }
  }

  const profiles = new Map<string, PresetSensoryProfile>();
  let partialRates = 0;
  for (const [id, entry] of measured) {
    if (entry.rates.size < rates.size) partialRates += 1;
    profiles.set(
      id,
      toSensoryProfile(combineMeasurements(entry.measurements), entry.at),
    );
  }

  const catalogRaw = readFileSync(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(catalogRaw) as { presets: CatalogEntry[] };

  let changed = 0;
  let unchanged = 0;
  let unmatched = 0;
  const matchedIds = new Set<string>();

  for (const entry of catalog.presets) {
    const profile = profiles.get(entry.id);
    if (!profile) continue;
    matchedIds.add(entry.id);
    if (JSON.stringify(entry.sensoryProfile) === JSON.stringify(profile)) {
      unchanged += 1;
      continue;
    }
    entry.sensoryProfile = profile;
    changed += 1;
  }
  for (const id of profiles.keys()) {
    if (!matchedIds.has(id)) unmatched += 1;
  }

  const withProfile = catalog.presets.filter((p) => p.sensoryProfile).length;
  const rateNote =
    rates.size > 1
      ? `${partialRates} of them at only some of ${[...rates].sort((a, b) => b - a).join('/')} fps, `
      : '';
  const summary =
    `${profiles.size} measured (${skipped} unusable), ` +
    rateNote +
    `${changed} updated, ${unchanged} already current, ` +
    `${unmatched} not in catalog. ` +
    `Coverage now ${withProfile}/${catalog.presets.length} ` +
    `(${Math.round((100 * withProfile) / catalog.presets.length)}%).`;

  if (args.check) {
    if (changed > 0) {
      console.error(`Catalog sensory profiles are stale. ${summary}`);
      console.error('Run: bun run catalog:merge-flash -- --in=<report.json>');
      process.exit(1);
    }
    console.log(`Catalog sensory profiles are current. ${summary}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[dry run] ${summary}`);
    return;
  }

  writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(summary);
}

// Import-safe: the tests exercise toMeasurement directly.
if (import.meta.main) {
  main();
}
