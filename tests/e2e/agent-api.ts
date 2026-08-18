/**
 * Thin Playwright wrapper around `window.__stims_agent` (see
 * docs/agents/browser-automation.md and src/js/frontend/agent-state.ts).
 *
 * Purpose: give e2e suites the same ergonomics an in-browser agent gets —
 * `waitFor`/`run`/`getState`/`getEvents`/`captureStats` — without repeating
 * `page.evaluate(() => window.__stims_agent...)` boilerplate at every call
 * site, and without inventing new semantics: every export here mirrors an
 * AgentGlobal method 1:1 (see AgentGlobal in src/js/frontend/agent-state.ts).
 *
 * Typed predicates over string-eval:
 * `AgentGlobal.waitFor` takes a real predicate function `(state) => boolean`
 * that runs inside the page. `page.evaluate` cannot serialize a closure
 * across the isolated-world boundary, so a generic passthrough would have to
 * ship the predicate as a stringified function body and `eval` it in-page —
 * that loses type-checking at the call site, is fragile to refactors (a
 * typo in a field name is a runtime string, not a compile error), and is an
 * unnecessary in-page eval for something a handful of named helpers cover.
 * Instead this module exports small typed predicate builders
 * (`engineReady`, `engineLive`, `presetIs`, `backendIs`, ...) that each
 * return a `(state) => boolean` closure understood by
 * `page.evaluate`'s *outer* call (the closure runs host-side against a
 * plain JSON snapshot fetched via `getState`), plus a raw
 * `waitForAgentState` escape hatch for one-off predicates that takes a
 * real TypeScript function (still executed host-side, still fully typed —
 * no page-side eval at all). This keeps every predicate type-checked and
 * readable at the call site, matching the task's guidance to prefer typed
 * helpers over raw predicate strings.
 *
 * Design note on where the predicate runs: `page.evaluate(fn)` ships `fn`
 * into the page by serializing its *source text* and re-evaluating it
 * there — any variable the closure captures from outer (Node) scope is not
 * part of that source text and becomes a `ReferenceError` in the page
 * (Playwright only bridges values passed explicitly as the second
 * argument, not the closure environment). `agentPredicates.presetIs(id)`
 * etc. close over their argument, so they cannot be shipped as page-side
 * closures without falling back to the exact stringify-and-eval pattern
 * this module is trying to avoid. Instead `waitForAgentState` evaluates
 * the predicate host-side (in Node/Bun), against snapshots pulled back via
 * `getAgentState`, and polls at a short fixed interval. This is a plain
 * Playwright poll rather than the in-page `waitFor`'s push-on-commit
 * wake-up, but it keeps every predicate a real, fully-typed TypeScript
 * function with no in-page eval anywhere in this module.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { FrameStats } from '../../src/js/core/services/visual-embedding.ts';
import type {
  AgentEvent,
  AgentEventType,
  AgentRunResult,
  AgentStateSnapshot,
} from '../../src/js/frontend/agent-state.ts';

const NOT_INSTALLED_ERROR =
  'window.__stims_agent is not installed yet (page not loaded, or app has not booted). ' +
  'Wait for #stims-main / body[data-engine-state] before calling agent-api helpers.';

export class AgentNotInstalledError extends Error {
  constructor(context: string) {
    super(`${NOT_INSTALLED_ERROR} (while calling ${context})`);
    this.name = 'AgentNotInstalledError';
  }
}

/** True once `window.__stims_agent` exists in the page. */
export async function hasAgentGlobal(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof window.__stims_agent !== 'undefined');
}

async function assertInstalled(page: Page, context: string): Promise<void> {
  if (!(await hasAgentGlobal(page))) {
    throw new AgentNotInstalledError(context);
  }
}

/** Mirrors `AgentGlobal.getState()`. */
export async function getAgentState(page: Page): Promise<AgentStateSnapshot> {
  await assertInstalled(page, 'getAgentState');
  // biome-ignore lint/style/noNonNullAssertion: assertInstalled above confirmed window.__stims_agent exists
  return page.evaluate(() => window.__stims_agent!.getState());
}

/** Mirrors `AgentGlobal.getEvents(sinceSeq)`. */
export async function getAgentEvents(
  page: Page,
  sinceSeq = 0,
): Promise<AgentEvent[]> {
  await assertInstalled(page, 'getAgentEvents');
  return page.evaluate(
    // biome-ignore lint/style/noNonNullAssertion: assertInstalled above confirmed window.__stims_agent exists
    (seq) => window.__stims_agent!.getEvents(seq),
    sinceSeq,
  );
}

/** Mirrors `AgentGlobal.run(actionId, params)`. */
export async function runAgentAction(
  page: Page,
  actionId: string,
  params?: Record<string, unknown>,
): Promise<AgentRunResult> {
  await assertInstalled(page, `runAgentAction(${actionId})`);
  return page.evaluate(
    // biome-ignore lint/style/noNonNullAssertion: assertInstalled above confirmed window.__stims_agent exists
    ({ actionId, params }) => window.__stims_agent!.run(actionId, params),
    { actionId, params },
  );
}

/** Mirrors `AgentGlobal.listActions()`. */
export async function listAgentActions(
  page: Page,
): Promise<Array<{ id: string; label: string }>> {
  await assertInstalled(page, 'listAgentActions');
  // biome-ignore lint/style/noNonNullAssertion: assertInstalled above confirmed window.__stims_agent exists
  return page.evaluate(() => window.__stims_agent!.listActions());
}

/** Mirrors `AgentGlobal.captureStats()`. */
export async function captureAgentStats(
  page: Page,
): Promise<FrameStats | null> {
  await assertInstalled(page, 'captureAgentStats');
  // biome-ignore lint/style/noNonNullAssertion: assertInstalled above confirmed window.__stims_agent exists
  return page.evaluate(() => window.__stims_agent!.captureStats());
}

/**
 * Named, typed predicate builders for `waitForAgentState`. Each returns a
 * plain `(state: AgentStateSnapshot) => boolean` — no page-side eval, fully
 * typed at the call site. Add more here as call sites need them rather than
 * reaching for a raw predicate.
 */
export const agentPredicates = {
  engineReady: (): ((s: AgentStateSnapshot) => boolean) => (s) =>
    s.engineState === 'ready' || s.engineState === 'live',
  engineLive: (): ((s: AgentStateSnapshot) => boolean) => (s) =>
    s.engineState === 'live',
  presetIs:
    (presetId: string): ((s: AgentStateSnapshot) => boolean) =>
    (s) =>
      s.presetId === presetId,
  backendIs:
    (backend: string): ((s: AgentStateSnapshot) => boolean) =>
    (s) =>
      s.backend === backend,
  hasError: (): ((s: AgentStateSnapshot) => boolean) => (s) =>
    s.lastError !== null,
};

const POLL_INTERVAL_MS = 100;

/**
 * Waits for `predicate(getState())` to hold, polling `getState()` at a
 * short fixed interval (see the design note at the top of this file for why
 * the predicate runs host-side rather than being shipped in-page).
 * `predicate` is a real host-side function — build one with
 * `agentPredicates` for the common cases, or pass a one-off inline arrow
 * for anything not covered there.
 *
 * Rejects on timeout, and rejects with `AgentNotInstalledError` if the
 * agent global never appears within the timeout.
 */
export async function waitForAgentState(
  page: Page,
  predicate: (state: AgentStateSnapshot) => boolean,
  timeoutMs = 5000,
): Promise<AgentStateSnapshot> {
  const deadline = Date.now() + timeoutMs;
  // The agent global installs at App mount, which can lag page navigation.
  while (!(await hasAgentGlobal(page))) {
    if (Date.now() >= deadline) {
      throw new AgentNotInstalledError('waitForAgentState');
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  let state = await getAgentState(page);
  while (!predicate(state)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForAgentState timed out after ${timeoutMs}ms (last state: ${JSON.stringify(state)})`,
      );
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
    state = await getAgentState(page);
  }
  return state;
}

export interface AgentDiagnostics {
  state: AgentStateSnapshot | null;
  events: AgentEvent[];
  stats: FrameStats | null;
  installed: boolean;
}

/**
 * Convenience bundle for failure artifacts: state + full retained event
 * log + one on-demand pixel-stats capture. Never throws — each piece is
 * best-effort so a partially-booted page still yields a partial dump
 * instead of masking the original test failure with a dump failure.
 */
export async function dumpAgentDiagnostics(
  page: Page,
): Promise<AgentDiagnostics> {
  const installed = await hasAgentGlobal(page).catch(() => false);
  if (!installed) {
    return { state: null, events: [], stats: null, installed: false };
  }
  const [state, events, stats] = await Promise.all([
    getAgentState(page).catch(() => null),
    getAgentEvents(page, 0).catch(() => []),
    captureAgentStats(page).catch(() => null),
  ]);
  return { state, events, stats, installed: true };
}

/** Filter helper for reading a dump's event log by type — pure convenience. */
export function eventsOfType(
  events: AgentEvent[],
  type: AgentEventType,
): AgentEvent[] {
  return events.filter((e) => e.type === type);
}

const FAILURE_ARTIFACT_ROOT = path.join(
  process.cwd(),
  'test-results',
  'e2e-failures',
);

function sanitizeForPath(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-');
}

export interface FailureArtifactResult {
  dir: string;
  diagnosticsPath: string;
  screenshotPath: string | null;
}

/**
 * Failure-artifact dump for e2e suites: writes `dumpAgentDiagnostics(page)`
 * plus a full-page screenshot under
 * `test-results/e2e-failures/<test-name>-<timestamp>/`, creating the
 * directory if needed. Intended for a `catch` block that runs before the
 * suite's existing `finally` teardown (browser/context close) — call this,
 * then rethrow the original error.
 *
 * Best-effort by design: every step is wrapped so a dump failure (disk full,
 * page already closed, agent global never installed) can never mask or
 * replace the original test failure that triggered the dump. Returns `null`
 * when nothing could be captured (e.g. the page never got far enough to
 * install `window.__stims_agent` — that case is expected pre-boot and is
 * not itself an error, so this silently no-ops rather than throwing).
 */
export async function writeAgentFailureArtifact(
  page: Page,
  testName: string,
): Promise<FailureArtifactResult | null> {
  try {
    const installed = await hasAgentGlobal(page).catch(() => false);
    if (!installed) {
      // Pre-boot failure (e.g. the page never reached App mount) — nothing
      // agent-shaped to dump. Skip silently rather than writing an
      // all-null diagnostics file.
      return null;
    }

    const dir = path.join(
      FAILURE_ARTIFACT_ROOT,
      `${sanitizeForPath(testName)}-${Date.now()}`,
    );
    fs.mkdirSync(dir, { recursive: true });

    const diagnostics: AgentDiagnostics = await dumpAgentDiagnostics(
      page,
    ).catch(
      () =>
        ({
          state: null,
          events: [],
          stats: null,
          installed: true,
        }) satisfies AgentDiagnostics,
    );

    const diagnosticsPath = path.join(dir, 'diagnostics.json');
    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2));

    let screenshotPath: string | null = null;
    try {
      const candidate = path.join(dir, 'screenshot.png');
      await page.screenshot({ path: candidate });
      screenshotPath = candidate;
    } catch {
      // Page may already be mid-teardown or the backend (WebGPU) canvas may
      // not be screenshot-able in this state — diagnostics.json still lands.
    }

    return { dir, diagnosticsPath, screenshotPath };
  } catch {
    // Never let a failed dump mask the real test failure.
    return null;
  }
}
