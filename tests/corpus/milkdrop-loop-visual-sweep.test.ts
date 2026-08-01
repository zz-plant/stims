import { describe, expect, test } from 'bun:test';
import { chromium } from 'playwright';
import sharp from 'sharp';
import {
  buildLoopPresetCorpus,
  captureIsolatedVisualizerCanvas,
  classifyLoopPresetSweepSample,
  LOOP_PRESET_CANVAS_SELECTOR,
  rankLoopPresetSweepSamples,
  resolveLoopSweepChromiumArgs,
} from '../../scripts/run-milkdrop-loop-visual-sweep.ts';

const repoRoot = new URL('../..', import.meta.url).pathname;

describe('MilkDrop loop preset visual sweep', () => {
  test('selects the 55 unique catalog presets whose compiled IR executes loop control flow', () => {
    const corpus = buildLoopPresetCorpus(repoRoot);

    expect(corpus).toHaveLength(55);
    expect(new Set(corpus.map((preset) => preset.id)).size).toBe(55);
    expect(corpus.every((preset) => preset.controlStatementCount > 0)).toBe(
      true,
    );
    expect(
      corpus.every((preset) => preset.controlKinds.includes('while')),
    ).toBe(true);
    expect(
      corpus.every((preset) =>
        preset.controlKinds.every(
          (kind) => kind === 'loop' || kind === 'while',
        ),
      ),
    ).toBe(true);
  }, 15_000);

  test('classifies runtime failures ahead of visible and performance regressions', () => {
    const runtime = classifyLoopPresetSweepSample({
      loadError: 'Preset did not become active',
      consoleErrors: [],
      frameRate: null,
      firstFrame: null,
      finalFrame: null,
      frameDifferenceRatio: null,
    });
    const blank = classifyLoopPresetSweepSample({
      loadError: null,
      consoleErrors: [],
      frameRate: 60,
      firstFrame: {
        meanLuminance: 0,
        visiblePixelRatio: 0,
        luminanceStandardDeviation: 0,
      },
      finalFrame: {
        meanLuminance: 0,
        visiblePixelRatio: 0,
        luminanceStandardDeviation: 0,
      },
      frameDifferenceRatio: 0,
    });
    const uniform = classifyLoopPresetSweepSample({
      loadError: null,
      consoleErrors: [],
      frameRate: 60,
      firstFrame: {
        meanLuminance: 220,
        visiblePixelRatio: 1,
        luminanceStandardDeviation: 0.2,
      },
      finalFrame: {
        meanLuminance: 219,
        visiblePixelRatio: 1,
        luminanceStandardDeviation: 0.3,
      },
      frameDifferenceRatio: 0.1,
    });
    const slow = classifyLoopPresetSweepSample({
      loadError: null,
      consoleErrors: [],
      frameRate: 8,
      firstFrame: {
        meanLuminance: 40,
        visiblePixelRatio: 0.5,
        luminanceStandardDeviation: 12,
      },
      finalFrame: {
        meanLuminance: 45,
        visiblePixelRatio: 0.55,
        luminanceStandardDeviation: 14,
      },
      frameDifferenceRatio: 0.2,
    });

    expect(runtime.status).toBe('runtime-regression');
    expect(blank.status).toBe('visual-regression');
    expect(uniform.status).toBe('visual-regression');
    expect(slow.status).toBe('performance-regression');
    expect(runtime.severityScore).toBeGreaterThan(blank.severityScore);
    expect(blank.severityScore).toBeGreaterThan(slow.severityScore);
  });

  test('ranks the highest-impact regression first and stable IDs alphabetically', () => {
    const ranked = rankLoopPresetSweepSamples([
      {
        presetId: 'slow-z',
        status: 'performance-regression',
        severityScore: 100,
      },
      { presetId: 'blank-b', status: 'visual-regression', severityScore: 200 },
      { presetId: 'blank-a', status: 'visual-regression', severityScore: 200 },
      { presetId: 'pass', status: 'pass', severityScore: 0 },
    ]);

    expect(ranked.map((sample) => sample.presetId)).toEqual([
      'blank-a',
      'blank-b',
      'slow-z',
      'pass',
    ]);
  });

  test('captures the visualizer canvas rather than nested preset identicons', () => {
    expect(LOOP_PRESET_CANVAS_SELECTOR).toBe('#stims-visualizer > canvas');
  });

  test('isolates canvas pixels from visualizer UI layered above it', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 80, height: 80 },
      });
      await page.setContent(`
        <div id="stims-visualizer" style="position: relative; width: 64px; height: 64px">
          <canvas width="64" height="64" style="display: block; width: 64px; height: 64px"></canvas>
          <div id="overlay" style="position: absolute; inset: 0; background: white"></div>
        </div>
      `);
      await page.locator('canvas').evaluate((canvas) => {
        const context = (canvas as HTMLCanvasElement).getContext('2d');
        if (!context) throw new Error('Missing test canvas context');
        context.fillStyle = 'black';
        context.fillRect(0, 0, canvas.width, canvas.height);
      });
      const capture = await captureIsolatedVisualizerCanvas(page);
      const { data } = await sharp(capture).removeAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      expect([...data.subarray(0, 3)]).toEqual([0, 0, 0]);
      expect(
        await page
          .locator('#overlay')
          .evaluate((element) => getComputedStyle(element).visibility),
      ).toBe('visible');
    } finally {
      await browser.close();
    }
  });

  test('uses native WebGL for the headed browser sweep', () => {
    expect(resolveLoopSweepChromiumArgs('webgl', false)).not.toContain(
      '--use-angle=swiftshader',
    );
    expect(resolveLoopSweepChromiumArgs('webgl', true)).toContain(
      '--use-angle=swiftshader',
    );
  });
});
