/**
 * E2E: the "Open one up" moment (docs/PRODUCT_MOMENTS.md), walked the way a
 * visitor walks it.
 *
 * The landing promises "Open one to see which sounds drive it, then change
 * its code while it runs." This suite checks that promise from the first-run
 * state, with no deep link:
 *
 *   1. Play demo, then open the editor from the stage dock.
 *   2. Read the audio sources the Tune pane shows for every control and
 *      compare them with `analyzePresetDataflow` for the same preset.
 *   3. Type one edit into the code.
 *   4. The stage shows it within a bounded number of engine frames, and the
 *      demo audio and the preset are still running.
 *
 * WebGL, so CI's SwiftShader runner can run it. Every wait on the stage is
 * counted in engine frames, never wall-clock time: a slow machine renders
 * fewer frames during the same debounce and compile, so a frame bound is
 * fair to it, where a millisecond bound is not. The wall-clock deadlines
 * below only stop a wedged page from eating the test budget.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  analyzePresetDataflow,
  controlAudio,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { chromium, type Page } from 'playwright';
import type { FrameStats } from '../../src/js/core/services/visual-embedding.ts';
import {
  COLOR_GROUPS,
  ENUM_CONTROLS,
  RANGE_CONTROLS,
  SCALAR_CONTROLS,
  TOGGLE_CONTROLS,
} from '../../src/js/milkdrop/preset-controls.ts';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import {
  agentPredicates,
  captureAgentStats,
  getAgentEvents,
  getAgentState,
  waitForAgentState,
  writeAgentFailureArtifact,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5191;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

/**
 * The preset this suite was written against. The anchors below are what
 * `bun run lab:dataflow -- --preset shifter-curlique` reports, so a new
 * first-run preset needs them re-measured, not just this id changed.
 */
const EXPECTED_FIRST_RUN_PRESET = 'shifter-curlique';
const ZOOM_AUDIO = ['bass', 'mid', 'treb'];

/**
 * The edit, appended as a new per-frame line so it runs after the preset's
 * own equations and wins. `decay = 0` drops the feedback, so the frame is
 * exactly what this frame draws: a red border half the screen deep around a
 * black middle. Measured on WebGL at 1280x720, that reads as 50% of samples
 * with red at 224/255 or above and every sample's green and blue below 32.
 *
 * The preset cannot reach that on its own: its only colour is the outer
 * border, whose three channels run on sines a few hundredths of a hertz
 * apart, so for the first few minutes they are close to in phase and never
 * red with green and blue both off. Neither can a black stage (no red) or a
 * washed-out one (green and blue lit).
 */
const EDIT_LINE =
  'per_frame_41=ob_size = 0.5; ob_r = 1; ob_g = 0; ob_b = 0; decay = 0;';

function showsEdit(stats: FrameStats): boolean {
  const { histogram } = stats;
  // 8 bins per channel: r 0-7, g 8-15, b 16-23. Bin 0 is 0-31, bin 7 224-255.
  return histogram[7] >= 0.3 && histogram[8] >= 0.95 && histogram[16] >= 0.95;
}

/**
 * Engine frames from the last keystroke to the edit on stage: the editor's
 * 120ms debounce, the compile, and the frame that draws it. Measured 33
 * frames on a laptop GPU and 2 on SwiftShader, where each frame is slow
 * enough to cover the same wall-clock work.
 */
const EDIT_FRAME_BUDGET = 150;

/**
 * After the edit lands, the audio level is read this many times, a few engine
 * frames apart. `getState().audioEnergy` is the latest level from the
 * runtime's signal tracker, the same tracker whose signals the preset reads
 * every frame, so music gives a new reading almost every frame. A level that
 * stops changing means the audio stalled, even when it is stuck at a non-zero
 * value. The preset's own audio-driven variables are no test of this: with no
 * audio the runtime feeds them an idle signal, and `q2` (accumulated bass)
 * rose about a third as fast on the silent attract preview as under the demo.
 */
const AUDIO_SAMPLES = 6;
const AUDIO_SAMPLE_FRAMES = 5;

const LAUNCH_TIMEOUT_MS = 60_000;
/** The home page's Play demo lives in a lazy chunk a cold vite transforms. */
const HOME_CHUNK_TIMEOUT_MS = 90_000;
const CLICK_TIMEOUT_MS = 30_000;
const LIVE_TIMEOUT_MS = 60_000;
/** The editor is a lazy chunk too, with CodeMirror behind it. */
const EDITOR_TIMEOUT_MS = 60_000;
/** Backstop for the frame-counted waits; see the file docblock. */
const FRAME_WAIT_TIMEOUT_MS = 60_000;
const PAGE_CALL_TIMEOUT_MS = 15_000;

let devServer: DevServerHandle | null = null;

beforeAll(
  async () => {
    if (!hasChromium) return;
    devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60_000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
}, 30_000);

type RuntimeDebugWindow = typeof window & {
  __milkdropRuntimeDebug?: {
    getPerformance: () => { sampleCount: number } | null;
  };
};

/** A single page call, bounded so a wedged page names the step. */
function bounded<T>(
  work: Promise<T>,
  label = 'reading agent state',
): Promise<T> {
  return withDeadline(work, PAGE_CALL_TIMEOUT_MS, label);
}

async function frameCount(page: Page): Promise<number> {
  return bounded(
    page.evaluate(
      () =>
        (window as RuntimeDebugWindow).__milkdropRuntimeDebug?.getPerformance()
          ?.sampleCount ?? 0,
    ),
    'reading the engine frame count',
  );
}

/** Resolves once the engine has rendered `frames` more frames. */
async function waitForFrames(page: Page, frames: number): Promise<void> {
  const start = await frameCount(page);
  await page.waitForFunction(
    ({ start, frames }) => {
      const now =
        (window as RuntimeDebugWindow).__milkdropRuntimeDebug?.getPerformance()
          ?.sampleCount ?? 0;
      return now >= start + frames;
    },
    { start, frames },
    { timeout: FRAME_WAIT_TIMEOUT_MS, polling: 100 },
  );
}

type ChipReading = { label: string; state: string; audio: string[] };

/**
 * What the Tune pane says about every control: its label, whether the draft
 * owns the value or the equations do, and the audio it names. The visible
 * chip shortens the list to `eq · bass +2`; the full list is in the chip's
 * accessible name (and its tooltip), so that is what is read here, and the
 * visible text is checked against it separately.
 */
async function readTuneChips(
  page: Page,
): Promise<Array<ChipReading & { text: string }>> {
  return bounded(
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '#stims-editor-pane-tune .stims-editor__state-chip',
        ),
      ).map((chip) => {
        const name = chip.getAttribute('aria-label') ?? '';
        const match =
          /^(.*) value source: (\w+)(?:, computed from (.*))?$/.exec(name);
        return {
          label: match?.[1] ?? `unparsed: ${name}`,
          state: match?.[2] ?? '',
          audio: match?.[3] ? match[3].split(', ') : [],
          text: chip.textContent ?? '',
        };
      }),
    ),
    'reading the Tune pane chips',
  );
}

/**
 * The same readings, derived without the editor: each control's fields from
 * the control definitions the Tune pane is built from, and the audio reaching
 * those fields from the static dataflow of the preset file.
 */
function expectedChips(presetId: string): ChipReading[] {
  const catalog = JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'public/milkdrop-presets/catalog.json'),
      'utf8',
    ),
  ) as { presets: Array<{ id: string; file: string }> };
  const entry = catalog.presets.find((preset) => preset.id === presetId);
  if (!entry) throw new Error(`${presetId} is not in the bundled catalog`);
  const source = readFileSync(
    path.join(process.cwd(), 'public', entry.file),
    'utf8',
  );
  const { ir } = compileMilkdropPresetSource(source, { id: presetId });
  const dataflow = analyzePresetDataflow(ir);

  const controls = [
    ...SCALAR_CONTROLS.map((c) => ({ label: c.label, keys: [c.key] })),
    ...TOGGLE_CONTROLS.map((c) => ({ label: c.label, keys: [c.key] })),
    ...ENUM_CONTROLS.map((c) => ({ label: c.label, keys: [c.key] })),
    ...RANGE_CONTROLS.map((c) => ({
      label: c.label,
      keys: [c.minKey, c.maxKey],
    })),
    ...COLOR_GROUPS.map((g) => ({
      label: g.label,
      keys: [...g.rgb, ...(g.alpha ? [g.alpha.key] : [])],
    })),
  ];
  return controls.map(({ label, keys }) => {
    // null: no equation writes the field. []: one does, from no audio.
    const reached = keys
      .map((key) => controlAudio(dataflow, key))
      .filter((audio): audio is string[] => audio !== null);
    return {
      label,
      state: reached.length > 0 ? 'driven' : 'static',
      audio: [...new Set(reached.flat())].sort(),
    };
  });
}

/** Order-free form: two controls share a label ("Motion vectors"). */
function byLabel(chips: ChipReading[]): string[] {
  return chips
    .map(({ label, state, audio }) => `${label}: ${state} [${audio.join(' ')}]`)
    .sort();
}

/** The visible chip text the pane's own hint documents: `eq · bass`. */
function chipText({ state, audio }: ChipReading): string {
  if (state === 'static') return 'set';
  if (audio.length === 0) return 'eq';
  return `eq · ${audio[0]}${audio.length > 1 ? ` +${audio.length - 1}` : ''}`;
}

requiredBrowserTest(
  'open one up: the editor names the sounds dataflow finds, and an edit runs without stopping the music',
  async () => {
    expect(
      FIRST_RUN_PRESET_ID,
      'The first-run preset changed. Re-run lab:dataflow on the new one and update the anchors in this file.',
    ).toBe(EXPECTED_FIRST_RUN_PRESET);
    const expected = expectedChips(FIRST_RUN_PRESET_ID);
    expect(
      expected.find((chip) => chip.label === 'Zoom'),
      'lab:dataflow reports zoom following bass, mid and treble',
    ).toEqual({ label: 'Zoom', state: 'driven', audio: ZOOM_AUDIO });

    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    // DPR 1 and the cheapest quality step: CI software-renders every frame,
    // and nothing here depends on resolution (see e2e-engine-mount).
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => {
      console.log(`[OPEN ONE UP PAGE ERROR] ${error.message}`);
    });

    try {
      // No ?preset= and no ?audio=: the first-run state is the subject.
      // agent=true keeps the WebGL drawing buffer readable for captureStats.
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6`,
        { waitUntil: 'domcontentloaded', timeout: LIVE_TIMEOUT_MS },
      );
      const playDemo = page.locator(
        '.stims-shell__launch-cta[data-demo-audio-btn]',
      );
      await playDemo.waitFor({
        state: 'attached',
        timeout: HOME_CHUNK_TIMEOUT_MS,
      });
      await playDemo.click({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) &&
          agentPredicates.backendIs('webgl')(state) &&
          agentPredicates.presetIs(FIRST_RUN_PRESET_ID)(state) &&
          state.audioSource === 'demo',
        LIVE_TIMEOUT_MS,
      );

      // The dock folds away after a few idle seconds, and while folded its
      // Edit button is not in the accessibility tree at all. A visitor
      // brings it back by moving the pointer over the stage.
      const stage = page.locator('.stims-shell__stage-frame');
      const box = await stage.boundingBox({ timeout: CLICK_TIMEOUT_MS });
      if (!box) throw new Error('the stage has no box to point at');
      await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page
        .getByRole('button', { name: 'Edit this visual' })
        .click({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );
      await page
        .locator('#stims-editor-tab-tune[aria-selected="true"]')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });

      // The chips fill in once the compiled preset reaches the panel. Read
      // them every few engine frames until they settle on the expectation or
      // the deadline passes, then compare once more so a failure prints the
      // difference.
      const want = byLabel(expected);
      const editorDeadline = Date.now() + EDITOR_TIMEOUT_MS;
      let chips = await readTuneChips(page);
      while (
        JSON.stringify(byLabel(chips)) !== JSON.stringify(want) &&
        Date.now() < editorDeadline
      ) {
        await waitForFrames(page, 10);
        chips = await readTuneChips(page);
      }
      expect(byLabel(chips)).toEqual(want);
      for (const chip of chips) {
        expect(chip.text, `${chip.label}'s visible chip`).toBe(chipText(chip));
      }

      // The edit. Baseline first: the stage must not already look edited,
      // or the check below would pass on a frame the edit never touched.
      const baseline = await bounded(captureAgentStats(page));
      expect(baseline).not.toBeNull();
      if (!baseline) return;
      expect(showsEdit(baseline), 'the stage before the edit').toBe(false);
      const lastSeq = (await bounded(getAgentEvents(page))).at(-1)?.seq ?? 0;

      await page
        .locator('.stims-editor .cm-content')
        .click({ timeout: CLICK_TIMEOUT_MS });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      // One input event, as a paste or IME commit delivers it: per-character
      // typing on a software-rendered page costs a frame per key.
      await page.keyboard.insertText(EDIT_LINE);

      const typedAt = await frameCount(page);
      let stats = await bounded(captureAgentStats(page));
      while (!(stats && showsEdit(stats))) {
        const elapsed = (await frameCount(page)) - typedAt;
        if (elapsed > EDIT_FRAME_BUDGET) {
          throw new Error(
            `The edit was not on stage ${elapsed} frames after it was typed ` +
              `(budget ${EDIT_FRAME_BUDGET}). Last histogram: ${JSON.stringify(stats?.histogram)}`,
          );
        }
        await waitForFrames(page, 4);
        stats = await bounded(captureAgentStats(page));
      }
      console.log(
        `[open-one-up] edit on stage ${(await frameCount(page)) - typedAt} frames after typing`,
      );

      // Still the same preset, the same audio and the same open editor.
      const after = await bounded(getAgentState(page));
      expect(after.presetId).toBe(FIRST_RUN_PRESET_ID);
      expect(after.audioSource).toBe('demo');
      expect(after.engineState).toBe('live');
      expect(after.panel).toBe('editor');
      expect(after.lastError).toBeNull();
      const interruptions = (
        await bounded(getAgentEvents(page, lastSeq))
      ).filter(
        (event) =>
          event.type === 'preset' ||
          event.type === 'audio-source' ||
          event.type === 'engine-state' ||
          event.type === 'backend',
      );
      expect(interruptions).toEqual([]);

      // And the music is still playing: the level keeps moving.
      const levels: number[] = [];
      for (let sample = 0; sample < AUDIO_SAMPLES; sample += 1) {
        await waitForFrames(page, AUDIO_SAMPLE_FRAMES);
        levels.push((await bounded(getAgentState(page))).audioEnergy ?? 0);
      }
      expect(Math.max(...levels), `audio levels ${levels}`).toBeGreaterThan(0);
      expect(
        new Set(levels).size,
        `audio levels ${levels}`,
      ).toBeGreaterThanOrEqual(3);
    } catch (error) {
      await writeAgentFailureArtifact(page, 'open-one-up');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // Worst case, every bound reached in sequence: launch 60 + goto 60 + home
  // chunk 90 + click 30 + live 60 + stage box 30 + Edit 30 + panel 60 + Tune
  // 60 + chips 60 (+ a last frame wait 60) + 4 page reads 60 + code click 30
  // + edit frames 60 + audio frames 60 + failure dump 30 + teardown 30 =
  // 900s, against a stage that stops rendering at the worst moment. Each step
  // fails at its own deadline with a message naming it; this backstop only
  // exists so the first real error wins.
  { timeout: 960_000 },
);
