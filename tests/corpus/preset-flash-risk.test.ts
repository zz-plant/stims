import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPresetFlashRiskLab } from '../../scripts/preset-lab-flash-risk.ts';

const repoRoot = new URL('../..', import.meta.url).pathname;

/**
 * This is a regression test for the flash-risk tool itself — it checks that
 * a real render produces a well-shaped, non-degenerate report. It is NOT a
 * corpus-wide safety audit: it exercises one known preset, not the ~1,800 in
 * the catalog. Running the tool across the full corpus (and deciding what
 * "high risk" actually means) is separate follow-up work — see the
 * PLACEHOLDER threshold note in scripts/preset-lab-flash-risk.ts.
 */
describe('preset flash-risk lab', () => {
  test('produces a well-shaped report for a known preset', async () => {
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
    expect(report.sampleCount).toBeGreaterThan(20);
    expect(report.meanLuminance).toBeGreaterThanOrEqual(0);
    expect(report.meanLuminance).toBeLessThanOrEqual(255);
    expect(report.maxLuminanceDelta).toBeGreaterThanOrEqual(0);
    expect(report.maxTransitionsPerSecondEstimate).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(report.artifacts.reportJson)).toBe(true);
  }, 60_000);
});
