import { describe, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPresetFlashRiskLab } from '../../scripts/preset-lab-flash-risk.ts';
import { browserTest } from '../test-helpers.ts';

const repoRoot = new URL('../..', import.meta.url).pathname;

/**
 * The WebGL renderer string reported by the page. GitHub runners have no GPU,
 * so Chromium falls back to SwiftShader (and on other machines llvmpipe or
 * Mesa's software path), which renders one to two frames a second.
 */
function isSoftwareRenderer(captureBackend: string | null): boolean {
  if (!captureBackend) {
    // Unknown backend: treat as software rather than assert a frame rate the
    // environment may not be able to reach.
    return true;
  }
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/iu.test(
    captureBackend,
  );
}

/**
 * This is a regression test for the flash-risk tool itself — it checks that
 * a real render produces a well-shaped, non-degenerate report. It is NOT a
 * corpus-wide safety audit: it exercises one known preset, not the ~1,800 in
 * the catalog. Running the tool across the full corpus (and deciding what
 * "high risk" actually means) is separate follow-up work — see the
 * PLACEHOLDER threshold note in scripts/preset-lab-flash-risk.ts.
 */
describe('preset flash-risk lab', () => {
  browserTest(
    'produces a well-shaped report for a known preset',
    async () => {
      const outputDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'stims-flash-risk-'),
      );
      const report = await runPresetFlashRiskLab({
        repoRoot,
        presetId: 'adamfx-2-geiss-mash-up-sphere-xibit-graffiti-warp-me-tydye3',
        outputDir,
        port: 5199,
        durationMs: 2000,
        headless: true,
      });

      expect(report.version).toBe(1);
      expect(report.renderer).toBe('webgl');
      expect(report.loadError).toBeNull();
      expect(report.consoleErrors).toHaveLength(0);
      expect(report.audioActive).toBe(true);

      // In-page rAF sampling should land well above preset-lab-visual.ts's
      // 700ms/1.4Hz interval capture — that's the entire reason this tool
      // exists (see file header). A few dozen samples over 2s is a floor,
      // not a target; real hardware ran ~75fps in manual verification.
      //
      // That floor is a claim about the *rendering pipeline's* throughput, and
      // it is only meaningful on a GPU. CI has no GPU: Chromium falls back to
      // SwiftShader, the whole page renders at ~1.5fps, and this preset
      // produced 3 samples in 2s — no sampler can beat a 1.4Hz baseline when
      // the renderer itself is slower than that. Asserting it anyway is the
      // same budget-widening trap ci.yml already calls out for the e2e visual
      // suite, so the throughput claim is scoped to hardware and the rest of
      // the report is verified everywhere.
      if (isSoftwareRenderer(report.captureBackend)) {
        // Still has to have sampled repeatedly — two samples is the minimum
        // for maxLuminanceDelta to mean anything, and a broken sampler
        // returning one frame (or none) fails here.
        expect(report.sampleCount).toBeGreaterThan(1);
      } else {
        expect(report.sampleCount).toBeGreaterThan(20);
      }
      expect(report.meanLuminance).toBeGreaterThanOrEqual(0);
      expect(report.meanLuminance).toBeLessThanOrEqual(255);
      expect(report.maxLuminanceDelta).toBeGreaterThanOrEqual(0);
      expect(report.maxTransitionsPerSecondEstimate).toBeGreaterThanOrEqual(0);
      expect(fs.existsSync(report.artifacts.reportJson)).toBe(true);
    },
    60_000,
  );
});
