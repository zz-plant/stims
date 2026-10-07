/**
 * Record the measured evidence behind the first-run preset.
 *
 * The landing page makes one claim — "MilkDrop presets that move to
 * whatever you're listening to" — and the first-run preset is the only proof
 * of it most visitors ever see. The previous default was chosen on a variable
 * count (8 of 36 parameters read audio) that turned out not to predict
 * anything visible: measured at the pixel level it moved the same with demo
 * audio as in silence, and every parameter that drives visible motion — zoom,
 * rot, warp, sx, sy, decay — was static.
 *
 * So the choice is pinned to measurement instead of judgement, and the
 * measurement is checked in. `tests/unit/bundled-first-run-preset.test.ts` reads this
 * file and fails when the shipped default no longer matches the evidence, the
 * preset's bytes change, or the numbers fall below the bar. Regenerating is
 * the deliberate act of re-measuring.
 *
 * Every backend is measured at two viewports: the 1280x720 landscape default
 * and a 390x844 phone held upright. The second exists because the previous
 * default was lit on landscape and black on every phone: its per-pixel warp
 * centre sits in MilkDrop's aspect-squeezed space, so on a tall screen it
 * samples only the top and bottom rows. A landscape-only measurement cannot
 * see that, and most first visits come from phones.
 *
 * Merges one run at a time, because `lab:visual` writes every renderer and
 * viewport to the same path. Full refresh:
 *
 *   bun run lab:visual -- --preset <id> --renderer webgl --settle-ms 30000
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgpu --settle-ms 30000
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgl --settle-ms 30000 --viewport 390x844
 *   bun run generate:first-run-evidence
 *   bun run lab:visual -- --preset <id> --renderer webgpu --settle-ms 30000 --viewport 390x844
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
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';

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

type Backend = 'webgl' | 'webgpu';

/** The viewports every backend is measured at; see the header. */
export const FIRST_RUN_VIEWPORTS = {
  landscape: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
  portrait: { width: 390, height: 844 },
} as const;

type ViewportName = keyof typeof FIRST_RUN_VIEWPORTS;

type BackendEvidence = {
  /** Silence: what the landing page's attract preview shows. */
  meanLuminance: number;
  visiblePixelRatio: number;
  nearBlackFrameRatio: number;
  colorfulness: number;
  /**
   * Demo audio after ~30s: what a visitor watches once they press Play demo.
   * A preset can be lit in silence and black here — the previous default was,
   * on portrait.
   */
  steadyMeanLuminance: number;
  steadyVisiblePixelRatio: number;
  /** demo − silence. The visible answer to "does it respond to audio?". */
  luminanceDelta: number;
  /** demo ÷ silence pixel motion. 1.0 means audio changed nothing. */
  audioMotionRatio: number;
  verdict: string;
  captureBackend: string;
};

type ViewportEvidence = {
  width: number;
  height: number;
  backends: Partial<Record<Backend, BackendEvidence>>;
};

type Evidence = {
  presetId: string;
  presetSha256: string;
  viewports: Partial<Record<ViewportName, ViewportEvidence>>;
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
  const fresh = (): Evidence => ({
    presetId: FIRST_RUN_PRESET_ID,
    presetSha256: '',
    viewports: {},
  });
  if (!existsSync(EVIDENCE_PATH)) {
    return fresh();
  }
  const existing = readJson(EVIDENCE_PATH) as Partial<Evidence>;
  // A different preset means the old numbers describe something else, and a
  // file without `viewports` predates the portrait measurement. Start clean
  // rather than carrying either forward.
  if (existing.presetId !== FIRST_RUN_PRESET_ID || !existing.viewports) {
    return fresh();
  }
  return existing as Evidence;
}

function viewportName(viewport: { width: number; height: number }) {
  return viewport.height > viewport.width ? 'portrait' : 'landscape';
}

function mergeVisualReport(evidence: Evidence): void {
  const reportPath = join(LAB_DIR, 'visual', 'visual.json');
  if (!existsSync(reportPath)) {
    return;
  }

  const report = readJson(reportPath) as {
    presetId: string;
    renderer: Backend;
    viewport?: { width: number; height: number };
    captureBackend: string | null;
    scenarios: Record<
      'silence' | 'demo',
      {
        meanLuminance: number;
        visiblePixelRatio: number;
        nearBlackFrameRatio: number;
        colorfulness: number;
      }
    > & {
      steady?: { meanLuminance: number; visiblePixelRatio: number };
    };
    summary: {
      luminanceDelta: number;
      audioMotionRatio: number;
      verdict: string;
    };
  };

  if (report.presetId !== FIRST_RUN_PRESET_ID) {
    return;
  }
  const steady = report.scenarios.steady;
  if (!steady) {
    throw new Error(
      `${reportPath} has no steady scenario; re-run lab:visual to measure the settled frame.`,
    );
  }

  // Reports written before lab:visual took --viewport all used the default.
  const viewport = report.viewport ?? DEFAULT_VIEWPORT;
  const name = viewportName(viewport);
  const existing = evidence.viewports[name];
  // Numbers taken at another size describe another frame; drop them rather
  // than mix two sizes under one name.
  const entry: ViewportEvidence =
    existing?.width === viewport.width && existing.height === viewport.height
      ? existing
      : { width: viewport.width, height: viewport.height, backends: {} };
  evidence.viewports[name] = entry;

  entry.backends[report.renderer] = {
    meanLuminance: round(report.scenarios.silence.meanLuminance, 2),
    visiblePixelRatio: round(report.scenarios.silence.visiblePixelRatio),
    nearBlackFrameRatio: round(report.scenarios.silence.nearBlackFrameRatio),
    colorfulness: round(report.scenarios.silence.colorfulness),
    steadyMeanLuminance: round(steady.meanLuminance, 2),
    steadyVisiblePixelRatio: round(steady.visiblePixelRatio),
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
  return normalizeOrder(evidence);
}

/** Merge order varies run to run; the file's key order must not. */
function normalizeOrder(evidence: Evidence): Evidence {
  const viewports: Evidence['viewports'] = {};
  for (const name of Object.keys(FIRST_RUN_VIEWPORTS) as ViewportName[]) {
    const entry = evidence.viewports[name];
    if (!entry) continue;
    const backends: ViewportEvidence['backends'] = {};
    for (const backend of ['webgl', 'webgpu'] as const) {
      const measured = entry.backends[backend];
      if (measured) backends[backend] = measured;
    }
    viewports[name] = { width: entry.width, height: entry.height, backends };
  }
  return { ...evidence, viewports };
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
