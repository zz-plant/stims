/**
 * E2E: an agent's code edit is kept the way a typed one is.
 *
 * The draft promise (docs/USER_GUIDE.md): an edit that compiles is saved per
 * preset in this browser and comes back the next time that preset loads, and
 * the browser's leave-page prompt appears only while something would be lost.
 * Until `run('edit-source')` existed none of this could be driven through the
 * agent API: `set-field` writes the running VM and never touches the editor
 * session, and typing in a browser pane closes the editor. This suite walks
 * it through the verb:
 *
 *   1. Edit the first-run preset's zoom. The session turns dirty and, once
 *      the draft is written, leaving is not prompted.
 *   2. Play another preset and come back: the load says "with your saved
 *      edits" and the edited zoom is what compiled.
 *   3. A line that does not compile holds the prompt; restoring the good
 *      source drops it.
 *   4. A compiling edit whose draft write has not landed holds the prompt
 *      too, until the write completes.
 *
 * The prompt is read by dispatching a cancelable `beforeunload` and asking
 * whether the app's listener cancelled it, which is what makes the browser
 * show its dialog. WebGL and frame-free waits, so CI's SwiftShader runner
 * can run it.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium, type Page } from 'playwright';
import type { AgentEditorState } from '../../src/js/frontend/agent-bridge.ts';
import { decodePresetCodeFromHash } from '../../src/js/frontend/url-state.ts';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import {
  agentPredicates,
  getAgentState,
  runAgentAction,
  waitForAgentState,
  writeAgentFailureArtifact,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly, withDeadline } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, WEBGL_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5211;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

/** A starter-showcase preset, so it is always in the bundled catalog. */
const OTHER_PRESET_ID = 'geiss-casino';
/** Neither preset's own zoom, so reading it back proves the draft ran. */
const EDITED_ZOOM = 0.913;

const LAUNCH_TIMEOUT_MS = 60_000;
/** The landing and the engine are lazy chunks on a cold vite. */
const BOOT_TIMEOUT_MS = 90_000;
const PRESET_TIMEOUT_MS = 60_000;
/** A draft write is one IndexedDB transaction; this is the backstop. */
const SAVE_TIMEOUT_MS = 15_000;

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

type DraftTestWindow = typeof window & {
  __heldDraftWrites?: Array<() => void> | null;
};

/** Whether leaving now would ask first: the app cancels `beforeunload`. */
async function leavePrompted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

/** Resolves once leaving is (or is no longer) prompted. */
async function waitForLeavePrompt(page: Page, prompted: boolean) {
  await page.waitForFunction(
    (expected) => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented === expected;
    },
    prompted,
    { timeout: SAVE_TIMEOUT_MS, polling: 100 },
  );
}

async function editSource(
  page: Page,
  params: { source: string } | { append: string },
): Promise<AgentEditorState> {
  const result = await runAgentAction(page, 'edit-source', params);
  expect(result.ok, result.error).toBe(true);
  if (!result.editor) throw new Error('edit-source returned no editor state');
  return result.editor;
}

async function editorZoom(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () => window.__STIMS_AGENT_BRIDGE__?.getEditorFields()?.zoom,
  );
}

async function selectPreset(page: Page, id: string) {
  const result = await runAgentAction(page, 'select-preset', { id });
  expect(result.ok, result.error).toBe(true);
  await waitForAgentState(
    page,
    agentPredicates.presetIs(id),
    PRESET_TIMEOUT_MS,
  );
}

/**
 * Holds every draft write (an IndexedDB `meta` readwrite transaction) until
 * `releaseDraftWrites`, as a slow or contended disk would. The held write
 * completes without storing anything, so this runs last.
 */
async function holdDraftWrites(page: Page) {
  await page.evaluate(() => {
    const scope = window as DraftTestWindow;
    scope.__heldDraftWrites = [];
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const [names, mode] = args;
      const held = scope.__heldDraftWrites;
      if (!held || mode !== 'readwrite' || String(names) !== 'meta') {
        return original.apply(this, args);
      }
      const stub = {
        oncomplete: null as (() => void) | null,
        onerror: null,
        onabort: null,
        objectStore: () => ({ put: () => {}, delete: () => {} }),
      };
      held.push(() => stub.oncomplete?.());
      return stub as unknown as IDBTransaction;
    } as IDBDatabase['transaction'];
  });
}

async function heldDraftWriteCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as DraftTestWindow).__heldDraftWrites?.length ?? 0,
  );
}

async function releaseDraftWrites(page: Page) {
  await page.evaluate(() => {
    const scope = window as DraftTestWindow;
    const held = scope.__heldDraftWrites ?? [];
    scope.__heldDraftWrites = null;
    for (const complete of held) complete();
  });
}

requiredBrowserTest(
  'editor drafts: an edit-source edit is saved, restored on return, and guards leaving only while unsaved',
  async () => {
    const browser = await withDeadline(
      chromium.launch({ headless: HEADLESS, args: WEBGL_RENDERER_ARGS }),
      LAUNCH_TIMEOUT_MS,
      'launching Chromium',
    );
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (error) => {
      console.log(`[EDITOR DRAFTS PAGE ERROR] ${error.message}`);
    });

    try {
      await page.goto(
        `${SERVER_URL}/?agent=true&renderer=webgl&lockQualityStep=6`,
        { waitUntil: 'domcontentloaded', timeout: BOOT_TIMEOUT_MS },
      );
      await waitForAgentState(
        page,
        (state) =>
          agentPredicates.engineReady()(state) &&
          state.presetId === FIRST_RUN_PRESET_ID,
        BOOT_TIMEOUT_MS,
      );
      expect(await leavePrompted(page), 'nothing edited yet').toBe(false);

      // 1. An edit through the verb is an editor edit: dirty, then saved.
      const edited = await editSource(page, {
        append: `zoom=${EDITED_ZOOM}`,
      });
      expect(edited).toMatchObject({
        presetId: FIRST_RUN_PRESET_ID,
        dirty: true,
        errorCount: 0,
      });
      expect(await editorZoom(page)).toBeCloseTo(EDITED_ZOOM, 6);
      await waitForLeavePrompt(page, false);
      // The address bar carries the dirty buffer; it is the good source
      // step 3 restores.
      const editedSource = decodePresetCodeFromHash(
        await page.evaluate(() => location.hash),
      );
      expect(editedSource).toContain(`zoom=${EDITED_ZOOM}`);

      // 2. Away and back: the draft replaces the file, and the load says so.
      await selectPreset(page, OTHER_PRESET_ID);
      expect(await leavePrompted(page), 'a clean preset').toBe(false);
      const toast = page
        .locator('.stims-shell__toast')
        .filter({ hasText: 'with your saved edits' });
      await selectPreset(page, FIRST_RUN_PRESET_ID);
      await toast.first().waitFor({
        state: 'visible',
        timeout: PRESET_TIMEOUT_MS,
      });
      const restoredLog = (await getAgentState(page)).statusLog;
      expect(
        restoredLog.some((entry) =>
          entry.message.includes('with your saved edits'),
        ),
      ).toBe(true);
      expect(await editorZoom(page)).toBeCloseTo(EDITED_ZOOM, 6);

      // 3. A line that does not compile: the saved copy is the last good
      // version, so leaving would lose the text.
      const broken = await editSource(page, {
        append: 'per_frame_900=zoom = (;',
      });
      expect(broken.errorCount).toBeGreaterThan(0);
      expect(broken.renderingFallback).toBe(true);
      expect(await leavePrompted(page), 'the buffer has errors').toBe(true);
      const restored = await editSource(page, { source: editedSource ?? '' });
      expect(restored.errorCount).toBe(0);
      await waitForLeavePrompt(page, false);

      // 4. A compiling edit whose write is still pending.
      await holdDraftWrites(page);
      const pending = await editSource(page, { append: 'rot=0.0123' });
      expect(pending.errorCount).toBe(0);
      await page.waitForFunction(
        () => ((window as DraftTestWindow).__heldDraftWrites?.length ?? 0) > 0,
        undefined,
        { timeout: SAVE_TIMEOUT_MS },
      );
      expect(await heldDraftWriteCount(page)).toBeGreaterThan(0);
      expect(await leavePrompted(page), 'the draft write is pending').toBe(
        true,
      );
      await releaseDraftWrites(page);
      await waitForLeavePrompt(page, false);
    } catch (error) {
      await writeAgentFailureArtifact(page, 'editor-drafts').catch(() => {});
      throw error;
    } finally {
      await closeQuietly(ctx, browser);
    }
  },
  { timeout: 240_000 },
);
