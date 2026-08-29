/**
 * Per-frame variable-trace oracle: Stims vs Butterchurn 2.6.7.
 *
 * Pixel-diffing (capture-certification-corpus, parity suites) answers "does
 * this look different" but not "which variable, on which frame" — the exact
 * gap that made the wave-brightness fidelity investigation take days of
 * eyeballing. This drives both engines frame-by-frame off the SAME preset
 * and audio state and diffs their per-frame variable bags (zoom, rot,
 * q1..q32, ...) directly, so a divergence is reported as
 * "zoom disagreed by 0.4 starting at frame 12", not a pixel delta.
 *
 * Deterministic and silent-audio, reusing the fairness controls learned in
 * bench-vs-butterchurn.ts (read that file's header before changing either):
 * one engine per browser process, matched-title pairing over the shared
 * Butterchurn-derived corpus, gl.finish() is irrelevant here (no timing),
 * but the UMD/global quirks (control 6) and preset-loaded-by-boot-URL
 * discipline (control 2) still apply.
 *
 * Frame alignment: Stims steps via renderFrames({frames: 1}) — one
 * synchronous simulation frame per call, decoupled from wall clock and rAF
 * (the same mechanism the preview generator uses) — and Butterchurn steps
 * via one visualizer.render() call. Both read their variable bag
 * immediately after that single step, so frame N on one side is frame N on
 * the other; a divergence's frame index is directly comparable, not a
 * rAF-sampling artifact. (Earlier versions of this tool sampled Stims'
 * live rAF loop and could not make that guarantee — first-divergence
 * findings from before this comment was added should be re-verified.)
 *
 * Usage:
 *   bun run trace:butterchurn                       # 8 presets, 60 frames
 *   bun run trace:butterchurn -- --ids=geiss-casino
 *   bun run trace:butterchurn -- --frames=180 --sample=20
 *   bun run trace:butterchurn -- --tolerance=0.02
 *
 * Not wired into CI: needs a real GPU (Stims side) and is an investigation
 * tool, not a pass/fail gate — presets diverge from Butterchurn for known,
 * accepted reasons (see docs/MILKDROP_PROJECTM_PARITY_BACKLOG.md), so a
 * fixed threshold would just be noise. Read the report; decide per-finding.
 */

import { readFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const DEFAULT_PORT = 5191;
const DEFAULT_SAMPLE = 8;
const DEFAULT_FRAMES = 60;
const DEFAULT_TOLERANCE = 0.01;
const VIEWPORT = { width: 640, height: 360 };
const BOOT_TIMEOUT_MS = 60000;
const STEP_TIMEOUT_MS = 60000;

const BUTTERCHURN_LIB = 'node_modules/butterchurn/lib/butterchurn.min.js';
const PRESETS_LIB =
  'node_modules/butterchurn-presets/lib/butterchurnPresets.min.js';

interface CatalogPreset {
  id: string;
  title: string;
  file: string;
}

interface Pair {
  id: string;
  bcKey: string;
}

interface Divergence {
  frame: number;
  variable: string;
  stims: number;
  butterchurn: number;
  delta: number;
}

interface TraceResult {
  id: string;
  bcKey: string;
  framesCompared: number;
  firstDivergence: Divergence | null;
  divergentVariables: string[];
  error?: string;
}

class StepTimeout extends Error {
  constructor(label: string, ms: number) {
    super(`timed out after ${ms}ms: ${label}`);
    this.name = 'StepTimeout';
  }
}

async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StepTimeout(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseArgs() {
  const args = {
    port: DEFAULT_PORT,
    sample: DEFAULT_SAMPLE,
    frames: DEFAULT_FRAMES,
    tolerance: DEFAULT_TOLERANCE,
    ids: null as string[] | null,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--port=')) args.port = Number(arg.slice(7));
    if (arg.startsWith('--sample=')) args.sample = Number(arg.slice(9));
    if (arg.startsWith('--frames=')) args.frames = Number(arg.slice(9));
    if (arg.startsWith('--tolerance=')) args.tolerance = Number(arg.slice(12));
    if (arg.startsWith('--ids=')) args.ids = arg.slice(6).split(',');
  }
  return args;
}

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
}

async function readButterchurnKeys(presetsSrc: string): Promise<string[]> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.addScriptTag({ content: presetsSrc });
    return (await page.evaluate(() => {
      const root = (
        window as unknown as {
          butterchurnPresets?: { getPresets?: () => Record<string, unknown> };
        }
      ).butterchurnPresets;
      const presets = root?.getPresets ? root.getPresets() : (root ?? {});
      return Object.keys(presets);
    })) as string[];
  } finally {
    await browser.close();
  }
}

/**
 * The variable names both engines are asked to agree on. Chosen for what
 * downstream rendering actually reads: motion/warp transform state (the
 * biggest visual-difference lever) plus the q-register bank (custom-wave
 * and custom-shape driver values). Both sides key their bag by these same
 * lowercase names — Stims via `frameState.variables`, Butterchurn via
 * `mdVSFrame`.
 */
const TRACE_VARIABLES = [
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'cx',
  'cy',
  'sx',
  'sy',
  'dx',
  'dy',
  'decay',
  ...Array.from({ length: 8 }, (_, i) => `q${i + 1}`),
];

async function traceButterchurn(
  browser: Browser,
  butterchurnSrc: string,
  presetsSrc: string,
  bcKey: string,
  frames: number,
): Promise<Array<Record<string, number>> | null> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    await page.setContent(
      `<canvas id="c" width="${VIEWPORT.width}" height="${VIEWPORT.height}"></canvas>`,
    );
    await page.addScriptTag({ content: butterchurnSrc });
    await page.addScriptTag({ content: presetsSrc });
    return (await withDeadline(
      page.evaluate(
        ({ key, frameCount, width, height, vars }) => {
          const win = window as unknown as Record<string, unknown>;
          const api =
            (win.butterchurn as { default?: unknown }).default ??
            win.butterchurn;
          const audio = new AudioContext();
          const canvas = document.getElementById('c') as HTMLCanvasElement;
          canvas.width = width;
          canvas.height = height;
          const visualizer = (
            api as {
              createVisualizer: (
                a: unknown,
                c: unknown,
                o: unknown,
              ) => {
                connectAudio: (n: unknown) => void;
                loadPreset: (p: unknown, b: number) => void;
                render: () => void;
                renderer: {
                  presetEquationRunner: {
                    mdVSFrame: Record<string, number> | null;
                  };
                };
              };
            }
          ).createVisualizer(audio, canvas, { width, height, pixelRatio: 1 });
          visualizer.connectAudio(audio.createGain());
          const root = win.butterchurnPresets as {
            getPresets?: () => Record<string, unknown>;
          };
          const presets = root.getPresets ? root.getPresets() : root;
          const preset = (presets as Record<string, unknown>)[key];
          if (!preset) return null;
          visualizer.loadPreset(preset, 0);

          const out: Array<Record<string, number>> = [];
          for (let i = 0; i < frameCount; i++) {
            visualizer.render();
            const frame = visualizer.renderer.presetEquationRunner.mdVSFrame;
            const row: Record<string, number> = {};
            for (const v of vars) {
              row[v] = typeof frame?.[v] === 'number' ? frame[v] : Number.NaN;
            }
            out.push(row);
          }
          return out;
        },
        {
          key: bcKey,
          frameCount: frames,
          width: VIEWPORT.width,
          height: VIEWPORT.height,
          vars: TRACE_VARIABLES,
        },
      ),
      STEP_TIMEOUT_MS,
      `${bcKey}: butterchurn trace`,
    )) as Array<Record<string, number>> | null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function traceStims(
  browser: Browser,
  port: number,
  presetId: string,
  frames: number,
): Promise<Array<Record<string, number>> | null> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    // Boot straight to the preset (control 2), silent audio, WebGL pinned
    // (the debug handle's frameState is read the same way regardless of
    // backend, but WebGL keeps this comparable to the bench script's rows),
    // quality step 0 so no adaptive-quality field skipping distorts state.
    await withDeadline(
      page.goto(
        `http://127.0.0.1:${port}/?preset=${presetId}&audio=none&agent=true&renderer=webgl&lockQualityStep=0`,
        { waitUntil: 'domcontentloaded' },
      ),
      BOOT_TIMEOUT_MS,
      `${presetId}: goto`,
    );
    await withDeadline(
      page.waitForFunction(
        (id) =>
          document
            .querySelector('.stims-shell__stage-frame')
            ?.getAttribute('data-active-preset-id') === id &&
          !!(
            window as unknown as {
              stimState?: { getDebugSnapshot: (key: string) => unknown };
            }
          ).stimState?.getDebugSnapshot('milkdrop'),
        presetId,
        { timeout: BOOT_TIMEOUT_MS },
      ),
      BOOT_TIMEOUT_MS,
      `${presetId}: preset active + debug snapshot ready`,
    );

    return (await withDeadline(
      page.evaluate(
        ({ frameCount, vars }) => {
          // window.__STIMS_AGENT_RENDER_FRAMES__ (agent-bridge.ts →
          // toy-runtime.ts renderFrames) synchronously pumps ONE simulation
          // frame per call — sim time decoupled from wall clock, the same
          // mechanism the preview generator uses for deterministic capture.
          // Each pumped frame runs pluginManager.update(), which is the
          // exact call that refreshes the 'milkdrop' debug snapshot, so
          // reading the snapshot right after one renderFrames({frames: 1})
          // call gives a true 1:1 frame index — no rAF sampling, no
          // alignment ambiguity with Butterchurn's synchronous render().
          const win = window as unknown as {
            stimState?: {
              getDebugSnapshot: (key: string) => {
                frameState?: { variables?: Record<string, number> } | null;
              } | null;
            };
            __STIMS_AGENT_RENDER_FRAMES__?: (options?: {
              frames?: number;
            }) => { rendered: number } | null;
          };
          if (!win.stimState || !win.__STIMS_AGENT_RENDER_FRAMES__) {
            return null;
          }
          const out: Array<Record<string, number>> = [];
          for (let i = 0; i < frameCount; i++) {
            const step = win.__STIMS_AGENT_RENDER_FRAMES__({ frames: 1 });
            if (step?.rendered !== 1) {
              return null;
            }
            const snapshot = win.stimState.getDebugSnapshot('milkdrop');
            const variables = snapshot?.frameState?.variables ?? {};
            const row: Record<string, number> = {};
            for (const v of vars) {
              row[v] =
                typeof variables[v] === 'number' ? variables[v] : Number.NaN;
            }
            out.push(row);
          }
          return out;
        },
        { frameCount: frames, vars: TRACE_VARIABLES },
      ),
      STEP_TIMEOUT_MS,
      `${presetId}: stims trace`,
    )) as Array<Record<string, number>> | null;
  } finally {
    await page.close().catch(() => {});
  }
}

function findFirstDivergence(
  stimsFrames: Array<Record<string, number>>,
  bcFrames: Array<Record<string, number>>,
  tolerance: number,
): { first: Divergence | null; variables: Set<string> } {
  const frameCount = Math.min(stimsFrames.length, bcFrames.length);
  let first: Divergence | null = null;
  const variables = new Set<string>();
  for (let f = 0; f < frameCount; f++) {
    for (const variable of TRACE_VARIABLES) {
      const stims = stimsFrames[f][variable];
      const bc = bcFrames[f][variable];
      if (Number.isNaN(stims) || Number.isNaN(bc)) continue;
      const delta = Math.abs(stims - bc);
      const scale = Math.max(1, Math.abs(stims), Math.abs(bc));
      if (delta / scale > tolerance) {
        variables.add(variable);
        if (!first) {
          first = { frame: f, variable, stims, butterchurn: bc, delta };
        }
      }
    }
  }
  return { first, variables };
}

async function main() {
  const args = parseArgs();
  const butterchurnSrc = readFileSync(BUTTERCHURN_LIB, 'utf8');
  const presetsSrc = readFileSync(PRESETS_LIB, 'utf8');

  const catalog = JSON.parse(
    readFileSync('public/milkdrop-presets/catalog.json', 'utf8'),
  ) as { presets: CatalogPreset[] };
  const ours = catalog.presets.filter((p) => p.file.includes('/butterchurn/'));

  console.log('Reading Butterchurn preset keys...');
  const keys = await readButterchurnKeys(presetsSrc);
  const byNormalizedTitle = new Map(keys.map((k) => [normalize(k), k]));
  const pairs: Pair[] = ours
    .map((p) => ({
      id: p.id,
      bcKey: byNormalizedTitle.get(normalize(p.title)),
    }))
    .filter((p): p is Pair => Boolean(p.bcKey));

  let sample: Pair[];
  if (args.ids) {
    const wanted = new Set(args.ids);
    sample = pairs.filter((p) => wanted.has(p.id));
    const missing = args.ids.filter((id) => !sample.some((p) => p.id === id));
    if (missing.length) {
      console.log(
        `Not found in matched corpus, skipping: ${missing.join(', ')}`,
      );
    }
  } else {
    const stride = Math.max(1, Math.floor(pairs.length / args.sample));
    sample = pairs.filter((_, i) => i % stride === 0).slice(0, args.sample);
  }
  console.log(
    `Tracing ${sample.length} preset(s), ${args.frames} frames each.\n`,
  );

  const server = await ensureDevServer(args.port);
  const results: TraceResult[] = [];
  try {
    // Rebuilt on any per-preset failure (not just a hang): "Target page,
    // context or browser has been closed" surfaced from a HEALTHY-looking
    // process on the previous preset's error, one iteration later — a
    // torn-down browser fails its NEXT newPage(), not the operation that
    // actually broke it. Cheap enough (~1s) to pay unconditionally rather
    // than try to distinguish "recoverable" from "browser is dead" errors.
    let bcBrowser = await launchBrowser();
    let stimsBrowser = await launchBrowser();
    try {
      for (const pair of sample) {
        process.stdout.write(`  ${pair.id} ... `);
        try {
          const [stimsFrames, bcFrames] = await Promise.all([
            traceStims(stimsBrowser, args.port, pair.id, args.frames),
            traceButterchurn(
              bcBrowser,
              butterchurnSrc,
              presetsSrc,
              pair.bcKey,
              args.frames,
            ),
          ]);
          if (!stimsFrames || !bcFrames) {
            results.push({
              id: pair.id,
              bcKey: pair.bcKey,
              framesCompared: 0,
              firstDivergence: null,
              divergentVariables: [],
              error: !stimsFrames
                ? 'stims trace failed'
                : 'butterchurn trace failed',
            });
            console.log('SKIP (trace failed)');
            continue;
          }
          const { first, variables } = findFirstDivergence(
            stimsFrames,
            bcFrames,
            args.tolerance,
          );
          results.push({
            id: pair.id,
            bcKey: pair.bcKey,
            framesCompared: Math.min(stimsFrames.length, bcFrames.length),
            firstDivergence: first,
            divergentVariables: [...variables],
          });
          console.log(
            first
              ? `diverges: ${[...variables].join(', ')} (first at frame ${first.frame}: ${first.variable})`
              : 'agrees',
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          results.push({
            id: pair.id,
            bcKey: pair.bcKey,
            framesCompared: 0,
            firstDivergence: null,
            divergentVariables: [],
            error: message,
          });
          console.log(`ERROR: ${message}`);
          await bcBrowser.close().catch(() => {});
          await stimsBrowser.close().catch(() => {});
          bcBrowser = await launchBrowser();
          stimsBrowser = await launchBrowser();
        }
      }
    } finally {
      await bcBrowser.close().catch(() => {});
      await stimsBrowser.close().catch(() => {});
    }
  } finally {
    server.close();
  }

  const agreeing = results.filter((r) => !r.error && !r.firstDivergence);
  const diverging = results.filter((r) => r.firstDivergence);
  const failed = results.filter((r) => r.error);

  console.log('\n=== Summary ===');
  console.log(
    `Agree: ${agreeing.length}  Diverge: ${diverging.length}  Failed: ${failed.length}`,
  );
  if (diverging.length) {
    console.log('\nDiverging presets:');
    for (const r of diverging) {
      console.log(
        `  ${r.id}: ${r.divergentVariables.join(', ')} — first at frame ${r.firstDivergence?.frame} (${r.firstDivergence?.variable}: stims=${r.firstDivergence?.stims.toFixed(4)} bc=${r.firstDivergence?.butterchurn.toFixed(4)})`,
      );
    }
  }
  if (failed.length) {
    console.log('\nFailed to trace:');
    for (const r of failed) {
      console.log(`  ${r.id}: ${r.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
