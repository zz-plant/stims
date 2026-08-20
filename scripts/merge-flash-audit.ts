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
 * Usage:
 *   bun run scripts/merge-flash-audit.ts --in=flash-audit.json
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
  return {
    in: get('in') ?? 'flash-audit.json',
    check: argv.includes('--check'),
    dryRun: argv.includes('--dry-run'),
    // The audit records when it ran; allow overriding for reproducible tests.
    measuredAt: get('measured-at'),
  };
}

/**
 * A report row is usable only if it completed *and* carries both flash
 * channels.
 *
 * The red channel is required, not defaulted to zero. Reports predating it
 * (scratch/flash-audit-sample50.json) would otherwise be merged as though a
 * red-flash measurement had been taken and come back clean — turning "not
 * measured" into "measured safe", which is the one direction a
 * photosensitivity signal must never fail in. Re-run the audit instead.
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
  return {
    peakFlashesPerSecond: report.peakFlashesPerSecond,
    peakRedFlashesPerSecond: report.peakRedFlashesPerSecond,
    meanLuminance: report.meanLuminance,
    luminanceVolatility: report.luminanceVolatility,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const raw = JSON.parse(readFileSync(args.in, 'utf8')) as {
    reports?: FlashReport[];
    generatedAt?: string;
  };
  const reports = raw.reports ?? [];
  if (reports.length === 0) {
    console.error(`No reports found in ${args.in}.`);
    process.exit(1);
  }

  const measuredAt =
    args.measuredAt ?? raw.generatedAt ?? new Date().toISOString();

  const profiles = new Map<string, PresetSensoryProfile>();
  let skipped = 0;
  for (const report of reports) {
    const id = report.presetId ?? report.id;
    if (!id) continue;
    const measurement = toMeasurement(report);
    if (!measurement) {
      skipped += 1;
      continue;
    }
    profiles.set(id, toSensoryProfile(measurement, measuredAt));
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
  const summary =
    `${profiles.size} measured (${skipped} unusable), ` +
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
