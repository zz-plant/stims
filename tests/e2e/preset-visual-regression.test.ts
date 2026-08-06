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
 * See scripts/preset-visual-regression-capture.ts for why this compares a
 * perceptual hash across a frame burst rather than raw pixels of a single
 * frame, and why only four presets are covered: presets animate off
 * `performance.now()`, not a frame-locked clock, and several in the catalog
 * never settled to a low enough natural jitter for a meaningful comparison
 * no matter the technique.
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
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const hasChromium = fs.existsSync(chromium.executablePath());
// CI runs the eight-preset burst under SwiftShader on a 2-core runner; the
// sequential WebGL captures are too heavy for that and flake by hanging
// mid-capture (the failing preset shifts every run). Run this suite locally
// on a real GPU where the baseline/runner match.
const RUNS_LOCALLY = hasChromium && !process.env.CI;
const browserTest = RUNS_LOCALLY ? test : test.skip;

const TEST_PORT = 5184;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
const REPO_ROOT = process.cwd();

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

for (const presetId of VISUAL_REGRESSION_PRESET_IDS) {
  browserTest(
    `${presetId} matches its visual baseline`,
    async () => {
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

      const browser = await chromium.launch({
        headless: HEADLESS,
        args: WEBGL_RENDERER_ARGS,
      });
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
        await browser.close();
      }
    },
    // 240s, not 120s: this suite runs after other SwiftShader-rendered e2e
    // files in the same CI job, and accumulated GPU/CPU pressure has pushed
    // capture past a 120s budget for some presets (geiss-casino) in CI even
    // though it completes in under 20s locally with real GPU (2026-08-06 CI
    // investigation).
    { timeout: 240000 },
  );
}
