// Machine-readable app state for automation (agents, e2e, MCP sessions).
//
// Two problems this solves, learned by driving the app as an agent:
// 1. Feedback is transient — status toasts evaporate, so an agent can't
//    verify "Link copied" after the fact. The ring buffer keeps the last
//    STATUS_LOG_LIMIT messages with timestamps.
// 2. State is scattered — boot phase, live mode, open panel, transition
//    settings each require their own DOM scrape. `getState()` returns one
//    JSON snapshot; `run(id)` executes any command-palette action by its
//    stable id, so automation is decoupled from labels and menu structure.
//
// Installed as `window.__stims_agent` by App (all modes — it costs nothing
// and e2e tests run without ?agent=true). The `data-engine-state` attribute
// on <body> ('booting' | 'ready' | 'live') is the selector-waitable
// companion, also owned by App.

import type { CommandAction } from './command-palette-registry.ts';

const STATUS_LOG_LIMIT = 20;

export interface AgentStatusEntry {
  at: number;
  message: string;
}

export interface AgentStateSnapshot {
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
  statusLog: AgentStatusEntry[];
}

const statusLog: AgentStatusEntry[] = [];

/** Called by the workspace status setter; null (clearing) is not logged. */
export function recordStatusMessage(message: string | null): void {
  if (!message) return;
  statusLog.push({ at: Date.now(), message });
  if (statusLog.length > STATUS_LOG_LIMIT) {
    statusLog.splice(0, statusLog.length - STATUS_LOG_LIMIT);
  }
}

export function getStatusLog(): AgentStatusEntry[] {
  return [...statusLog];
}

export interface AgentGlobal {
  getState: () => AgentStateSnapshot;
  /** Run a command-palette action by id. */
  run: (actionId: string) => { ok: boolean; error?: string };
  /** Enumerate runnable action ids with their labels. */
  listActions: () => Array<{ id: string; label: string }>;
}

declare global {
  interface Window {
    __stims_agent?: AgentGlobal;
  }
}

/**
 * Install `window.__stims_agent`. The providers read from refs so the
 * global never goes stale and never needs re-installing on re-render.
 * Returns a cleanup that removes the global.
 */
export function installAgentStateGlobal(providers: {
  getSnapshot: () => Omit<AgentStateSnapshot, 'statusLog'>;
  getActions: () => CommandAction[];
}): () => void {
  const agentGlobal: AgentGlobal = {
    getState: () => ({
      ...providers.getSnapshot(),
      statusLog: getStatusLog(),
    }),
    run: (actionId: string) => {
      const action = providers
        .getActions()
        .find((candidate) => candidate.id === actionId);
      if (!action) {
        return {
          ok: false,
          error: `Unknown action "${actionId}". Use listActions() for the current set.`,
        };
      }
      action.run();
      return { ok: true };
    },
    listActions: () =>
      providers
        .getActions()
        .map((action) => ({ id: action.id, label: action.label })),
  };
  window.__stims_agent = agentGlobal;
  return () => {
    if (window.__stims_agent === agentGlobal) {
      window.__stims_agent = undefined;
    }
  };
}
