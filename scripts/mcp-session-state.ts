/**
 * What the MCP session tools (session_get_state, session_watch,
 * session_describe_frame) report about the visualizer page they drive.
 *
 * Read from `window.__stims_agent.getState()`, the agent API every mode
 * installs (docs/agents/browser-automation.md), not from the DOM. These tools
 * used to read the preset name from `.milkdrop-overlay__osd-*` elements, which
 * stopped rendering when the imperative overlay was removed (427ca65c), so
 * every call reported a null title and nothing failed.
 */
import type { AgentStateSnapshot } from '../src/js/frontend/agent-state.ts';

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
