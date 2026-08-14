import { describe, expect, test } from 'bun:test';
import {
  getAgentTelemetry,
  initAgentBridge,
  toAgentEditorState,
  updateAgentTelemetry,
} from '../../src/js/frontend/agent-bridge.ts';

describe('agent bridge & telemetry', () => {
  test('updates and reads agent telemetry snapshot', () => {
    updateAgentTelemetry({
      fps: 60,
      backend: 'webgpu',
      audioEnergy: 0.85,
      currentPresetId: 'shifter-snakeskin',
      agentMode: true,
    });

    const telemetry = getAgentTelemetry();
    expect(telemetry.fps).toBe(60);
    expect(telemetry.backend).toBe('webgpu');
    expect(telemetry.audioEnergy).toBe(0.85);
    expect(telemetry.currentPresetId).toBe('shifter-snakeskin');
    expect(telemetry.agentMode).toBe(true);
  });

  test('initializes bridge and responds to postMessage commands', () => {
    let loadedPreset: string | undefined;

    const cleanup = initAgentBridge({
      onLoadPreset: (payload) => {
        loadedPreset = payload.presetId;
      },
    });

    // Create MessageEvent using global/window constructor
    const EventClass =
      (window as unknown as { MessageEvent: typeof MessageEvent })
        .MessageEvent || MessageEvent;
    const event = new EventClass('message', {
      data: {
        type: 'toil:load_preset',
        presetId: 'shifter-snakeskin',
      },
    });

    window.dispatchEvent(event);

    expect(loadedPreset).toBe('shifter-snakeskin');

    cleanup();
  });

  // The live-editing surface exists so an out-of-process agent can tell a
  // landed edit from a rejected one. On screen they look identical: the
  // session keeps rendering the last good compile either way.
  const compiled = (id: string, title: string) => ({
    title,
    source: { id },
  });

  test('projects a clean compile as rendering the edited source', () => {
    const state = toAgentEditorState({
      source: 'title=Clean\nzoom=1.01\n',
      dirty: false,
      diagnostics: [],
      latestCompiled: compiled('clean', 'Clean'),
      activeCompiled: compiled('clean', 'Clean'),
    });

    expect(state.errorCount).toBe(0);
    expect(state.warningCount).toBe(0);
    expect(state.renderingFallback).toBe(false);
    expect(state.presetId).toBe('clean');
    expect(state.sourceLength).toBeGreaterThan(0);
  });

  test('flags that a failed compile left the previous preset on screen', () => {
    const latest = compiled('broken', 'Broken');
    const state = toAgentEditorState({
      source: 'title=Broken\nper_frame_1=wave_r = sin(\n',
      dirty: true,
      diagnostics: [
        {
          severity: 'error',
          code: 'unclosed_paren',
          message: 'Unclosed parenthesis.',
          line: 2,
        },
        {
          severity: 'warning',
          code: 'deprecated',
          message: 'Deprecated field.',
        },
      ],
      latestCompiled: latest,
      // The session substitutes the last good compile when the newest source
      // has errors — this divergence is the whole signal.
      activeCompiled: compiled('previous', 'Previous Preset'),
    });

    expect(state.errorCount).toBe(1);
    expect(state.warningCount).toBe(1);
    expect(state.renderingFallback).toBe(true);
    expect(state.renderedTitle).toBe('Previous Preset');
    expect(state.title).toBe('Broken');
    expect(state.diagnostics[0]?.line).toBe(2);
  });

  test('does not claim a fallback when a compile merely warns', () => {
    const only = compiled('warned', 'Warned');
    const state = toAgentEditorState({
      source: 'title=Warned\n',
      dirty: false,
      diagnostics: [
        { severity: 'warning', code: 'compat', message: 'Partial parity.' },
      ],
      latestCompiled: only,
      activeCompiled: only,
    });

    expect(state.errorCount).toBe(0);
    expect(state.renderingFallback).toBe(false);
  });

  test('exposes the editor surface on the installed bridge', async () => {
    const cleanup = initAgentBridge({
      getEditorState: () =>
        toAgentEditorState({
          source: 'title=Bridged\n',
          dirty: false,
          diagnostics: [],
          latestCompiled: compiled('bridged', 'Bridged'),
          activeCompiled: compiled('bridged', 'Bridged'),
        }),
      getEditorFields: () => ({ zoom: 1.5, warp: 0.25 }),
      applyEditorFields: async (updates) =>
        toAgentEditorState({
          source: `title=Bridged\nzoom=${updates.zoom}\n`,
          dirty: true,
          diagnostics: [],
          latestCompiled: compiled('bridged', 'Bridged'),
          activeCompiled: compiled('bridged', 'Bridged'),
        }),
    });

    const bridge = window.__STIMS_AGENT_BRIDGE__;
    expect(bridge?.getEditorState()?.presetId).toBe('bridged');
    expect(bridge?.getEditorFields()?.zoom).toBe(1.5);
    expect((await bridge?.applyEditorFields({ zoom: 2 }))?.dirty).toBe(true);
    // Unwired callbacks must answer null rather than throw, so a tool calling
    // into a half-mounted page gets a clear "not ready" instead of a crash.
    expect(await bridge?.applyEditorSource('title=x\n')).toBeNull();

    cleanup();
  });
});
