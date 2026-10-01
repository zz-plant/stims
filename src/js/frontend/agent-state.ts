/**
 * Machine-readable app state for automation (agents, e2e, MCP sessions).
 *
 * Design, learned by driving the app as an agent:
 * - Feedback is transient (toasts evaporate) → status ring buffer + typed
 *   event log with sequence numbers, so effects are verifiable after the
 *   fact and causality is assertable ("my action produced these events").
 * - State reads in the same tick as an action are stale (React commit lag)
 *   → run() resolves after the next post-commit notification, and
 *   waitFor(predicate) replaces sleep-and-repoll loops entirely.
 * - Labels change; ids don't → run(id, params) executes command-palette
 *   actions plus targeted verbs (select-preset, set-field) by stable id.
 * - "Is anything actually rendering?" needs pixels → captureStats() reuses
 *   the visual-search frame-stats readback (on demand only: reading back a
 *   WebGPU canvas can stall the main thread — never call it per-frame).
 *
 * Installed as `window.__stims_agent` by App in all modes. The
 * `data-engine-state` attribute on <body> ('booting' | 'ready' | 'live')
 * is the selector-waitable companion, also owned by App.
 * Full usage guide: docs/agents/browser-automation.md.
 */

import { isHiddenTabSuspendingFrames } from '../core/hidden-tab-policy.ts';
import {
  extractFrameStats,
  type FrameStats,
} from '../core/services/visual-embedding.ts';
import type { MilkdropShaderExecutionMode } from '../milkdrop/shader-execution-mode.ts';
import { subscribeVariables } from '../milkdrop/variable-probe.ts';
import type { AgentTelemetry } from './agent-bridge.ts';
import type { CommandAction } from './command-palette-registry.ts';

const STATUS_LOG_LIMIT = 20;
const EVENT_LOG_LIMIT = 100;
// How long run() waits for a post-commit notification before reporting
// settled:false. Most actions (panel toggles, transitions, preset selection)
// commit well under 100ms — 1s is slack for a slow panel chunk download or a
// preset compile, not a number tuned against a measured p99. A false
// settled:false here just means the caller re-checks getState() themselves;
// it does not mean the action failed, so this errs toward "generous enough
// to rarely matter" rather than "tight enough to catch every straggler".
const RUN_SETTLE_TIMEOUT_MS = 1000;
// Default budget for waitFor(predicate). Generous relative to
// RUN_SETTLE_TIMEOUT_MS on purpose: a caller waiting on a specific predicate
// (e.g. "audio is live") may legitimately be waiting through several
// discrete state transitions, not one commit — a boot sequence or a preset
// switch under load can take longer than 1s while still being correct.
const DEFAULT_WAIT_TIMEOUT_MS = 5000;

export interface AgentStatusEntry {
  at: number;
  message: string;
}

export type AgentEventType =
  | 'status'
  | 'error'
  | 'engine-state'
  | 'preset'
  | 'panel'
  | 'audio-source'
  | 'playback'
  | 'transition'
  | 'autoplay'
  | 'backend'
  | 'shader-execution';

export interface AgentEvent {
  seq: number;
  at: number;
  type: AgentEventType;
  data: Record<string, unknown>;
}

export interface AgentCoreSnapshot {
  engineState: 'booting' | 'ready' | 'live';
  engineReady: boolean;
  liveMode: boolean;
  backend: string | null;
  panel: string | null;
  presetId: string | null;
  presetTitle: string | null;
  /** Catalog entries the shell can pick from. 0 until the deferred catalog
   * load lands, which is later than `engineState === 'ready'`; actions that
   * choose a preset (`next-preset`, collection shuffles) are no-ops before
   * then, so wait for this rather than for readiness alone. */
  catalogSize: number;
  audioSource: string | null;
  /** Stage held at the user's request (Space / dock pause). */
  playbackPaused: boolean;
  audioEnergy: number | null;
  autoplay: boolean | null;
  transition: { mode: string | null; blendDuration: number | null };
  /**
   * Whether the live preset's shader text is executing as authored on the
   * active backend, or being approximated:
   *   'direct'      — running as authored.
   *   'none'        — the preset has no shader text; nothing to approximate.
   *   'translated'  — the shader text does not run on this backend; the
   *                   renderer is substituting its uniform-only controls
   *                   approximation. The picture is plausible but wrong.
   *   'unsupported' — the shader text is outside the supported subset; also
   *                   approximated.
   *   null          — no preset compiled yet. Never read null as "fine".
   * Assert `shaderExecution === 'direct'` (or `'none'`) to require that what
   * is on screen is what the preset author wrote.
   */
  shaderExecution: MilkdropShaderExecutionMode | null;
}

export interface AgentStateSnapshot extends AgentCoreSnapshot {
  fps: number | null;
  quality: AgentTelemetry['quality'];
  lastError: string | null;
  statusLog: AgentStatusEntry[];
  /** `document.hidden` right now. */
  documentHidden: boolean;
  /** The page was loaded with `?agent=true`. */
  agentMode: boolean;
  /**
   * The frame loop is skipping frames because this tab is hidden. A hidden tab
   * loaded without `?agent=true` renders nothing and shows a black canvas with
   * no error, which reads as a shader failure: check this before diagnosing
   * one. Computed by the same rule the frame loop acts on
   * (core/hidden-tab-policy.ts), so the two cannot disagree.
   */
  renderingSuspended: boolean;
}

const statusLog: AgentStatusEntry[] = [];
const events: AgentEvent[] = [];
let eventSeq = 0;
let lastErrorMessage: string | null = null;
const commitListeners = new Set<() => void>();
let lastCore: AgentCoreSnapshot | null = null;

/**
 * Table-driven commit diff, coupled to AgentCoreSnapshot's own field list by
 * a paired test (tests/unit/agent-state-core-diff.test.ts) the same way
 * workspace-context.tsx's coarseEngineSnapshotEqual is coupled to
 * EngineSnapshot's fields — that test enumerates every AgentCoreSnapshot key
 * and requires it to be either covered by a descriptor's `fields` list here
 * or listed in CORE_SNAPSHOT_INTENTIONALLY_SKIPPED with a reason, so a field
 * added to AgentCoreSnapshot but forgotten here fails a test instead of
 * silently going unobserved in getEvents().
 */
type CoreDiffDescriptor = {
  fields: ReadonlyArray<keyof AgentCoreSnapshot>;
  changed: (prev: AgentCoreSnapshot, next: AgentCoreSnapshot) => boolean;
  event: (
    prev: AgentCoreSnapshot,
    next: AgentCoreSnapshot,
  ) => { type: AgentEventType; data: Record<string, unknown> };
};

export const CORE_SNAPSHOT_DIFF_DESCRIPTORS: readonly CoreDiffDescriptor[] = [
  {
    fields: ['engineState'],
    changed: (p, n) => p.engineState !== n.engineState,
    event: (p, n) => ({
      type: 'engine-state',
      data: { from: p.engineState, to: n.engineState },
    }),
  },
  {
    // presetTitle is bundled into the same event as presetId (it's the
    // human-readable name of whatever preset just became active), but is
    // also checked alone in case a title correction ever lands without an
    // id change.
    fields: ['presetId', 'presetTitle'],
    changed: (p, n) =>
      p.presetId !== n.presetId || p.presetTitle !== n.presetTitle,
    event: (p, n) => ({
      type: 'preset',
      data: { from: p.presetId, to: n.presetId, title: n.presetTitle },
    }),
  },
  {
    fields: ['panel'],
    changed: (p, n) => p.panel !== n.panel,
    event: (p, n) => ({ type: 'panel', data: { from: p.panel, to: n.panel } }),
  },
  {
    fields: ['audioSource'],
    changed: (p, n) => p.audioSource !== n.audioSource,
    event: (p, n) => ({
      type: 'audio-source',
      data: { from: p.audioSource, to: n.audioSource },
    }),
  },
  {
    fields: ['playbackPaused'],
    changed: (p, n) => p.playbackPaused !== n.playbackPaused,
    event: (_p, n) => ({
      type: 'playback',
      data: { paused: n.playbackPaused },
    }),
  },
  {
    fields: ['transition'],
    changed: (p, n) =>
      p.transition.mode !== n.transition.mode ||
      p.transition.blendDuration !== n.transition.blendDuration,
    event: (_p, n) => ({ type: 'transition', data: { ...n.transition } }),
  },
  {
    fields: ['autoplay'],
    changed: (p, n) => p.autoplay !== n.autoplay,
    event: (_p, n) => ({ type: 'autoplay', data: { enabled: n.autoplay } }),
  },
  {
    fields: ['backend'],
    changed: (p, n) => p.backend !== n.backend,
    event: (p, n) => ({
      type: 'backend',
      data: { from: p.backend, to: n.backend },
    }),
  },
  {
    // Its own event rather than a field on the 'preset' one: this changes on
    // two independent axes. Loading a preset changes it, but so does a
    // backend fallback with the preset held still — and that second case is
    // precisely the silent degradation this field exists to expose, so it
    // must not be reachable only via a preset event that never fires.
    fields: ['shaderExecution'],
    changed: (p, n) => p.shaderExecution !== n.shaderExecution,
    event: (p, n) => ({
      type: 'shader-execution',
      data: {
        from: p.shaderExecution,
        to: n.shaderExecution,
        backend: n.backend,
        presetId: n.presetId,
        approximated:
          n.shaderExecution === 'translated' ||
          n.shaderExecution === 'unsupported',
      },
    }),
  },
];

// Fields deliberately not diffed into events, each with a reason:
export const CORE_SNAPSHOT_INTENTIONALLY_SKIPPED: ReadonlySet<
  keyof AgentCoreSnapshot
> = new Set([
  // Per-frame churn while audio plays; an event per frame would flood the
  // (bounded) log within seconds. Read live via getState().audioEnergy.
  'audioEnergy',
  // Derived into engineState: booting->ready and ready->live are both
  // engineState transitions, already emitted as 'engine-state' events.
  'engineReady',
  'liveMode',
  // Grows once, when the deferred catalog load lands; that load is a
  // readiness fact, not a transition worth an event. Automation waits on
  // getState().catalogSize instead.
  'catalogSize',
] as const);

function pushEvent(type: AgentEventType, data: Record<string, unknown>): void {
  eventSeq += 1;
  events.push({ seq: eventSeq, at: Date.now(), type, data });
  if (events.length > EVENT_LOG_LIMIT) {
    events.splice(0, events.length - EVENT_LOG_LIMIT);
  }
}

/** Called by the workspace status setter; null (clearing) is not logged. */
export function recordStatusMessage(message: string | null): void {
  if (!message) return;
  statusLog.push({ at: Date.now(), message });
  if (statusLog.length > STATUS_LOG_LIMIT) {
    statusLog.splice(0, statusLog.length - STATUS_LOG_LIMIT);
  }
  pushEvent('status', { message });
}

export function getStatusLog(): AgentStatusEntry[] {
  return [...statusLog];
}

/**
 * Called by App from a post-commit effect whenever any snapshot-relevant
 * value changes. Diffs against the previous core snapshot into typed
 * events, then wakes run()/waitFor() waiters — so a resolved waiter is
 * guaranteed to observe the committed state.
 */
export function emitAgentCommit(core: AgentCoreSnapshot): void {
  const prev = lastCore;
  lastCore = core;
  if (prev) {
    for (const descriptor of CORE_SNAPSHOT_DIFF_DESCRIPTORS) {
      if (descriptor.changed(prev, core)) {
        const { type, data } = descriptor.event(prev, core);
        pushEvent(type, data);
      }
    }
  }
  for (const listener of [...commitListeners]) {
    listener();
  }
}

/** Test-only: clears the module-level log/commit state between test cases. */
export function resetAgentStateForTests(): void {
  statusLog.length = 0;
  events.length = 0;
  eventSeq = 0;
  lastErrorMessage = null;
  lastCore = null;
  commitListeners.clear();
}

export function getAgentEventsForTests(): readonly AgentEvent[] {
  return [...events];
}

function nextCommit(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = () => {
      commitListeners.delete(listener);
      window.clearTimeout(timer);
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      commitListeners.delete(listener);
      resolve(false);
    }, timeoutMs);
    commitListeners.add(listener);
  });
}

/**
 * Resolves with the first committed core snapshot that satisfies `predicate`
 * (the latest commit, if it already does), or null after `timeoutMs`. The
 * in-app counterpart of `waitFor`, for code that must report an outcome only
 * once React has committed it.
 */
export function waitForCommittedCore(
  predicate: (core: AgentCoreSnapshot) => boolean,
  timeoutMs: number,
): Promise<AgentCoreSnapshot | null> {
  return new Promise((resolve) => {
    const listener = () => {
      const core = lastCore;
      if (!core || !predicate(core)) return;
      commitListeners.delete(listener);
      window.clearTimeout(timer);
      resolve(core);
    };
    const timer = window.setTimeout(() => {
      commitListeners.delete(listener);
      resolve(null);
    }, timeoutMs);
    commitListeners.add(listener);
    listener();
  });
}

export interface AgentRunResult {
  ok: boolean;
  /** True when a state commit was observed after the action; false means
   * the action ran but produced no snapshot change within the settle
   * window (normal for e.g. share-link). */
  settled?: boolean;
  error?: string;
  /** Close matches when `error` is an unknown action or preset id. */
  suggestions?: string[];
  /**
   * The typed events recorded between the call and the settle (present on
   * `ok: true`). A commit's events are pushed before the listener that settles
   * `run()` fires, so this is what the action changed: `run('next-preset')`
   * returns the `preset` event with the new id. It can also include an
   * unrelated change that landed in the same window; empty means the action
   * changed nothing observable.
   */
  events?: AgentEvent[];
}

/** One entry of `listActions()`. Targeted verbs carry `params`. */
export interface AgentActionInfo {
  id: string;
  label: string;
  /** Parameter name -> type and meaning; present only on targeted verbs. */
  params?: Record<string, string>;
}

/**
 * Targeted verbs `run()` accepts beyond the command palette. Listed here, next
 * to the code that executes them, so `listActions()` can advertise them with
 * their parameters instead of leaving them discoverable only through an error
 * message.
 */
export const AGENT_VERBS: readonly AgentActionInfo[] = [
  {
    id: 'select-preset',
    label: 'Play a specific catalog preset',
    params: {
      id: 'string: a catalog preset id (legacy aliases resolve). Requires catalogSize > 0.',
    },
  },
  {
    id: 'set-field',
    label: 'Live-set a preset variable without recompiling',
    params: {
      key: 'string: a built-in, q1-q32 or user variable name. Not validated against the preset: ok means it was written, not that the preset reads it.',
      value: 'number (finite). Requires engineReady.',
    },
  },
  {
    id: 'crossfade',
    label: 'Move a hand-driven crossfade',
    params: { position: 'number: 0 (outgoing) to 1 (incoming)' },
  },
  {
    id: 'pin-parameter',
    label: 'Pin a parameter on the performance surface',
    params: { field: 'string: a pinnable parameter name' },
  },
  {
    id: 'unpin-parameter',
    label: 'Unpin a parameter from the performance surface',
    params: { field: 'string: a pinnable parameter name' },
  },
];

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * Close matches for a mistyped id, best first. A typo (`nxt-preset`) or a
 * partial (`next`) should point at the real id, so an agent fixes it in one
 * step instead of listing 46 actions and scanning them.
 */
export function suggestIds(
  input: string,
  candidates: readonly string[],
  { limit = 3, maxDistance }: { limit?: number; maxDistance?: number } = {},
): string[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const id of candidates) {
    const candidate = id.toLowerCase();
    const distance = editDistance(needle, candidate);
    const allowed =
      maxDistance ?? Math.max(2, Math.floor(candidate.length / 3));
    const contains =
      needle.length >= 3 &&
      (candidate.includes(needle) || needle.includes(candidate));
    if (distance <= allowed || contains) {
      scored.push({ id, score: contains ? Math.min(distance, 1) : distance });
    }
  }
  return scored
    .sort((x, y) => x.score - y.score || x.id.localeCompare(y.id))
    .slice(0, limit)
    .map((entry) => entry.id);
}

/**
 * One line of state for an error message. A `waitFor` that times out is
 * usually followed by a `getState()` to find out why; putting the answer in the
 * error saves that round trip.
 */
export function describeAgentState(state: AgentStateSnapshot): string {
  const fields: Array<[string, unknown]> = [
    ['engineState', state.engineState],
    ['presetId', state.presetId],
    ['catalogSize', state.catalogSize],
    ['backend', state.backend],
    ['panel', state.panel],
    ['audioSource', state.audioSource],
    ['fps', state.fps],
    ['renderingSuspended', state.renderingSuspended],
    ['lastError', state.lastError],
  ];
  return fields
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
}

export interface AgentGlobal {
  getState: () => AgentStateSnapshot;
  /** Typed events since a sequence number (0 = all retained). */
  getEvents: (sinceSeq?: number) => AgentEvent[];
  /**
   * Run a command-palette action — or a targeted verb — by stable id.
   * Targeted verbs: 'select-preset' {id}, 'set-field' {key, value},
   * 'crossfade' {position}, 'pin-parameter' {field},
   * 'unpin-parameter' {field}.
   * Resolves after the next state commit (or a 1s settle window).
   */
  run: (
    actionId: string,
    params?: Record<string, unknown>,
  ) => Promise<AgentRunResult>;
  /**
   * Palette actions (id and label) followed by the targeted verbs, which also
   * carry `params`.
   */
  listActions: () => AgentActionInfo[];
  /** Resolve when predicate(getState()) is true; reject on timeout. */
  waitFor: (
    predicate: (state: AgentStateSnapshot) => boolean,
    timeoutMs?: number,
  ) => Promise<AgentStateSnapshot>;
  /**
   * Luminance/coverage/motion stats from the live stage canvas, via the
   * visual-search readback. On demand only — WebGPU readback can stall.
   */
  /**
   * Resolves inside a frame callback: a WebGPU canvas only holds its image
   * until the presenting task ends, so a synchronous read composites
   * transparent and every stat comes back zero on the default backend.
   */
  captureStats: () => Promise<FrameStats | null>;
  /**
   * The preset's equation variables (q1–q32, zoom, rot, anything the
   * per-frame code assigns) as of the next rendered frame; null if no frame
   * arrives within `timeoutMs` (engine not live, or the tab is hidden and
   * `?agent=true` is missing). Same feed as the editor's Inspect tab.
   */
  getVariables: (timeoutMs?: number) => Promise<Record<string, number> | null>;
  /**
   * Resolve with the variables of the first frame for which
   * `predicate(vars)` is true; reject on timeout. The replacement for
   * sleep-and-poll on "wait until q1 goes above 0.5 on the beat".
   */
  waitForVariables: (
    predicate: (variables: Readonly<Record<string, number>>) => boolean,
    timeoutMs?: number,
  ) => Promise<Record<string, number>>;
}

declare global {
  interface Window {
    __stims_agent?: AgentGlobal;
  }
}

export interface AgentStateProviders {
  getSnapshot: () => AgentCoreSnapshot;
  getActions: () => CommandAction[];
  getTelemetry: () => AgentTelemetry;
  selectPreset: (presetId: string) => void;
  /**
   * Resolve a requested id the way the route does (aliases, slugs). `null`
   * when nothing in the loaded catalog matches.
   */
  resolvePresetId: (candidate: string) => string | null;
  /** Ids in the loaded catalog, for did-you-mean suggestions. */
  getPresetIds: () => readonly string[];
  setField: (key: string, value: number) => void;
  /** Moves a hand-driven crossfade, 0 (outgoing) to 1 (incoming). */
  setCrossfade: (position: number) => void;
  /** Pin/unpin a parameter on the performance surface. Returns false for a
   * field the surface has no range for. */
  pinParameter: (field: string) => boolean;
  unpinParameter: (field: string) => boolean;
  getStageCanvas: () => HTMLCanvasElement | null;
}

/**
 * Install `window.__stims_agent`. Providers read from refs so the global
 * never goes stale and installs exactly once. Returns a cleanup.
 */
export function installAgentStateGlobal(
  providers: AgentStateProviders,
): () => void {
  const buildState = (): AgentStateSnapshot => {
    const telemetry = providers.getTelemetry();
    return {
      ...providers.getSnapshot(),
      fps: telemetry.fps || null,
      quality: telemetry.quality,
      lastError: lastErrorMessage,
      statusLog: getStatusLog(),
      documentHidden: typeof document !== 'undefined' && document.hidden,
      agentMode:
        typeof document !== 'undefined' &&
        document.documentElement.dataset.agentMode === 'true',
      renderingSuspended: isHiddenTabSuspendingFrames(),
    };
  };

  const runAction = (
    actionId: string,
    params?: Record<string, unknown>,
  ): AgentRunResult | null => {
    if (actionId === 'select-preset') {
      const id = params?.id;
      if (typeof id !== 'string' || !id) {
        return {
          ok: false,
          error: 'select-preset requires params.id (string).',
        };
      }
      // The route accepts any string and the shell quietly ignores an id it
      // cannot resolve, so without this check a typo or a call made before the
      // catalog loads came back ok:true with the preset unchanged.
      const { catalogSize } = providers.getSnapshot();
      if (catalogSize === 0) {
        return {
          ok: false,
          error:
            'select-preset cannot run yet: the preset catalog has not loaded (catalogSize is 0). Call waitFor((s) => s.catalogSize > 0) first.',
        };
      }
      const resolved = providers.resolvePresetId(id);
      if (!resolved) {
        const suggestions = suggestIds(id, providers.getPresetIds(), {
          maxDistance: 4,
        });
        return {
          ok: false,
          error: `select-preset: no preset matches "${id}" in the ${catalogSize}-preset catalog.${
            suggestions.length > 0
              ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(', ')}?`
              : ''
          }`,
          ...(suggestions.length > 0 ? { suggestions } : {}),
        };
      }
      providers.selectPreset(resolved);
      return null;
    }
    if (actionId === 'set-field') {
      const key = params?.key;
      const value = params?.value;
      if (typeof key !== 'string' || typeof value !== 'number') {
        return {
          ok: false,
          error:
            'set-field requires params.key (string) and params.value (number).',
        };
      }
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: `set-field requires a finite number; got ${value}.`,
        };
      }
      // The engine drops a live-field write when nothing is mounted, so an
      // early call used to report ok:true and change nothing.
      if (!providers.getSnapshot().engineReady) {
        return {
          ok: false,
          error:
            'set-field cannot run yet: the engine has not mounted (engineReady is false). Call waitFor((s) => s.engineReady) first.',
        };
      }
      providers.setField(key, value);
      return null;
    }
    if (actionId === 'crossfade') {
      const position = params?.position;
      if (typeof position !== 'number' || !Number.isFinite(position)) {
        return {
          ok: false,
          error: 'crossfade requires params.position (number, 0-1).',
        };
      }
      providers.setCrossfade(position);
      return null;
    }
    if (actionId === 'pin-parameter' || actionId === 'unpin-parameter') {
      const field = params?.field;
      if (typeof field !== 'string' || !field) {
        return {
          ok: false,
          error: `${actionId} requires params.field (string).`,
        };
      }
      const applied =
        actionId === 'pin-parameter'
          ? providers.pinParameter(field)
          : providers.unpinParameter(field);
      if (!applied) {
        return {
          ok: false,
          error: `"${field}" is not a pinnable parameter.`,
        };
      }
      return null;
    }
    const action = providers
      .getActions()
      .find((candidate) => candidate.id === actionId);
    if (!action) {
      const suggestions = suggestIds(actionId, [
        ...providers.getActions().map((candidate) => candidate.id),
        ...AGENT_VERBS.map((verb) => verb.id),
      ]);
      return {
        ok: false,
        error: `Unknown action "${actionId}".${
          suggestions.length > 0
            ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(', ')}?`
            : ''
        } listActions() returns every palette action and the targeted verbs (select-preset, set-field, crossfade, pin-parameter, unpin-parameter).`,
        ...(suggestions.length > 0 ? { suggestions } : {}),
      };
    }
    action.run();
    return null;
  };

  const waitForVariables: AgentGlobal['waitForVariables'] = (
    predicate,
    timeoutMs = 5_000,
  ) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`waitForVariables timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const unsubscribe = subscribeVariables((variables) => {
        if (!predicate(variables)) return;
        clearTimeout(timer);
        unsubscribe();
        // The feed reuses one object per frame; detach before handing it out.
        resolve({ ...variables });
      });
    });

  const agentGlobal: AgentGlobal = {
    getState: buildState,
    getEvents: (sinceSeq = 0) => events.filter((e) => e.seq > sinceSeq),
    run: async (actionId, params) => {
      const seqBefore = eventSeq;
      const settlePromise = nextCommit(RUN_SETTLE_TIMEOUT_MS);
      const failure = runAction(actionId, params);
      if (failure) return failure;
      const settled = await settlePromise;
      return {
        ok: true,
        settled,
        events: events.filter((event) => event.seq > seqBefore),
      };
    },
    listActions: () => [
      ...providers
        .getActions()
        .map((action) => ({ id: action.id, label: action.label })),
      ...AGENT_VERBS.map((verb) => ({
        id: verb.id,
        label: verb.label,
        params: { ...verb.params },
      })),
    ],
    waitFor: (predicate, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const state = buildState();
          if (predicate(state)) {
            commitListeners.delete(check);
            window.clearTimeout(timer);
            resolve(state);
          }
        };
        const timer = window.setTimeout(() => {
          commitListeners.delete(check);
          reject(
            new Error(
              `waitFor timed out after ${timeoutMs}ms. Last state: ${describeAgentState(buildState())}. Predicate: ${predicate
                .toString()
                .replace(/\s+/g, ' ')
                .slice(0, 160)}`,
            ),
          );
        }, timeoutMs);
        commitListeners.add(check);
        check();
      }),
    waitForVariables,
    getVariables: (timeoutMs = 2_000) =>
      waitForVariables(() => true, timeoutMs).catch(() => null),
    captureStats: () => {
      const canvas = providers.getStageCanvas();
      if (!canvas) return Promise.resolve(null);
      if (typeof requestAnimationFrame !== 'function') {
        return Promise.resolve(extractFrameStats(canvas));
      }
      return new Promise<FrameStats | null>((resolve) => {
        requestAnimationFrame(() => {
          resolve(extractFrameStats(canvas));
        });
      });
    },
  };

  const handleError = (event: ErrorEvent) => {
    lastErrorMessage = event.message || 'Unknown error';
    pushEvent('error', { message: lastErrorMessage, source: 'window.error' });
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    lastErrorMessage =
      reason instanceof Error ? reason.message : String(reason ?? 'Unknown');
    pushEvent('error', {
      message: lastErrorMessage,
      source: 'unhandledrejection',
    });
  };
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);

  window.__stims_agent = agentGlobal;
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    if (window.__stims_agent === agentGlobal) {
      window.__stims_agent = undefined;
    }
  };
}
