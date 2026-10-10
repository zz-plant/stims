/**
 * E2E: the studio loop — browse → edit → compare → save → share → arrive by
 * link — the whole "Open one up" funnel walked end to end without leaving
 * the running session.
 *
 * Each leg is the thing one funnel step claims, driven through the agent API
 * (`window.__stims_agent`, see docs/agents/browser-automation.md) so the
 * loop exercises the product's own verbs, not a test harness's:
 *
 *   1. Play demo from the landing, then Browse and pick a preset — the
 *      audio keeps playing; nothing unmounts.
 *   2. Open the editor and type one edit with the reference red-border
 *      pattern from tests/e2e/open-one-up.test.ts: `decay = 0` plus a red
 *      border half the screen deep, a frame the preset cannot produce on
 *      its own. It must reach the stage within a frame budget.
 *   3. A/B against the original: the stage stops showing the edit while
 *      "Original" is up, and shows it again once "Your edit" is back.
 *   4. Save (the dock star) — the running session survives the star.
 *   5. Share: the link carries the draft as a `#code=` hash that decodes
 *      back to exactly the edited source.
 *   6. Reload on that link: the carried draft lands on stage, the editor
 *      opens on it, and the demo audio starts with it.
 *
 * WebGL and frame-counted waits, like tests/e2e/open-one-up.test.ts, so
 * CI's SwiftShader runner can run it. Wall-clock deadlines only stop a
 * wedged page from eating the test budget.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import type { FrameStats } from '../../src/js/core/services/visual-embedding.ts';
import { decodePresetCodeFromHash } from '../../src/js/frontend/url-state.ts';
import {
  agentPredicates,
  captureAgentStats,
  getAgentState,
  runAgentAction,
  waitForAgentState,
  writeAgentFailureArtifact,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5196;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

/** Picked from the bundled catalog: not the first-run preset, so choosing it
 * from Browse really changes the stage. Its frame is bright washed-out
 * color, so the red-border edit below cannot be mistaken for it. */
const PICKED_PRESET = 'geiss-casino';

const LAUNCH_TIMEOUT_MS = 60_000;
/** Play demo and the editor are lazy chunks a cold vite dev server transforms. */
const CHUNK_TIMEOUT_MS = 90_000;
const CLICK_TIMEOUT_MS = 30_000;
const LIVE_TIMEOUT_MS = 60_000;
const EDITOR_TIMEOUT_MS = 60_000;
/** Backstop for the frame-counted waits; see the file docblock. */
const FRAME_WAIT_TIMEOUT_MS = 60_000;
const PAGE_CALL_TIMEOUT_MS = 15_000;
/** Engine frames from the last keystroke to the edit on stage (see
 * open-one-up: measured 33 on a laptop GPU, 2 on SwiftShader). */
const EDIT_FRAME_BUDGET = 150;

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

/** The open-one-up edit pattern: a red border half the screen deep with
 * `decay = 0` — a frame the preset cannot produce on its own, and neither
 * can a black or washed-out stage. The border's alpha is set too, because
 * a preset with `ob_a=0` (a transparent border) would paint nothing. The
 * per-frame index is derived from the preset file so the appended line
 * never collides with the author's own. */
function editLineFor(presetId: string): string {
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
  const indexes = [...source.matchAll(/^\s*per_frame_(\d+)\s*=/gimu)].map(
    (match) => Number(match[1]),
  );
  const next = (indexes.length > 0 ? Math.max(...indexes) : 0) + 1;
  return `per_frame_${next}=ob_size = 0.5; ob_r = 1; ob_g = 0; ob_b = 0; ob_a = 1; decay = 0;`;
}

/** The histogram reading that says the edit is on stage (see open-one-up). */
function showsEdit(stats: FrameStats): boolean {
  const { histogram } = stats;
  return histogram[7] >= 0.3 && histogram[8] >= 0.95 && histogram[16] >= 0.95;
}

/** Resolves with the first capture that reads `expect` on stage, or throws
 * once the edit frame budget is spent. */
async function waitOnStage(
  page: Page,
  expect: boolean,
  sinceFrame: number,
  what: string,
): Promise<void> {
  let stats = await bounded(captureAgentStats(page));
  while (!(stats && showsEdit(stats) === expect)) {
    const elapsed = (await frameCount(page)) - sinceFrame;
    if (elapsed > EDIT_FRAME_BUDGET) {
      throw new Error(
        `${what} was not on stage ${elapsed} frames after the commit ` +
          `(budget ${EDIT_FRAME_BUDGET}). Last histogram: ${JSON.stringify(stats?.histogram)}`,
      );
    }
    await waitForFrames(page, 4);
    stats = await bounded(captureAgentStats(page));
  }
}

requiredBrowserTest(
  'studio loop: browse, edit, compare, save and share in one running session',
  async () => {
    const EDIT_LINE = editLineFor(PICKED_PRESET);

    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    // Headless Chromium exposes a navigator.share that always rejects with
    // NotAllowedError, which the share flow correctly reads as the user
    // cancelling — and a test cannot click a share sheet. Desktop browsers
    // without the Web Share API take the clipboard path instead; removing
    // the stub makes this loop exercise that path, the one every desktop
    // Firefox and Safari visitor gets, with the granted permissions above.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: undefined,
      });
    });
    page.on('pageerror', (error) => {
      console.log(`[STUDIO LOOP PAGE ERROR] ${error.message}`);
    });

    try {
      // The session starts the way every visit does: the landing, then demo.
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6`,
        { waitUntil: 'domcontentloaded', timeout: CHUNK_TIMEOUT_MS },
      );
      const playDemo = page.locator(
        '.stims-shell__launch-cta[data-demo-audio-btn]',
      );
      await playDemo.waitFor({ state: 'attached', timeout: CHUNK_TIMEOUT_MS });
      await playDemo.click({ timeout: CLICK_TIMEOUT_MS });
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) && state.audioSource === 'demo',
        LIVE_TIMEOUT_MS,
      );

      // ── Browse, pick a preset. The agent API's own verb for picking. ──
      const openedBrowse = await bounded(
        runAgentAction(page, 'open-browse'),
        'opening Browse',
      );
      expect(openedBrowse.ok).toBe(true);
      await waitForAgentState(
        page,
        (state) => state.panel === 'browse',
        LIVE_TIMEOUT_MS,
      );
      await waitForAgentState(
        page,
        (state) => state.catalogSize > 0,
        LIVE_TIMEOUT_MS,
      );
      const picked = await bounded(
        runAgentAction(page, 'select-preset', { id: PICKED_PRESET }),
        `picking ${PICKED_PRESET}`,
      );
      expect(picked.ok).toBe(true);
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) &&
          agentPredicates.presetIs(PICKED_PRESET)(state) &&
          state.audioSource === 'demo',
        LIVE_TIMEOUT_MS,
      );

      // ── The edit, applied in the running session. ──
      const openedEditor = await bounded(
        runAgentAction(page, 'open-editor'),
        'opening the editor',
      );
      expect(openedEditor.ok).toBe(true);
      await waitForAgentState(
        page,
        (state) => state.panel === 'editor',
        EDITOR_TIMEOUT_MS,
      );
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });

      // The stage must not already look edited, or the checks below would
      // pass on a frame the edit never touched.
      const baseline = await bounded(captureAgentStats(page));
      expect(baseline).not.toBeNull();
      if (!baseline) return;
      expect(showsEdit(baseline), 'the stage before the edit').toBe(false);

      await page
        .locator('.stims-editor .cm-content')
        .click({ timeout: CLICK_TIMEOUT_MS });
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      // One input event, as a paste or IME commit delivers it.
      await page.keyboard.insertText(EDIT_LINE);

      await waitOnStage(page, true, await frameCount(page), 'the typed edit');

      // Still one session: the same preset, the same demo audio, the open
      // editor, and no engine interruptions.
      const afterEdit = await bounded(getAgentState(page));
      expect(afterEdit.presetId).toBe(PICKED_PRESET);
      expect(afterEdit.audioSource).toBe('demo');
      expect(afterEdit.engineState).toBe('live');
      expect(afterEdit.panel).toBe('editor');
      expect(afterEdit.lastError).toBeNull();

      // ── A/B against the original. ──
      const abToggle = page.locator('.stims-editor [data-action="ab-toggle"]');
      await abToggle.click({ timeout: CLICK_TIMEOUT_MS });
      await abToggle.filter({ hasText: 'Original' }).waitFor({
        timeout: EDITOR_TIMEOUT_MS,
      });
      await waitOnStage(
        page,
        false,
        await frameCount(page),
        'the original while A/B shows it',
      );

      await abToggle.click({ timeout: CLICK_TIMEOUT_MS });
      await abToggle.filter({ hasText: 'Your edit' }).waitFor({
        timeout: EDITOR_TIMEOUT_MS,
      });
      await waitOnStage(
        page,
        true,
        await frameCount(page),
        'the edit back from A/B',
      );

      // ── Save the preset, without leaving the session. ──
      const saved = await bounded(
        runAgentAction(page, 'save-preset'),
        'saving the preset',
      );
      expect(saved.ok).toBe(true);
      // The dock's star reads the same store the palette action writes.
      await page
        .locator('[data-action="save-preset"][data-saved="true"]')
        .first()
        .waitFor({ timeout: CLICK_TIMEOUT_MS });
      const afterSave = await bounded(getAgentState(page));
      expect(afterSave.engineState).toBe('live');
      expect(afterSave.presetId).toBe(PICKED_PRESET);

      // ── Share: the link carries the draft. ──
      const shared = await bounded(
        runAgentAction(page, 'share-link'),
        'sharing the link',
      );
      expect(shared.ok).toBe(true);
      const sharedState = await bounded(getAgentState(page));
      expect(
        sharedState.statusLog.at(-1)?.message,
        'the share step names what it did',
      ).toContain('Link copied');

      // The draft is in the address bar as a #code= hash; it must decode
      // back to the source with the edit in it.
      const addressHref = await bounded(
        page.evaluate(() => window.location.href),
        'reading the address bar',
      );
      expect(addressHref).toContain('#code=');
      const carried = decodePresetCodeFromHash(new URL(addressHref).hash);
      expect(carried, 'the #code= hash decodes').not.toBeNull();
      expect(carried).toContain(EDIT_LINE);

      // The share link is the same draft. The clipboard needs the granted
      // permissions above; a headless browser may refuse it, in which case
      // the address bar — the surface the hint promises — is the check.
      const clipboardUrl = await page
        .evaluate(() => navigator.clipboard.readText().catch(() => null))
        .catch(() => null);
      if (typeof clipboardUrl === 'string' && clipboardUrl.includes('#code=')) {
        expect(decodePresetCodeFromHash(new URL(clipboardUrl).hash)).toContain(
          EDIT_LINE,
        );
      }

      // ── Arrive by the shared link: the draft lands on stage. ──
      const shareUrl = new URL(addressHref);
      shareUrl.searchParams.set('agent', 'true');
      shareUrl.searchParams.set('renderer', 'webgl');
      shareUrl.searchParams.set('lockQualityStep', '6');
      await page.goto(shareUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: LIVE_TIMEOUT_MS,
      });
      // The link names the picked preset and starts the demo with it; the
      // carried draft opens the editor and applies over it.
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineLive()(state) &&
          agentPredicates.presetIs(PICKED_PRESET)(state) &&
          state.audioSource === 'demo' &&
          state.panel === 'editor',
        LIVE_TIMEOUT_MS,
      );
      await page
        .locator('.stims-editor__code .cm-content')
        .waitFor({ timeout: EDITOR_TIMEOUT_MS });
      const codeAfterReload = await bounded(
        page.evaluate(
          () =>
            document.querySelector('.stims-editor__code .cm-content')
              ?.textContent ?? '',
        ),
        'reading the code after the reload',
      );
      expect(codeAfterReload).toContain('ob_size = 0.5');

      // And the carried draft is what runs: the edit's frame, not the
      // picked preset's own.
      const reloadBaselineFrame = await frameCount(page);
      await waitOnStage(
        page,
        true,
        reloadBaselineFrame,
        'the carried draft after the reload',
      );
      const arrived = await bounded(getAgentState(page));
      expect(arrived.lastError).toBeNull();
    } catch (error) {
      await writeAgentFailureArtifact(page, 'studio-loop');
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  // Worst case, every bound reached in sequence: launch 60 + goto 90 + home
  // chunk 90 + click 30 + live 60 + browse 15 + panel 60 + catalog 60 +
  // pick 15 + live 60 + editor 15 + panel 60 + code 60 + edit frames 60 +
  // A/B 30+60+60 + A/B back 30+60+60 + save 15 + star 30 + share 15 +
  // address read 15 + clipboard 15 + reload goto 60 + live 60 + code 60 +
  // draft frames 60 + failure dump 30 + teardown 30 = ~1600s; each step
  // fails at its own deadline with a message naming it, and this backstop
  // only exists so the first real error wins.
  { timeout: 1_800_000 },
);
