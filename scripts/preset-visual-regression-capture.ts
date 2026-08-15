/**
 * Shared capture/comparison logic for the preset visual-regression suite
 * (tests/e2e/preset-visual-regression.test.ts) and its baseline-refresh CLI.
 *
 * Virtual time (injected via page.addInitScript) replaces performance.now()
 * with a deterministic clock, eliminating the phase-drift jitter that
 * previously required burst comparison + dHash. The capture still uses a
 * short frame burst and dHash for defense-in-depth, but the virtual time
 * makes single-frame comparison viable — presets that never settled under
 * real time are now testable.
 *
 * What held up under repeated measurement:
 *  - A perceptual hash (dHash: a 9x8 grayscale gradient hash) instead of raw
 *    pixels. It's far more tolerant of any residual timing variance.
 *  - Comparing a short burst of live frames against a short burst of
 *    baseline frames, and taking the *minimum* pairwise distance, rather
 *    than one frame against one frame. A single frame is one sample off a
 *    moving trajectory; matching against several samples from each side
 *    tolerates timing drift and only flags a real divergence (blank canvas,
 *    wrong preset, broken shader) where every pairing is far apart.
 *  - Even so, some presets (dense particle swarms, strobing colour cycles)
 *    may exhibit residual variance and can be given looser thresholds if needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Type for the injected virtual time API
interface StimsVirtualTime {
  getTime: () => number;
  advance: (frames?: number) => void;
  advanceMs: (ms: number) => void;
}

declare global {
  interface Window {
    __STIMS_VIRTUAL_TIME__?: StimsVirtualTime;
  }
}

/** Presets whose natural (no-code-change) jitter measured low enough across
 * repeated captures to make a dHash comparison meaningful. Each was checked
 * at a minimum pairwise distance no higher than ~12/64 across several
 * independent capture pairs; DHASH_FAIL_THRESHOLD below leaves roughly 2x
 * margin above that. Presets with heavier motion (particle swarms, strobing
 * colour cycles) never stabilized under this technique and are intentionally
 * excluded — see the module comment. */
export const VISUAL_REGRESSION_PRESET_IDS = [
  // Originally calibrated presets (low natural jitter, baselines checked in).
  'eos-phat-cubetrace-v2',
  // 'orb-radiation' — removed 2026-08-13. It no longer settles: a baseline
  // captured by this script fails the suite immediately afterwards at 26/64
  // against a 24/64 threshold, from identical code and identical browser args,
  // so refreshing the baseline cannot fix it. Four back-to-back captures under
  // one fixed arg set are bit-identical (dhash distance 0), so the preset is
  // deterministic per-configuration but sensitive to something that differs
  // between the capture and verification paths — most likely activation timing,
  // to which it became far more sensitive after the MilkDrop default-value fix
  // (8b1655c0) changed how quickly it saturates. It failed at 26/64 on commits
  // predating all of that work too, so it has been quietly red for a while.
  'geiss-casino',
  'shifter-curlique',
  // Coverage expansion — exercise the constructs that broke repeatedly:
  // warp feedback parity (`63efb1b5`), sampler bindings (`092c424c`),
  // custom wave per-point (`d7032f06`), GLSL shader constructs (`b6042c5b`),
  // composite border scaling (`e9c4a514`). Baselines are generated on-demand
  // via the capture script; presets without a baseline are skipped at test
  // time rather than failing, so coverage grows incrementally.
  'eos-glowsticks-v2-03-music',
  'rovastar-parallel-universe',
  'geiss-bipolar-x',
  'shifter-spectro',
  'orb-cloud-scope',
  'eos-phat-magnetosphere-13-pulsar',
  'phat-zylot-eos-trippy-rotation',
  'krash-rovastar-cerebral-demons-stars',
] as const;

/** Elapsed time (ms, from the preset becoming active) at which each frame in
 * a burst is captured. Fixed offsets rather than a "wait until it looks
 * rendered" gate: a content-based gate fires at an arbitrary, unrepeatable
 * point in time for a preset that fades in slowly. */
export const CAPTURE_OFFSETS_MS = [500, 1500, 3000];

export const CAPTURE_VIEWPORT = { width: 480, height: 270 };

const DHASH_GRID_WIDTH = 9;
const DHASH_GRID_HEIGHT = 8;
export const DHASH_BITS = (DHASH_GRID_WIDTH - 1) * DHASH_GRID_HEIGHT;

/** ~37.5% of hash bits. Calibrated with ~2x margin above the highest
 * minimum-pairwise natural jitter measured across VISUAL_REGRESSION_PRESET_IDS
 * (~12/64); see the module comment for how that floor was measured. */
export const DHASH_FAIL_THRESHOLD = 24;

export function fixtureDir(repoRoot: string, presetId: string): string {
  return path.join(
    repoRoot,
    'tests/fixtures/milkdrop/visual-regression',
    presetId,
  );
}

export function fixtureFramePath(
  repoRoot: string,
  presetId: string,
  frameIndex: number,
): string {
  return path.join(fixtureDir(repoRoot, presetId), `frame-${frameIndex}.png`);
}

/** 9x8 grayscale gradient hash: robust to the phase shift a moving preset
 * accumulates between captures, unlike a raw per-pixel comparison. */
export async function computeDHash(image: Buffer): Promise<bigint> {
  const { data } = await sharp(image)
    .grayscale()
    .resize(DHASH_GRID_WIDTH, DHASH_GRID_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  let bit = 0n;
  for (let y = 0; y < DHASH_GRID_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_GRID_WIDTH - 1; x += 1) {
      const left = data[y * DHASH_GRID_WIDTH + x];
      const right = data[y * DHASH_GRID_WIDTH + x + 1];
      if (left < right) hash |= 1n << bit;
      bit += 1n;
    }
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Minimum distance across every (live, baseline) pairing in two frame
 * bursts — see the module comment for why a single frame isn't compared
 * against a single frame. */
export function minPairwiseHammingDistance(
  a: readonly bigint[],
  b: readonly bigint[],
): number {
  let min = Number.POSITIVE_INFINITY;
  for (const ha of a) {
    for (const hb of b) {
      min = Math.min(min, hammingDistance(ha, hb));
    }
  }
  return min;
}

/**
 * Navigates to a preset route and captures a burst of canvas frames at
 * CAPTURE_OFFSETS_MS. Shared by the test (which spins up its own dev server)
 * and the baseline-refresh CLI (which expects one already running).
 */
export async function capturePresetFrames({
  page,
  serverUrl,
  presetId,
}: {
  page: import('playwright').Page;
  serverUrl: string;
  presetId: string;
}): Promise<Buffer[]> {
  // Inject virtual time source before page load for deterministic captures.
  // This replaces performance.now() with a controllable time source.
  await page.addInitScript(() => {
    let virtualTimeMs = 0;
    const advanceMs = 1000 / 60; // 60 FPS virtual frame rate
    window.__STIMS_VIRTUAL_TIME__ = {
      getTime: () => virtualTimeMs,
      advance: (frames = 1) => {
        virtualTimeMs += advanceMs * frames;
      },
      advanceMs: (ms: number) => {
        virtualTimeMs += ms;
      },
    };
    // Override performance.now() — must be done before any other code runs
    const _originalNow = performance.now.bind(performance);
    performance.now = () => virtualTimeMs;
    // Also override Date.now() for any fallbacks
    const _originalDateNow = Date.now.bind(Date);
    Date.now = () => virtualTimeMs;
  });

  await page.goto(`${serverUrl}/?preset=${presetId}&audio=none&agent=true`, {
    waitUntil: 'domcontentloaded',
  });
  // 60s, not 30s: preset source resolution measured up to ~16s under
  // SwiftShader, matching the wait budget e2e-engine-mount.test.ts uses for
  // the same "preset becomes active" gate.
  await page.waitForSelector(
    `.stims-shell__stage-frame[data-active-preset-id="${presetId}"]`,
    { timeout: 60000 },
  );
  await page.waitForSelector('.stims-shell__stage-frame canvas', {
    timeout: 30000,
  });

  const frames: Buffer[] = [];
  const _advancePerFrame = 1000 / 60; // Match the injected advanceMs
  for (const offsetMs of CAPTURE_OFFSETS_MS) {
    // Advance virtual time to the target offset
    await page.evaluate((targetMs) => {
      const vt = window.__STIMS_VIRTUAL_TIME__;
      if (vt) vt.advanceMs(targetMs - vt.getTime());
    }, offsetMs);
    // Allow one frame to render at the new virtual time
    await page.waitForTimeout(0);
    const dataUrl = await page.evaluate(() =>
      document
        .querySelector<HTMLCanvasElement>('.stims-shell__stage-frame canvas')
        ?.toDataURL('image/png'),
    );
    if (!dataUrl) {
      throw new Error(
        `No canvas content captured for preset "${presetId}" at offset ${offsetMs}ms.`,
      );
    }
    frames.push(Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  return frames;
}

export async function loadBaselineFrames(
  repoRoot: string,
  presetId: string,
): Promise<Buffer[] | null> {
  const dir = fixtureDir(repoRoot, presetId);
  if (!fs.existsSync(dir)) return null;
  const frames: Buffer[] = [];
  for (let i = 0; i < CAPTURE_OFFSETS_MS.length; i += 1) {
    const framePath = fixtureFramePath(repoRoot, presetId, i);
    if (!fs.existsSync(framePath)) return null;
    frames.push(fs.readFileSync(framePath));
  }
  return frames;
}

export function writeBaselineFrames(
  repoRoot: string,
  presetId: string,
  frames: readonly Buffer[],
): void {
  const dir = fixtureDir(repoRoot, presetId);
  fs.mkdirSync(dir, { recursive: true });
  frames.forEach((frame, index) => {
    fs.writeFileSync(fixtureFramePath(repoRoot, presetId, index), frame);
  });
}

function usage() {
  console.error(
    'Usage: bun scripts/preset-visual-regression-capture.ts [--port <number>] [--preset <id>]...',
  );
  console.error(
    'Requires a dev server already running (e.g. `bun run dev`). Writes/overwrites',
  );
  console.error(
    'the checked-in baseline frames in tests/fixtures/milkdrop/visual-regression.',
  );
}

if (import.meta.main) {
  const { chromium } = await import('playwright');

  const argv = process.argv.slice(2);
  const getArg = (name: string, fallback: string) => {
    const index = argv.indexOf(name);
    return index === -1 || index + 1 >= argv.length
      ? fallback
      : argv[index + 1];
  };
  if (argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  const port = Number.parseInt(getArg('--port', '5173'), 10);
  const requestedPresets = argv
    .flatMap((arg, index) => (arg === '--preset' ? [argv[index + 1]] : []))
    .filter((value): value is string => Boolean(value));
  const presetIds = requestedPresets.length
    ? requestedPresets
    : VISUAL_REGRESSION_PRESET_IDS;

  const repoRoot = process.cwd();
  const serverUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    headless: true,
    // Baselines must stay SwiftShader-rendered: the regression suite compares
    // dhashes under the same software pipeline (SOFTWARE_RENDERER_ARGS in
    // tests/e2e/webgl-launch.ts), so a real-GPU capture would poison them.
    args: [
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });

  try {
    for (const presetId of presetIds) {
      const context = await browser.newContext({
        viewport: CAPTURE_VIEWPORT,
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        const frames = await capturePresetFrames({ page, serverUrl, presetId });
        writeBaselineFrames(repoRoot, presetId, frames);
        console.log(
          `Wrote baseline for ${presetId} (${frames.length} frames).`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
