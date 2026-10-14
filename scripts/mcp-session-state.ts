/**
 * What the MCP session tools (session_get_state, session_watch,
 * session_describe_frame) report about the visualizer page they drive.
 *
 * Read from `window.__stims_agent.getState()`, the agent API every mode
 * installs (docs/agents/browser-automation.md), not from the DOM. These tools
 * used to read the preset name from `.milkdrop-overlay__osd-*` elements, which
 * stopped rendering when the imperative overlay was removed (427ca65c), so
 * every call reported a null title and nothing failed.
 *
 * Opening a session and switching its preset wait on the same API. They used
 * to click a "See visuals now" button that no longer renders and then sleep a
 * fixed 4s, so a slow mount returned "ready" before anything was on stage and
 * a fast one paid the whole sleep anyway.
 */
import type { Page } from 'playwright';
import type { AgentStateSnapshot } from '../src/js/frontend/agent-state.ts';

/**
 * Budget for a session's first preset to reach the stage, page load included.
 * A deep link stages the first-run preset, starts demo audio, waits for the
 * catalog and only then swaps in the requested preset; on a loaded machine
 * that took 23–54s, so this leaves headroom rather than describing a normal
 * open.
 */
export const SESSION_OPEN_TIMEOUT_MS = 90_000;

export interface SessionPageState {
  /** False until the app has mounted and installed `__stims_agent`. */
  agentInstalled: boolean;
  engineState: AgentStateSnapshot['engineState'] | null;
  presetId: string | null;
  presetTitle: string | null;
  presetAuthor: string | null;
  backend: string | null;
  fps: number | null;
  shaderExecution: AgentStateSnapshot['shaderExecution'];
  appliedShaderExecution: AgentStateSnapshot['appliedShaderExecution'];
  audioActive: string;
  audioSource: string | null;
  audioEnergy: number | null;
  lastError: string | null;
  page: string | null;
  canvasExists: boolean;
  canvasWidth: number | null;
  canvasHeight: number | null;
  url: string;
}

/**
 * Runs inside the page, as `page.evaluate(readSessionPageState)`. Playwright
 * ships the function's source text, so it must not reference anything else in
 * this module.
 */
export function readSessionPageState(): SessionPageState {
  const state = window.__stims_agent?.getState() ?? null;
  const dataset = document.body.dataset;
  const canvas = document.querySelector('canvas');
  const energy = state?.audioEnergy ?? null;
  return {
    agentInstalled: state !== null,
    engineState: state?.engineState ?? null,
    presetId: state?.presetId ?? null,
    presetTitle: state?.presetTitle ?? null,
    presetAuthor: state?.presetAuthor ?? null,
    backend: state?.backend ?? dataset.activeBackend ?? null,
    fps: state?.fps ?? null,
    shaderExecution: state?.shaderExecution ?? null,
    appliedShaderExecution: state?.appliedShaderExecution ?? null,
    audioActive: dataset.audioActive ?? 'false',
    audioSource: state?.audioSource ?? null,
    audioEnergy: energy === null ? null : Math.round(energy * 100) / 100,
    lastError: state?.lastError ?? null,
    page: dataset.page ?? null,
    canvasExists: canvas !== null,
    canvasWidth: canvas?.width ?? null,
    canvasHeight: canvas?.height ?? null,
    url: window.location.href,
  };
}

/**
 * The URL that puts `presetId` on stage. A `?preset=` deep link mounts the
 * engine and starts demo audio on its own (NewHomePage.tsx), so nothing has
 * to be clicked. `params` adds query parameters such as `renderer`.
 */
export function sessionPresetUrl(
  origin: string,
  presetId: string,
  params: Record<string, string> = {},
): string {
  const url = new URL('/', origin);
  url.searchParams.set('agent', 'true');
  url.searchParams.set('preset', presetId);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Resolves once the agent API reports `presetId` on stage with its catalog
 * title, and returns what session_get_state would report. It matches the id,
 * not just any preset: a deep link puts the first-run preset on stage before
 * the requested one. A timeout rejects with the agent's own message, which
 * names the preset that is on stage instead.
 */
export async function waitForSessionPreset(
  page: Page,
  presetId: string,
  timeoutMs: number,
): Promise<SessionPageState> {
  const deadline = Date.now() + timeoutMs;
  // The global installs when the app mounts, which trails the document load.
  await page.waitForFunction(
    () => window.__stims_agent !== undefined,
    undefined,
    { timeout: timeoutMs },
  );
  await page.evaluate(
    async ({ presetId, timeoutMs }) => {
      const agent = window.__stims_agent;
      if (!agent) throw new Error('window.__stims_agent is not installed.');
      await agent.waitFor(
        (s) => s.presetId === presetId && s.presetTitle !== null,
        timeoutMs,
      );
    },
    { presetId, timeoutMs: Math.max(deadline - Date.now(), 1) },
  );
  return page.evaluate(readSessionPageState);
}

/** Loads the visualizer with `presetId` and waits for it to reach the stage. */
export async function openSessionPreset(
  page: Page,
  origin: string,
  presetId: string,
  {
    params,
    timeoutMs = SESSION_OPEN_TIMEOUT_MS,
  }: { params?: Record<string, string>; timeoutMs?: number } = {},
): Promise<SessionPageState> {
  const deadline = Date.now() + timeoutMs;
  await page.goto(sessionPresetUrl(origin, presetId, params), {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  return waitForSessionPreset(
    page,
    presetId,
    Math.max(deadline - Date.now(), 1),
  );
}

/**
 * Plays `presetId` in an open session with the agent's `select-preset` verb
 * and waits for it to reach the stage. No reload, so what the session has set
 * up in the page (a Strudel pattern, modulators, MIDI bindings) keeps running
 * across the switch. Rejects with the verb's error for an id the catalog does
 * not have.
 */
export async function switchSessionPreset(
  page: Page,
  presetId: string,
  timeoutMs: number,
): Promise<SessionPageState> {
  const deadline = Date.now() + timeoutMs;
  const result = await page.evaluate(
    async ({ presetId, timeoutMs }) => {
      const agent = window.__stims_agent;
      if (!agent) {
        return {
          ok: false,
          error:
            'window.__stims_agent is not installed: the session page has not mounted the app.',
        };
      }
      // select-preset rejects every id until the deferred catalog load lands.
      await agent.waitFor((s) => s.catalogSize > 0, timeoutMs);
      return agent.run('select-preset', { id: presetId });
    },
    { presetId, timeoutMs },
  );
  if (!result.ok) {
    throw new Error(result.error ?? `select-preset "${presetId}" failed.`);
  }
  return waitForSessionPreset(
    page,
    presetId,
    Math.max(deadline - Date.now(), 1),
  );
}
