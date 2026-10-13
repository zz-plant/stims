/**
 * Merges a perf-certification run into the committed per-preset frame-cost
 * sidecar (`src/data/preset-frame-cost.json`), the signal autoplay and
 * shuffle read to keep frame-hungry presets away from low-tier devices.
 *
 * The sidecar is a sidecar because the catalog cannot carry these numbers:
 * `public/milkdrop-presets/catalog.json` is generated from .milk sources and
 * guarded byte-for-byte (check:catalog-integrity, check:catalog-fidelity), and
 * a frame cost is a property of a measurement run, not of the preset file.
 * Keying a separate file by preset id adds the signal without touching the
 * generator — the same separation the flash audit took (catalog field, fed by
 * catalog:merge-flash) would have needed a third party to re-run for.
 *
 * Input is a `perf:certification-corpus` summary.json (one file holding every
 * per-preset report, see scripts/run-certification-corpus-perf-suite.ts).
 * Reports without aggregate metrics (status 'error') are ignored, and preset
 * ids that are not in the bundled catalog are skipped with a note — the
 * certification corpus deliberately includes fixtures the shipped catalog
 * does not contain, and the gate would never look those ids up.
 *
 * Coordinator command to populate the sidecar with real hardware data
 * (run on the measurement machine, from the repo root):
 *
 *   bun run perf:certification-corpus -- --output ./scratch/cost-signal --lock-quality-step 1
 *   bun run lab:cost-ingest -- --summary ./scratch/cost-signal/summary.json \
 *       --tier <hardware-label> --quality-step 1
 *
 * `--quality-step` records the step the perf run pinned with
 * `--lock-quality-step`; pass neither when the run let quality adapt, and
 * record `null`. After ingesting, `bun run check:preset-cost` verifies the
 * committed file (schema, catalog ids, canonical formatting) and
 * `bun run test` runs the behavioural gate tests over it.
 *
 * Usage:
 *   bun run scripts/preset-lab-cost-ingest.ts --summary <path> --tier <label> [--quality-step <n>] [--instrument <name>]
 *   bun run scripts/preset-lab-cost-ingest.ts --check [--summary <path> --tier <label> [--quality-step <n>]]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRESET_FRAME_COST_SCHEMA_VERSION,
  type PresetFrameCostData,
  parsePresetFrameCostData,
} from '../src/js/core/preset-cost-signal.ts';
import type { CertificationCorpusPerfSummary } from './run-certification-corpus-perf-suite.ts';

const REPO_ROOT = join(import.meta.dir, '..');
const SIDECAR_PATH = join(REPO_ROOT, 'src', 'data', 'preset-frame-cost.json');
const CATALOG_PATH = join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'catalog.json',
);

export const PRESET_FRAME_COST_PATH = SIDECAR_PATH;

/** The npm script that runs the perf suite this ingest reads from. */
const DEFAULT_INSTRUMENT = 'perf:certification-corpus';

/** How many decimals a frame-work figure keeps; noise beyond this is host jitter. */
const FRAME_WORK_DECIMALS = 2;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The bundled catalog's preset ids, so stray fixture ids cannot ship. */
export function collectBundledCatalogIds(): Set<string> {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
    presets: Array<{ id: string }>;
  };
  return new Set(catalog.presets.map((preset) => preset.id));
}

/**
 * The entries one perf summary contributes to the sidecar. Pure: same sidecar
 * state plus same summary yields the same file, which is what `--check`
 * compares against.
 */
export function buildPresetFrameCostData({
  existing,
  summary,
  tier,
  qualityStep,
  instrument = DEFAULT_INSTRUMENT,
  catalogIds,
}: {
  existing: PresetFrameCostData;
  summary: CertificationCorpusPerfSummary;
  tier: string;
  qualityStep: number | null;
  instrument?: string;
  catalogIds: ReadonlySet<string>;
}): { data: PresetFrameCostData; skipped: string[] } {
  if (summary.version !== 1) {
    throw new Error(
      `Perf summary has unsupported version ${String(summary.version)} (expected 1).`,
    );
  }
  // The summary's own timestamp is the run's provenance; using it (rather than
  // "today") keeps re-running --check against the same summary deterministic.
  const measuredAt = (summary.generatedAt ?? '').slice(0, 10);

  const entries: PresetFrameCostData['entries'] = { ...existing.entries };
  const skipped: string[] = [];
  for (const report of summary.reports) {
    const frameWorkMs = report.aggregateMetrics?.medianAverageFrameMs;
    // An error report measured nothing, and a fixture outside the shipped
    // catalog is a cost the runtime can never consume.
    if (typeof frameWorkMs !== 'number' || !Number.isFinite(frameWorkMs)) {
      continue;
    }
    if (!catalogIds.has(report.presetId)) {
      skipped.push(report.presetId);
      continue;
    }
    entries[report.presetId] = {
      frameWorkMs: round(frameWorkMs, FRAME_WORK_DECIMALS),
      tier,
      qualityStep,
      measuredAt,
      instrument,
    };
  }
  return {
    data: { version: PRESET_FRAME_COST_SCHEMA_VERSION, entries },
    skipped,
  };
}

/**
 * Canonical text for the sidecar: entry keys sorted so diffs show real
 * measurement changes rather than run order, formatting fixed so `--check`
 * can compare bytes.
 */
export function serializePresetFrameCostData(
  data: PresetFrameCostData,
): string {
  const entries: PresetFrameCostData['entries'] = {};
  for (const key of Object.keys(data.entries).sort()) {
    entries[key] = data.entries[key];
  }
  return `${JSON.stringify({ ...data, entries }, null, 2)}\n`;
}

function loadSidecar(): PresetFrameCostData {
  if (!existsSync(SIDECAR_PATH)) {
    throw new Error(`Sidecar missing: ${SIDECAR_PATH}`);
  }
  return parsePresetFrameCostData(
    JSON.parse(readFileSync(SIDECAR_PATH, 'utf8')),
  );
}

function readSummary(path: string): CertificationCorpusPerfSummary {
  return JSON.parse(
    readFileSync(path, 'utf8'),
  ) as CertificationCorpusPerfSummary;
}

function parseQualityStep(argv: string[]): number | null {
  const index = argv.indexOf('--quality-step');
  if (index === -1 || index + 1 >= argv.length) return null;
  const raw = argv[index + 1] ?? '';
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `--quality-step must be a non-negative integer, got "${raw}".`,
    );
  }
  return value;
}

function getStringArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index !== -1 && index + 1 < argv.length
    ? (argv[index + 1] ?? null)
    : null;
}

function usage() {
  console.error(
    'Usage: bun run scripts/preset-lab-cost-ingest.ts --summary <path> --tier <label> ' +
      '[--quality-step <n>] [--instrument <name>]\n' +
      '       bun run scripts/preset-lab-cost-ingest.ts --check ' +
      '[--summary <path> --tier <label> [--quality-step <n>]]',
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    usage();
    return;
  }
  const check = argv.includes('--check');
  const summaryPath = getStringArg(argv, '--summary');
  const tier = getStringArg(argv, '--tier');
  const qualityStep = parseQualityStep(argv);
  const instrument = getStringArg(argv, '--instrument') ?? DEFAULT_INSTRUMENT;

  const catalogIds = collectBundledCatalogIds();
  const sidecar = loadSidecar();
  // Ids the shipped catalog does not contain would never be looked up at
  // runtime, so a sidecar carrying one is drift from a fixture run.
  const unknownIds = Object.keys(sidecar.entries).filter(
    (id) => !catalogIds.has(id),
  );
  if (unknownIds.length > 0) {
    console.error(
      `Preset frame-cost sidecar has ${unknownIds.length} id(s) not in the bundled catalog ` +
        `(first: "${unknownIds[0]}"). Remove them with scripts/preset-lab-cost-ingest.ts.`,
    );
    process.exit(1);
  }
  let expected = serializePresetFrameCostData(sidecar);
  let outcome: string | null = null;

  if (summaryPath) {
    if (!tier) {
      console.error(
        '--tier is required with --summary: frame costs are only meaningful ' +
          'with the hardware they were measured on.',
      );
      process.exit(1);
    }
    const summary = readSummary(summaryPath);
    const built = buildPresetFrameCostData({
      existing: sidecar,
      summary,
      tier,
      qualityStep,
      instrument,
      catalogIds,
    });
    expected = serializePresetFrameCostData(built.data);
    for (const id of built.skipped) {
      console.log(
        `Skipped "${id}": not in the bundled catalog (certification fixture).`,
      );
    }
    outcome = `${Object.keys(built.data.entries).length} entries total, ${built.skipped.length} fixture id(s) skipped`;
  }

  if (check) {
    const current = readFileSync(SIDECAR_PATH, 'utf8');
    if (current !== expected) {
      console.error(
        `Preset frame-cost sidecar is stale or malformed (${SIDECAR_PATH}).\n` +
          'Re-run the perf suite and ingest — see the coordinator command at the top of ' +
          'scripts/preset-lab-cost-ingest.ts.',
      );
      process.exit(1);
    }
    console.log(
      summaryPath
        ? `Preset frame-cost sidecar matches the summary (${outcome}).`
        : 'Preset frame-cost sidecar is valid and canonical.',
    );
    return;
  }

  if (!summaryPath) {
    usage();
    process.exit(1);
  }
  writeFileSync(SIDECAR_PATH, expected);
  console.log(`Wrote ${SIDECAR_PATH} (${outcome}).`);
}

if (import.meta.main) {
  main();
}
