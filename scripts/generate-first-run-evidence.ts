/**
 * Record the measured evidence behind the first-run preset.
 *
 * The landing page makes one claim — "full-screen visuals that move to
 * whatever you're listening to" — and the first-run preset is the only proof
 * of it most visitors ever see. The previous default was chosen on a variable
 * count (8 of 36 parameters read audio) that turned out not to predict
 * anything visible: measured at the pixel level it moved the same with demo
 * audio as in silence, and every parameter that drives visible motion — zoom,
 * rot, warp, sx, sy, decay — was static.
 *
 * So the choice is pinned to measurement instead of judgement, and the
 * measurement is checked in. `tests/unit/first-run-preset.test.ts` reads this
 * file and fails when the shipped default no longer matches the evidence, the
 * preset's bytes change, or the numbers fall below the bar. Regenerating is
 * the deliberate act of re-measuring.
 *
 * Merges one backend at a time, because `lab:visual` writes both renderers to
 * the same path. Full refresh:
 *
 *   bun run lab:visual -- --preset <id> --renderer webgl
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgpu
 *   bun run generate:first-run-evidence
 *   bun run lab:reactivity -- --preset <id>
 *   bun run generate:first-run-evidence
 *
 * Usage:
 *   bun run scripts/generate-first-run-evidence.ts
 *   bun run scripts/generate-first-run-evidence.ts --check
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIRST_RUN_PRESET_ID } from '../src/js/milkdrop/runtime/first-run-preset.ts';

const REPO_ROOT = join(import.meta.dir, '..');
const EVIDENCE_PATH = join(
  REPO_ROOT,
  'src',
  'data',
  'first-run-preset-evidence.json',
);
const LAB_DIR = join(REPO_ROOT, 'scratch', 'preset-lab', FIRST_RUN_PRESET_ID);
const CATALOG_PATH = join(
  REPO_ROOT,
  'public',
  'milkdrop-presets',
  'catalog.json',
);

/**
 * Where the first-run preset's source actually lives.
 *
 * Not `public/milkdrop-presets/<id>.milk`: the default can legitimately be a
 * preset from one of the bundled libraries, which live in subdirectories. The
 * catalog's `file` field is the one place that mapping is already recorded,
 * so resolving through it keeps the default free to be any catalog entry
 * without a second copy of the file at the top level.
 *
 * Exported because the first-run guard test needs the same answer, and two
 * independent path guesses would be one more thing to drift.
 */
export function resolveFirstRunPresetPath(): string {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
    presets: Array<{ id: string; file?: string }>;
  };
  const entry = catalog.presets.find(
    (preset) => preset.id === FIRST_RUN_PRESET_ID,
  );
  if (!entry?.file) {
    throw new Error(
      `First-run preset "${FIRST_RUN_PRESET_ID}" is not in the bundled catalog.`,
    );
  }
  return join(REPO_ROOT, 'public', entry.file.replace(/^\//u, ''));
}

type BackendEvidence = {
  meanLuminance: number;
  visiblePixelRatio: number;
  nearBlackFrameRatio: number;
  colorfulness: number;
  /** demo − silence. The visible answer to "does it respond to audio?". */
  luminanceDelta: number;
  /** demo ÷ silence pixel motion. 1.0 means audio changed nothing. */
  audioMotionRatio: number;
  verdict: string;
  captureBackend: string;
};

type Evidence = {
  presetId: string;
  presetSha256: string;
  backends: Partial<Record<'webgl' | 'webgpu', BackendEvidence>>;
  reactivity?: {
    reactiveVariables: number;
    totalVariables: number;
    /** Reactive variables that actually drive visible motion. */
    motionBearing: Array<{ variable: string; correlation: number }>;
  };
};

/**
 * Variables whose movement the visitor can see as movement. The previous
 * default's reactivity lived entirely outside this set, which is why its
 * parameter count looked healthy while the screen did not move with the
 * music.
 */
const MOTION_BEARING = new Set([
  'zoom',
  'rot',
  'warp',
  'dx',
  'dy',
  'sx',
  'sy',
  'cx',
  'cy',
  'decay',
  'shapes.motion',
]);

/** Correlation below this is noise, not a response. */
const MOTION_BEARING_MIN_CORRELATION = 0.3;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function loadExisting(): Evidence {
  if (!existsSync(EVIDENCE_PATH)) {
    return { presetId: FIRST_RUN_PRESET_ID, presetSha256: '', backends: {} };
  }
  const existing = readJson(EVIDENCE_PATH) as Evidence;
  // A different preset means the old numbers describe something else. Start
  // clean rather than carrying a stale backend forward under a new id.
  if (existing.presetId !== FIRST_RUN_PRESET_ID) {
    return { presetId: FIRST_RUN_PRESET_ID, presetSha256: '', backends: {} };
  }
  return existing;
}

function mergeVisualReport(evidence: Evidence): void {
  const reportPath = join(LAB_DIR, 'visual', 'visual.json');
  if (!existsSync(reportPath)) {
    return;
  }

  const report = readJson(reportPath) as {
    presetId: string;
    renderer: 'webgl' | 'webgpu';
    captureBackend: string | null;
    scenarios: Record<
      'silence' | 'demo',
      {
        meanLuminance: number;
        visiblePixelRatio: number;
        nearBlackFrameRatio: number;
        colorfulness: number;
      }
    >;
    summary: {
      luminanceDelta: number;
      audioMotionRatio: number;
      verdict: string;
    };
  };

  if (report.presetId !== FIRST_RUN_PRESET_ID) {
    return;
  }

  evidence.backends[report.renderer] = {
    meanLuminance: round(report.scenarios.silence.meanLuminance, 2),
    visiblePixelRatio: round(report.scenarios.silence.visiblePixelRatio),
    nearBlackFrameRatio: round(report.scenarios.silence.nearBlackFrameRatio),
    colorfulness: round(report.scenarios.silence.colorfulness),
    luminanceDelta: round(report.summary.luminanceDelta, 2),
    audioMotionRatio: round(report.summary.audioMotionRatio),
    verdict: report.summary.verdict,
    captureBackend: report.captureBackend ?? 'unknown',
  };
}

function mergeReactivityReport(evidence: Evidence): void {
  const reportPath = join(LAB_DIR, 'reactivity.json');
  if (!existsSync(reportPath)) {
    return;
  }

  const report = readJson(reportPath) as {
    presetId: string;
    variables: Array<{
      variable: string;
      scenarios: Record<string, { correlation: number; stdDev: number }>;
    }>;
  };
  if (report.presetId !== FIRST_RUN_PRESET_ID) {
    return;
  }

  const motionBearing: Array<{ variable: string; correlation: number }> = [];
  let reactive = 0;
  for (const entry of report.variables) {
    const scenarios = Object.values(entry.scenarios ?? {});
    const correlation = Math.max(
      0,
      ...scenarios.map((scenario) => Math.abs(scenario.correlation ?? 0)),
    );
    const spread = Math.max(
      0,
      ...scenarios.map((scenario) => Math.abs(scenario.stdDev ?? 0)),
    );
    if (correlation >= MOTION_BEARING_MIN_CORRELATION && spread > 1e-6) {
      reactive += 1;
      if (MOTION_BEARING.has(entry.variable)) {
        motionBearing.push({
          variable: entry.variable,
          correlation: round(correlation, 3),
        });
      }
    }
  }

  motionBearing.sort((a, b) => b.correlation - a.correlation);
  evidence.reactivity = {
    reactiveVariables: reactive,
    totalVariables: report.variables.length,
    motionBearing,
  };
}

function build(): Evidence {
  const evidence = loadExisting();
  evidence.presetId = FIRST_RUN_PRESET_ID;
  evidence.presetSha256 = createHash('sha256')
    .update(readFileSync(resolveFirstRunPresetPath()))
    .digest('hex');
  mergeVisualReport(evidence);
  mergeReactivityReport(evidence);
  return evidence;
}

function serialize(evidence: Evidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export const FIRST_RUN_EVIDENCE_PATH = EVIDENCE_PATH;

if (import.meta.main) {
  const next = serialize(build());
  if (process.argv.includes('--check')) {
    const current = existsSync(EVIDENCE_PATH)
      ? readFileSync(EVIDENCE_PATH, 'utf8')
      : '';
    if (current !== next) {
      console.error(
        `first-run preset evidence is stale (${EVIDENCE_PATH}).\n` +
          'Re-measure and regenerate — see the header of ' +
          'scripts/generate-first-run-evidence.ts for the command sequence.',
      );
      process.exit(1);
    }
    console.log('first-run preset evidence is current.');
  } else {
    writeFileSync(EVIDENCE_PATH, next);
    console.log(`Wrote ${EVIDENCE_PATH}`);
  }
}
