/**
 * E2E: Reference-image regression for a slice of the preset catalog.
 *
 * e2e-engine-mount.test.ts only proves "the engine renders something
 * non-black" for two presets, sampling a single canvas pixel — a preset
 * that renders mostly wrong but has a non-black centre pixel still passes.
 * This suite diffs a captured burst of frames against checked-in baseline
 * images per preset, so a shader/warp/blend regression that still produces
 * *a* colourful image also fails.
 *
 * Virtual time (injected via page.addInitScript) replaces performance.now()
 * with a deterministic clock, eliminating the phase-drift jitter that
 * previously required burst comparison + dHash. Presets that never settled
 * under real time are now testable — the catalog coverage can expand.
 *
 * To refresh baselines after an intentional visual change:
 *   bun run dev &
 *   bun run scripts/preset-visual-regression-capture.ts
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  CAPTURE_VIEWPORT,
  capturePresetFrames,
  computeDHash,
  DHASH_BITS,
  DHASH_FAIL_THRESHOLD,
  loadBaselineFrames,
  minPairwiseHammingDistance,
  VISUAL_REGRESSION_PRESET_IDS,
} from '../../scripts/preset-visual-regression-capture.ts';
import { hasChromium as sharedHasChromium } from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';
// SOFTWARE_RENDERER_ARGS, not WEBGL_RENDERER_ARGS: the dhash baselines were
// captured under SwiftShader, so the runner must render with the same
// software pipeline or the comparison drifts with the local GPU.
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

// Local-only by design (needs a real GPU), so a missing browser is not a fault.
const hasChromium = sharedHasChromium;
// CI runs the eight-preset burst under SwiftShader on a 2-core runner; the
// sequential WebGL captures are too heavy for that and flake by hanging
// mid-capture (the failing preset shifts every run). A cloud agent container
// is the same software-rendered case. Run this suite where a real GPU makes
// the baseline and the runner match.
const RUNS_LOCALLY = hasChromium && !HEADLESS_ENVIRONMENT;
const browserTest = RUNS_LOCALLY ? test : test.skip;

const TEST_PORT = 5184;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const REPO_ROOT = process.cwd();

// Maximum concurrent preset captures to avoid overwhelming the CI runner
const MAX_CONCURRENT = 3;

let devServer: DevServerHandle | null = null;

beforeAll(async () => {
  if (!RUNS_LOCALLY) return;
  devServer = await startDevServer({ port: TEST_PORT });
}, 60000);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
});

async function runPresetTest(
  presetId: string,
  browser: import('playwright').Browser,
) {
  const baseline = await loadBaselineFrames(REPO_ROOT, presetId);
  if (!baseline) {
    // Coverage expands incrementally — presets in VISUAL_REGRESSION_PRESET_IDS
    // without a checked-in baseline are skipped (not failed) so CI stays
    // green while baselines are generated via the capture script.
    console.log(
      `[skip] No visual baseline for "${presetId}". Generate one with:\n` +
        `  bun run dev &\n` +
        `  bun run scripts/preset-visual-regression-capture.ts --preset ${presetId}`,
    );
    return;
  }

  const ctx = await browser.newContext({
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 1,
  });
  try {
    const page = await ctx.newPage();
    const live = await capturePresetFrames({
      page,
      serverUrl: SERVER_URL,
      presetId,
    });

    const [liveHashes, baselineHashes] = await Promise.all([
      Promise.all(live.map(computeDHash)),
      Promise.all(baseline.map(computeDHash)),
    ]);
    const distance = minPairwiseHammingDistance(liveHashes, baselineHashes);

    if (distance > DHASH_FAIL_THRESHOLD) {
      const debugDir = `screenshots/preset-visual-regression/${presetId}`;
      fs.mkdirSync(debugDir, { recursive: true });
      live.forEach((frame, index) => {
        fs.writeFileSync(`${debugDir}/live-frame-${index}.png`, frame);
      });
      baseline.forEach((frame, index) => {
        fs.writeFileSync(`${debugDir}/baseline-frame-${index}.png`, frame);
      });
      throw new Error(
        `"${presetId}" diverged from its baseline: minimum perceptual-hash ` +
          `distance ${distance}/${DHASH_BITS} exceeds the ${DHASH_FAIL_THRESHOLD}/${DHASH_BITS} ` +
          `threshold. Frames written to ${debugDir}/ for comparison. If this is an ` +
          `intentional visual change, refresh the baseline (see file header).`,
      );
    }
    expect(distance).toBeLessThanOrEqual(DHASH_FAIL_THRESHOLD);
  } finally {
    await ctx.close();
  }
}

browserTest(
  'visual regression suite',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });

    try {
      // Run presets in parallel batches
      for (
        let i = 0;
        i < VISUAL_REGRESSION_PRESET_IDS.length;
        i += MAX_CONCURRENT
      ) {
        const batch = VISUAL_REGRESSION_PRESET_IDS.slice(i, i + MAX_CONCURRENT);
        await Promise.all(
          batch.map((presetId) => runPresetTest(presetId, browser)),
        );
      }
    } finally {
      await browser.close();
    }
  },
  { timeout: 300000 },
); // 5 min for full parallel suite
