/**
 * Shared capture/comparison logic for the preset visual-regression suite
 * (tests/e2e/preset-visual-regression.test.ts) and its baseline-refresh CLI.
 *
 * Presets animate off `performance.now()` in milkdrop/runtime.ts, not a
 * frame-locked virtual clock, so two captures of the same preset a second
 * apart are never pixel-identical — measured natural jitter between
 * back-to-back captures ran as high as 90%+ mismatched pixels for
 * fast/chaotic presets even with nothing changed. A raw per-pixel diff is
 * therefore not usable here.
 *
 * What held up under repeated measurement:
 *  - A perceptual hash (dHash: a 9x8 grayscale gradient hash) instead of raw
 *    pixels. It's far more tolerant of the phase shift a rotating/warping
 *    preset accumulates between two "same" captures, because it encodes
 *    coarse light/dark structure rather than exact colour values.
 *  - Comparing a short burst of live frames against a short burst of
 *    baseline frames, and taking the *minimum* pairwise distance, rather
 *    than one frame against one frame. A single frame is one sample off a
 *    moving trajectory; matching against several samples from each side
 *    tolerates timing drift and only flags a real divergence (blank canvas,
 *    wrong preset, broken shader) where every pairing is far apart.
 *  - Even so, some presets (dense particle swarms, strobing colour cycles)
 *    never settled to a low natural-jitter floor across repeated
 *    measurement and were left out of VISUAL_REGRESSION_PRESET_IDS rather
 *    than given a threshold loose enough to be meaningless.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Presets whose natural (no-code-change) jitter measured low enough across
 * repeated captures to make a dHash comparison meaningful. Each was checked
 * at a minimum pairwise distance no higher than ~12/64 across several
 * independent capture pairs; DHASH_FAIL_THRESHOLD below leaves roughly 2x
 * margin above that. Presets with heavier motion (particle swarms, strobing
 * colour cycles) never stabilized under this technique and are intentionally
 * excluded — see the module comment. */
export const VISUAL_REGRESSION_PRESET_IDS = [
  'eos-phat-cubetrace-v2',
  'orb-radiation',
  'geiss-casino',
  'shifter-curlique',
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
  await page.goto(
    `${serverUrl}/?preset=${presetId}&audio=none&agent=true`,
    { waitUntil: 'domcontentloaded' },
  );
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
  let elapsed = 0;
  for (const offsetMs of CAPTURE_OFFSETS_MS) {
    await page.waitForTimeout(offsetMs - elapsed);
    elapsed = offsetMs;
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
        console.log(`Wrote baseline for ${presetId} (${frames.length} frames).`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
