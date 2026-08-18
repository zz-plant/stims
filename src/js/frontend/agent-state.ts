// Machine-readable app state for automation (agents, e2e, MCP sessions).
//
// Design, learned by driving the app as an agent:
// - Feedback is transient (toasts evaporate) → status ring buffer + typed
//   event log with sequence numbers, so effects are verifiable after the
//   fact and causality is assertable ("my action produced these events").
// - State reads in the same tick as an action are stale (React commit lag)
//   → run() resolves after the next post-commit notification, and
//   waitFor(predicate) replaces sleep-and-repoll loops entirely.
// - Labels change; ids don't → run(id, params) executes command-palette
//   actions plus targeted verbs (select-preset, set-field) by stable id.
// - "Is anything actually rendering?" needs pixels → captureStats() reuses
//   the visual-search frame-stats readback (on demand only: reading back a
//   WebGPU canvas can stall the main thread — never call it per-frame).
//
// Installed as `window.__stims_agent` by App in all modes. The
// `data-engine-state` attribute on <body> ('booting' | 'ready' | 'live')
// is the selector-waitable companion, also owned by App.
// Full usage guide: docs/agents/browser-automation.md.

import {
  extractFrameStats,
  type FrameStats,
} from '../core/services/visual-embedding.ts';
import type { AgentTelemetry } from './agent-bridge.ts';
import type { CommandAction } from './command-palette-registry.ts';

const STATUS_LOG_LIMIT = 20;
const EVENT_LOG_LIMIT = 100;
const RUN_SETTLE_TIMEOUT_MS = 1000;
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
  | 'transition'
  | 'autoplay'
  | 'backend';

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
  audioSource: string | null;
  audioEnergy: number | null;
  autoplay: boolean | null;
  transition: { mode: string | null; blendDuration: number | null };
}

export interface AgentStateSnapshot extends AgentCoreSnapshot {
  fps: number | null;
  quality: AgentTelemetry['quality'];
  lastError: string | null;
  statusLog: AgentStatusEntry[];
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

export interface AgentRunResult {
  ok: boolean;
  /** True when a state commit was observed after the action; false means
   * the action ran but produced no snapshot change within the settle
   * window (normal for e.g. share-link). */
  settled?: boolean;
  error?: string;
}

export interface AgentGlobal {
  getState: () => AgentStateSnapshot;
  /** Typed events since a sequence number (0 = all retained). */
  getEvents: (sinceSeq?: number) => AgentEvent[];
  /**
   * Run a command-palette action — or a targeted verb — by stable id.
   * Targeted verbs: 'select-preset' {id}, 'set-field' {key, value}.
   * Resolves after the next state commit (or a 1s settle window).
   */
  run: (
    actionId: string,
    params?: Record<string, unknown>,
  ) => Promise<AgentRunResult>;
  listActions: () => Array<{ id: string; label: string }>;
  /** Resolve when predicate(getState()) is true; reject on timeout. */
  waitFor: (
    predicate: (state: AgentStateSnapshot) => boolean,
    timeoutMs?: number,
  ) => Promise<AgentStateSnapshot>;
  /**
   * Luminance/coverage/motion stats from the live stage canvas, via the
   * visual-search readback. On demand only — WebGPU readback can stall.
   */
  captureStats: () => FrameStats | null;
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
  setField: (key: string, value: number) => void;
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
      providers.selectPreset(id);
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
      providers.setField(key, value);
      return null;
    }
    const action = providers
      .getActions()
      .find((candidate) => candidate.id === actionId);
    if (!action) {
      return {
        ok: false,
        error: `Unknown action "${actionId}". Use listActions() for palette actions; targeted verbs are "select-preset" and "set-field".`,
      };
    }
    action.run();
    return null;
  };

  const agentGlobal: AgentGlobal = {
    getState: buildState,
    getEvents: (sinceSeq = 0) => events.filter((e) => e.seq > sinceSeq),
    run: async (actionId, params) => {
      const settlePromise = nextCommit(RUN_SETTLE_TIMEOUT_MS);
      const failure = runAction(actionId, params);
      if (failure) return failure;
      const settled = await settlePromise;
      return { ok: true, settled };
    },
    listActions: () =>
      providers
        .getActions()
        .map((action) => ({ id: action.id, label: action.label })),
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
          reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        commitListeners.add(check);
        check();
      }),
    captureStats: () => {
      const canvas = providers.getStageCanvas();
      if (!canvas) return null;
      return extractFrameStats(canvas);
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
