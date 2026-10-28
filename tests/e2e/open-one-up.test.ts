/**
 * E2E: the "Open one up" moment (docs/PRODUCT_MOMENTS.md), walked the way a
 * visitor walks it.
 *
 * The landing promises "Open one to see which sounds drive it, then change
 * its code while it runs." This suite checks that promise from the first-run
 * state, with no deep link:
 *
 *   1. Play demo, then open the editor from the stage dock. The code shows
 *      at least eight lines with the Tune tab on screen, at 1280x720 here
 *      and at the 1366x657 a 1366x768 laptop leaves after browser chrome.
 *   2. Read the audio sources the Tune pane shows for every control and
 *      compare them with `analyzePresetDataflow` for the same preset.
 *   3. Type one edit into the code.
 *   4. The stage shows it within a bounded number of engine frames, and the
 *      demo audio and the preset are still running.
 *
 * A second test walks the same moment on a phone held upright (390x844),
 * where the editor is a bottom sheet: the folded dock's Edit chip opens it,
 * the middle of the stage stays in view above the sheet, and the edit lands
 * on stage there.
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
import { addSpinExample } from '../../src/js/frontend/first-edit.ts';
import {
  buildPresetCodeHash,
  decodePresetCodeFromHash,
} from '../../src/js/frontend/url-state.ts';
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

/**
 * The fewest lines of code the editor shows. With the first-edit guide and a
 * fixed-height dock above and below it, the code got 13px at 1280x720 and 0px
 * at 1366x657; it now keeps its height and the dock gives way.
 */
const MIN_CODE_LINES = 8;

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

/**
 * How many of its own lines the code area is tall, whether the Tune tab is
 * inside the viewport: the code must not get its room by pushing the dock off
 * screen — and whether the first driven audio chip is on screen without
 * scrolling the pane: the sounds the Tune pane exists to name must not sit
 * below the fold (docs/PRODUCT_MOMENTS.md, "Open one up").
 */
async function readEditorRoom(page: Page): Promise<{
  codeLines: number;
  tuneOnScreen: boolean;
  chipOnScreen: boolean;
}> {
  return bounded(
    page.evaluate(() => {
      const code = document.querySelector('.stims-editor__code');
      const content = document.querySelector('.stims-editor__code .cm-content');
      const tune = document.querySelector('#stims-editor-tab-tune');
      const chip = document.querySelector(
        '#stims-editor-pane-tune .stims-editor__state-chip[data-state="driven"]',
      );
      // The type's line height, not a rendered line's box: long equations
      // wrap, and a wrapped line is two rows tall.
      const lineHeight = content
        ? Number.parseFloat(getComputedStyle(content).lineHeight)
        : 0;
      const tuneBox = tune?.getBoundingClientRect();
      const chipBox = chip?.getBoundingClientRect();
      return {
        codeLines:
          lineHeight > 0
            ? (code?.getBoundingClientRect().height ?? 0) / lineHeight
            : 0,
        tuneOnScreen: Boolean(
          tuneBox &&
            tuneBox.height > 0 &&
            tuneBox.top >= 0 &&
            tuneBox.bottom <= window.innerHeight,
        ),
        chipOnScreen: Boolean(
          chipBox &&
            chipBox.height > 0 &&
            chipBox.top >= 0 &&
            chipBox.bottom <= window.innerHeight,
        ),
      };
    }),
    'measuring the editor',
  );
}

type CodeSource = { code: string; text: string };

/**
 * The driving sounds the code itself shows without being scrolled: each tag
 * inside the code's box, with the code on its line. A fresh preset opens the
 * code at the first line that has one; the first-run preset's equations
 * start at line 208, and the code used to open on line 1.
 */
async function readCodeSources(page: Page): Promise<CodeSource[]> {
  return bounded(
    page.evaluate(() => {
      const box = document
        .querySelector('.stims-editor__code')
        ?.getBoundingClientRect();
      if (!box) return [];
      return Array.from(document.querySelectorAll('.cm-audio-sources'))
        .filter((tag) => {
          const r = tag.getBoundingClientRect();
          return r.height > 0 && r.top >= box.top && r.bottom <= box.bottom;
        })
        .map((tag) => ({
          code: (tag.closest('.cm-line')?.textContent ?? '').replace(
            tag.textContent ?? '',
            '',
          ),
          text: tag.textContent ?? '',
        }));
    }),
    'reading the sounds the code shows',
  );
}

/** Reads the code's sources every few engine frames until some show. */
async function waitForCodeSources(page: Page): Promise<CodeSource[]> {
  const deadline = Date.now() + EDITOR_TIMEOUT_MS;
  let sources = await readCodeSources(page);
  while (sources.length === 0 && Date.now() < deadline) {
    await waitForFrames(page, 10);
    sources = await readCodeSources(page);
  }
  return sources;
}

type ChipReading = { label: string; state: string; audio: string[] };

/**
 * What the Tune pane says about every control: its label, whether the draft
 * owns the value or the equations do, and the audio it names. The visible
 * chip names every driving band; the same list is in the chip's accessible
 * name (and its tooltip), so that is what is read here, and the visible
 * text is checked against it separately.
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

/** The visible chip text the pane's own hint documents: `eq · bass, mid, treb`. */
function chipText({ state, audio }: ChipReading): string {
  if (state === 'static') return 'set';
  if (audio.length === 0) return 'eq';
  return `eq · ${audio.join(', ')}`;
}

requiredBrowserTest(
  'shared spin draft waits for its requested preset on a cold reload',
  async () => {
    const presetId = 'krash-rovastar-cerebral-demons-stars';
    const raw = readFileSync(
      path.join('public/milkdrop-presets', `${presetId}.milk`),
      'utf8',
    );
    const source = addSpinExample(
      compileMilkdropPresetSource(raw, { id: presetId }).formattedSource,
    ).after;
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: WEBGL_RENDERER_ARGS,
    });
    const ctx = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
      // A controlling service worker can fetch around Playwright's route
      // hold, especially while software rendering takes longer to boot.
      serviceWorkers: 'block',
    });
    const page = await ctx.newPage();
    let releaseSource: () => void = () => {};
    const sourceHeld = new Promise<void>((resolve) => {
      releaseSource = resolve;
    });
    let noteSourceRequest: () => void = () => {};
    const sourceRequested = new Promise<void>((resolve) => {
      noteSourceRequest = resolve;
    });
    try {
      // Catalog readiness precedes the requested .milk fetch. Hold that
      // fetch so the draft cannot accidentally win by loading on a fast GPU.
      await page.route(
        `**/milkdrop-presets/${presetId}.milk`,
        async (route) => {
          noteSourceRequest();
          await sourceHeld;
          await route.continue();
        },
      );
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6&preset=${presetId}&audio=demo${buildPresetCodeHash(source)}`,
      );
      await waitForAgentState(
        page,
        agentPredicates.engineLive(),
        LIVE_TIMEOUT_MS,
      );
      await bounded(sourceRequested, 'waiting for the held preset request');
      await waitForFrames(page, 10);
      expect((await getAgentState(page)).presetId).toBe(FIRST_RUN_PRESET_ID);
      const beforeLoad = await page.evaluate(() =>
        window.__stims_agent?.getVariables(),
      );
      expect(
        beforeLoad?.flip,
        'the shared draft must not run as the fallback preset',
      ).toBeUndefined();
      expect(
        decodePresetCodeFromHash(await page.evaluate(() => location.hash)),
      ).toBe(source);
      releaseSource();
      await bounded(
        page.evaluate(() => window.stims?.agent?.ready()),
        'waiting for startup selection',
      );
      await waitForFrames(page, 10);
      expect((await getAgentState(page)).presetId).toBe(presetId);
      const variables = await page.evaluate(() =>
        window.__stims_agent?.getVariables(),
      );
      expect(Math.abs(variables?.flip ?? 0)).toBe(1);
      expect(variables?.rot, 'the restored spin equation runs').toBeCloseTo(
        0.12,
      );
      const stats = await captureAgentStats(page);
      expect(stats).not.toBeNull();
      expect(stats?.histogram[0]).toBeLessThan(0.95);
      expect((await getAgentState(page)).audioSource).toBe('demo');
    } finally {
      releaseSource();
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 180_000 },
);

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
        .locator('[aria-label="Edit this visual"]:not([inert]):visible')
        .click({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );
      await page
        .locator('#stims-editor-tab-tune[aria-selected="true"]')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });

      const room = await readEditorRoom(page);
      expect(
        room.codeLines,
        'lines of code at 1280x720',
      ).toBeGreaterThanOrEqual(MIN_CODE_LINES);
      expect(room.tuneOnScreen, 'the Tune tab at 1280x720').toBe(true);

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

      // The controls lead: with the intro paragraph and the wave picker
      // above them, the first driven chip started at the bottom edge of
      // the window and the sounds sat below the fold.
      const withChips = await readEditorRoom(page);
      expect(
        withChips.chipOnScreen,
        'a driven chip on screen without scrolling at 1280x720',
      ).toBe(true);

      // The code names the same sounds where it sets the field, on screen
      // on the first open without scrolling it.
      const sources = await waitForCodeSources(page);
      expect(
        sources.find((source) => source.code.startsWith('zoom='))?.text,
        'the sounds on the zoom line at 1280x720',
      ).toBe(`← ${ZOOM_AUDIO.join(', ')}`);

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

      // Last, because a resize restarts the stage's feedback: the shortest
      // common laptop viewport. The editor is still open with the guide
      // above the code, and since the edit a draft note sits over it too.
      await page.setViewportSize({ width: 1366, height: 657 });
      await waitForFrames(page, 2);
      const laptop = await readEditorRoom(page);
      expect(
        laptop.codeLines,
        'lines of code at 1366x657',
      ).toBeGreaterThanOrEqual(MIN_CODE_LINES);
      expect(laptop.tuneOnScreen, 'the Tune tab at 1366x657').toBe(true);
      // The chip reading is asserted at 1280x720 above, on the first open
      // the finding measured. Here a draft note has sat over the editor
      // since the edit, and that note — not the pane's order — owns those
      // pixels; asserting the chip through it would fail on the note, not
      // on the fold.
    } catch (error) {
      await writeAgentFailureArtifact(page, 'open-one-up');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // Worst case, every bound reached in sequence: launch 60 + goto 60 + home
  // chunk 90 + click 30 + live 60 + stage box 30 + Edit 30 + panel 60 + Tune
  // 60 + code lines 60 + chips 60 (+ a last frame wait 60) + 6 page reads 90
  // + code click 30 + edit frames 60 + audio frames 60 + resize frames 60 +
  // failure dump 30 + teardown 30 = 1050s, against a stage that stops
  // rendering at the worst moment. Each step fails at its own deadline with a
  // message naming it; this backstop only exists so the first real error wins.
  { timeout: 1_110_000 },
);

/**
 * A phone held upright, the context policy 2 in docs/PRODUCT_MOMENTS.md
 * measures beside 1280x720. Below 768px wide the editor is a bottom sheet;
 * at 92dvh it left the top 70px of the stage, so an edit could not be
 * watched while it ran.
 */
const PHONE_VIEWPORT = { width: 390, height: 844 };

/**
 * Stage left above the sheet. 204px measured on the first open, where the
 * old 92dvh sheet left 68px. The bound sits under the measurement so a
 * different font's line metrics cannot fail it, and far above the old 68px.
 */
const MIN_PHONE_STAGE_PX = 180;

requiredBrowserTest(
  'open one up on a phone: the folded dock opens the editor, and the edit shows above the sheet',
  async () => {
    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    const ctx = await browser.newContext({
      viewport: PHONE_VIEWPORT,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => {
      console.log(`[OPEN ONE UP PHONE PAGE ERROR] ${error.message}`);
    });

    try {
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
      await playDemo.tap({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) &&
          agentPredicates.presetIs(FIRST_RUN_PRESET_ID)(state) &&
          state.audioSource === 'demo',
        LIVE_TIMEOUT_MS,
      );

      // A visitor watching the stage sees the folded dock: the bar folds
      // after a few idle seconds and leaves the Edit chip beside Controls.
      // A tap's pointerdown used to bring the bar back and make the chip
      // inert before its click arrived, so the tap opened nothing.
      const foldedEdit = page.locator(
        'button[data-action="open-editor"][data-visible="true"]',
      );
      await foldedEdit.waitFor({
        state: 'visible',
        timeout: CLICK_TIMEOUT_MS,
      });
      await foldedEdit.tap({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      // The first open names Tab and Esc in a note over the editor for a few
      // seconds; the layout below is the one the visitor edits in after it.
      await page
        .locator('[role="dialog"] [data-anchor="panel"]')
        .waitFor({ state: 'detached', timeout: EDITOR_TIMEOUT_MS });

      const sheet = await bounded(
        page.evaluate(() => {
          const panel = document
            .querySelector('[role="dialog"][data-stage-anchored="true"]')
            ?.getBoundingClientRect();
          const stage = document
            .querySelector('.stims-shell__stage-root')
            ?.getBoundingClientRect();
          const code = document
            .querySelector('.stims-editor__code')
            ?.getBoundingClientRect();
          const gizmo = document
            .querySelector('.stims-stage-gizmo')
            ?.getBoundingClientRect();
          const sheetTop = panel?.top ?? 0;
          return {
            sheetTop,
            stageMiddle: stage ? stage.top + stage.height / 2 : Number.NaN,
            stageTop: stage?.top ?? Number.NaN,
            gizmoTop: gizmo?.top ?? Number.NaN,
            codeOnScreen: Boolean(
              code && code.top >= sheetTop && code.bottom <= window.innerHeight,
            ),
          };
        }),
        'measuring the editor sheet',
      );
      expect(
        sheet.sheetTop,
        'stage left above the sheet at 390x844',
      ).toBeGreaterThanOrEqual(MIN_PHONE_STAGE_PX);
      // The middle of the frame, where a preset's zoom and rotation centre,
      // is in that strip rather than under the sheet.
      expect(sheet.stageMiddle, 'the stage middle').toBeGreaterThan(0);
      expect(sheet.stageMiddle, 'the stage middle').toBeLessThan(
        sheet.sheetTop,
      );
      // The warp-centre handle maps pointer positions over its own layer,
      // so that layer has to ride up with the canvas it steers.
      expect(sheet.gizmoTop, 'the warp-centre layer').toBeCloseTo(
        sheet.stageTop,
        0,
      );
      expect(sheet.codeOnScreen, 'the code inside the sheet').toBe(true);
      const room = await readEditorRoom(page);
      expect(room.codeLines, 'lines of code at 390x844').toBeGreaterThanOrEqual(
        MIN_CODE_LINES,
      );
      expect(room.tuneOnScreen, 'the Tune tab at 390x844').toBe(true);
      // The Tune chips sit below the fold in the sheet; the code says it.
      const sources = await waitForCodeSources(page);
      expect(
        sources.find((source) => source.code.startsWith('zoom='))?.text,
        'the sounds on the zoom line at 390x844',
      ).toBe(`← ${ZOOM_AUDIO.join(', ')}`);

      const baseline = await bounded(captureAgentStats(page));
      expect(baseline).not.toBeNull();
      if (!baseline) return;
      expect(showsEdit(baseline), 'the stage before the edit').toBe(false);

      await page
        .locator('.stims-editor .cm-content')
        .tap({ timeout: CLICK_TIMEOUT_MS });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
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

      const after = await bounded(getAgentState(page));
      expect(after.presetId).toBe(FIRST_RUN_PRESET_ID);
      expect(after.audioSource).toBe('demo');
      expect(after.panel).toBe('editor');
      expect(after.lastError).toBeNull();
    } catch (error) {
      await writeAgentFailureArtifact(page, 'open-one-up-phone');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // Every bound reached in sequence: launch 60 + goto 60 + home chunk 90 +
  // tap 30 + live 60 + fold 30 + chip tap 30 + panel 60 + code 60 + note 60
  // + 3 page reads 45 + code tap 30 + edit frames 60 + failure dump 30 +
  // teardown 30 = 735s; the backstop lets the first real error win.
  { timeout: 780_000 },
);

/** WCAG AA for body text, which the code is. */
const MIN_CODE_CONTRAST = 4.5;

/**
 * The lowest contrast any code text on screen has against the well, and
 * against the well under the active-line tint: every token colour, the line
 * numbers and the sounds. Also the Tune pane's "hand-written equation"
 * label against the panel behind it, and whether the fade under the last
 * line ends in the well's own colour.
 */
async function readCodeContrast(page: Page): Promise<{
  theme: string;
  worst: { text: string; ratio: number };
  handWritten: number | null;
  fadeEndsInWell: boolean;
}> {
  return bounded(
    page.evaluate(() => {
      type Rgba = { r: number; g: number; b: number; a: number };
      const parse = (css: string): Rgba => {
        const parts = (/rgba?\(([^)]+)\)/.exec(css)?.[1] ?? '0 0 0 0')
          .split(/[\s,/]+/)
          .filter(Boolean)
          .map(Number);
        return {
          r: parts[0] ?? 0,
          g: parts[1] ?? 0,
          b: parts[2] ?? 0,
          a: parts[3] ?? 1,
        };
      };
      const over = (top: Rgba, under: Rgba): Rgba => ({
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
        a: 1,
      });
      const channel = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (c: Rgba) =>
        0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      const ratio = (a: Rgba, b: Rgba) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
      };
      /** What is painted behind `element`: every background down to it. */
      const backdrop = (element: Element): Rgba => {
        const chain: Element[] = [];
        for (let el: Element | null = element; el; el = el.parentElement) {
          chain.unshift(el);
        }
        return chain.reduce(
          (under, el) =>
            over(parse(getComputedStyle(el).backgroundColor), under),
          { r: 255, g: 255, b: 255, a: 1 } as Rgba,
        );
      };
      /** Its colour as drawn: its alpha times every ancestor's opacity. */
      const ink = (element: Element): Rgba => {
        const color = parse(getComputedStyle(element).color);
        let opacity = 1;
        for (let el: Element | null = element; el; el = el.parentElement) {
          opacity *= Number(getComputedStyle(el).opacity);
        }
        return { ...color, a: color.a * opacity };
      };

      const code = document.querySelector('.stims-editor__code') as Element;
      const box = code.getBoundingClientRect();
      const well = backdrop(code);
      const activeTint = parse(
        getComputedStyle(code).getPropertyValue('--ed-code-active').trim() ||
          'rgba(0,0,0,0)',
      );
      const activeLine = over(activeTint, well);
      let worst = { text: '', ratio: Number.POSITIVE_INFINITY };
      const texts = document.querySelectorAll(
        '.cm-line, .cm-line span, .cm-lineNumbers .cm-gutterElement',
      );
      for (const element of texts) {
        const r = element.getBoundingClientRect();
        if (!element.textContent?.trim() || r.height === 0) continue;
        if (r.bottom < box.top || r.top > box.bottom - 22) continue;
        const color = ink(element);
        for (const ground of [well, activeLine]) {
          const value = ratio(over(color, ground), ground);
          if (value < worst.ratio) {
            worst = {
              text: element.textContent.trim().slice(0, 40),
              ratio: value,
            };
          }
        }
      }

      const readout = document.querySelector(
        '.stims-editor__mod[data-state="custom"] .stims-editor__mod-readout',
      );
      const handWritten = readout
        ? ratio(over(ink(readout), backdrop(readout)), backdrop(readout))
        : null;

      const fade = getComputedStyle(code, '::after').backgroundImage;
      const stops = fade.match(/rgba?\([^)]+\)/g) ?? [];
      const last = parse(stops.at(-1) ?? '');
      const wellColor = parse(getComputedStyle(code).backgroundColor);
      return {
        theme: document.documentElement.classList.contains('light')
          ? 'light'
          : 'dark',
        worst,
        handWritten,
        fadeEndsInWell:
          last.a === 1 &&
          last.r === wellColor.r &&
          last.g === wellColor.g &&
          last.b === wellColor.b,
      };
    }),
    'measuring the code contrast',
  );
}

requiredBrowserTest(
  'the editor reads in both themes, keeps its toolbar in the panel, lets Escape past the code and announces errors',
  async () => {
    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => {
      console.log(`[EDITOR PANEL PAGE ERROR] ${error.message}`);
    });

    try {
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
          agentPredicates.presetIs(FIRST_RUN_PRESET_ID)(state),
        LIVE_TIMEOUT_MS,
      );
      await bounded(
        page.evaluate(() => window.__stims_agent?.run('open-editor')),
        'opening the editor',
      );
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      expect(
        (await waitForCodeSources(page)).length,
        'sounds in the code',
      ).toBeGreaterThan(0);

      // Both themes, on the opening lines (fields) and on the equations,
      // where keywords, registers and functions are coloured too. The well
      // stayed dark under the light palette at 1.9-2.6:1.
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await page.waitForFunction(
          (light) =>
            document.documentElement.classList.contains('light') === light,
          colorScheme === 'light',
          { timeout: PAGE_CALL_TIMEOUT_MS },
        );
        for (const where of ['top', 'equations'] as const) {
          if (where === 'equations') {
            await bounded(
              page.evaluate(() => {
                const scroller = document.querySelector('.cm-scroller');
                if (scroller) scroller.scrollTop = scroller.scrollHeight;
              }),
              'scrolling to the equations',
            );
            await waitForFrames(page, 3);
          }
          const reading = await readCodeContrast(page);
          expect(reading.theme).toBe(colorScheme);
          expect(
            reading.worst.ratio,
            `lowest code contrast, ${colorScheme} theme, ${where}: "${reading.worst.text}"`,
          ).toBeGreaterThanOrEqual(MIN_CODE_CONTRAST);
          expect(
            reading.fadeEndsInWell,
            `the fade ends in the well's colour, ${colorScheme} theme`,
          ).toBe(true);
          expect(
            reading.handWritten,
            `"hand-written equation" contrast, ${colorScheme} theme`,
          ).toBeGreaterThanOrEqual(MIN_CODE_CONTRAST);
        }
      }

      // The toolbar stays inside the panel, so the overflow menu is on
      // screen and focusing it cannot scroll the panel sideways. At this
      // size it ran 58px past the panel's right edge.
      const menuButton = page.locator(
        '.stims-editor__toolbar [aria-label="Preset actions"]',
      );
      await menuButton.focus({ timeout: CLICK_TIMEOUT_MS });
      const toolbar = await bounded(
        page.evaluate(() => {
          const bar = document
            .querySelector('.stims-editor__toolbar')
            ?.getBoundingClientRect();
          const host = document.querySelector(
            '.stims-shell__editor-host',
          ) as HTMLElement | null;
          const items = Array.from(
            document.querySelectorAll('.stims-editor__toolbar > *'),
          ).map((item) => item.getBoundingClientRect());
          return {
            inside: Boolean(
              bar &&
                items.every(
                  (item) =>
                    item.left >= bar.left - 0.5 &&
                    item.right <= bar.right + 0.5,
                ),
            ),
            rows: new Set(items.map((item) => Math.round(item.top))).size,
            hostScrollLeft: host?.scrollLeft ?? -1,
          };
        }),
        'measuring the toolbar',
      );
      expect(toolbar.inside, 'every toolbar control inside the toolbar').toBe(
        true,
      );
      expect(toolbar.rows, 'toolbar rows at 1280x720').toBe(1);
      expect(toolbar.hostScrollLeft, 'the editor scrolled sideways').toBe(0);
      await page.keyboard.press('Enter');
      const menuOnScreen = await bounded(
        page.evaluate(() =>
          Array.from(
            document.querySelectorAll('.stims-editor__menu [role="menuitem"]'),
          )
            .filter((item) => !(item as HTMLElement).hidden)
            .every((item) => {
              const r = item.getBoundingClientRect();
              return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth;
            }),
        ),
        'measuring the menu',
      );
      expect(menuOnScreen, 'every menu item on screen').toBe(true);
      await page.keyboard.press('Escape');

      // Escape out of the code moves on past it, so the next Tab reaches
      // the dock instead of going back in and indenting the preset.
      await page
        .locator('.stims-editor .cm-content')
        .click({ timeout: CLICK_TIMEOUT_MS });
      await page.keyboard.press('Escape');
      const afterEscape = await bounded(
        page.evaluate(() => {
          const code = document.querySelector('.stims-editor .cm-editor');
          const active = document.activeElement;
          return {
            inCode: Boolean(code && active && code.contains(active)),
            afterCode: Boolean(
              code &&
                active &&
                code.compareDocumentPosition(active) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          };
        }),
        'reading focus after Escape',
      );
      expect(afterEscape, 'focus after Escape').toEqual({
        inCode: false,
        afterCode: true,
      });
      await page.keyboard.press('Tab');
      expect(
        await bounded(
          page.evaluate(() =>
            Boolean(
              document
                .querySelector('.stims-editor .cm-editor')
                ?.contains(document.activeElement),
            ),
          ),
        ),
        'Tab after Escape went back into the code',
      ).toBe(false);

      // A compile error is announced, with its count.
      await page
        .locator('.stims-editor .cm-content')
        .click({ timeout: CLICK_TIMEOUT_MS });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('per_frame_99=zoom = sin(;');
      const status = page.locator('.stims-editor__state[role="status"]');
      await status.waitFor({ timeout: EDITOR_TIMEOUT_MS });
      await page.waitForFunction(
        () =>
          document
            .querySelector('.stims-editor__state')
            ?.getAttribute('data-state') === 'error',
        null,
        { timeout: EDITOR_TIMEOUT_MS },
      );
      expect(await status.textContent()).toMatch(
        /Holding last good frame: \d+ errors?$/u,
      );
    } catch (error) {
      await writeAgentFailureArtifact(page, 'editor-panel-reach');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // launch 60 + goto 60 + home chunk 90 + click 30 + live 60 + open 15 +
  // panel 60 + code 60 + sources 60 + 2 themes x (15 + 2 x (15 + 60 + 15))
  // + toolbar 45 + menu 15 + Escape 45 + error 120 + failure dump 30 +
  // teardown 30 = 1200s; the backstop lets the first real error win.
  { timeout: 1_260_000 },
);
