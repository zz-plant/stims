import { describe, expect, test } from 'bun:test';
import {
  getAgentTelemetry,
  initAgentBridge,
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
});
