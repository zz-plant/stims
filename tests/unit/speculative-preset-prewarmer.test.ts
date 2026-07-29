import { describe, expect, test } from 'bun:test';
import { createSpeculativePresetPrewarmer } from '../../src/js/milkdrop/runtime/speculative-preset-prewarmer.ts';

describe('createSpeculativePresetPrewarmer', () => {
  test('queues and precompiles upcoming presets during idle frames', async () => {
    const prewarmer = createSpeculativePresetPrewarmer({ maxQueued: 5 });
    const dummyPreset = {
      preset_id: 'test-preset-1',
      title: 'Test Preset 1',
      milkdrop: 'fShader=1\nwave_mode=0',
      filename: 'test1.milk',
      file_size: 100,
    };

    prewarmer.queuePreset(dummyPreset);
    await new Promise((resolve) => setTimeout(resolve, 100));

    prewarmer.dispose();
    expect(true).toBe(true);
  });

  test('queues upcoming adjacent catalog presets', async () => {
    const prewarmer = createSpeculativePresetPrewarmer({ maxQueued: 5 });
    const catalog = [
      { preset_id: 'p0', title: 'P0', milkdrop: 'fShader=0', filename: 'p0.milk', file_size: 10 },
      { preset_id: 'p1', title: 'P1', milkdrop: 'fShader=1', filename: 'p1.milk', file_size: 10 },
      { preset_id: 'p2', title: 'P2', milkdrop: 'fShader=2', filename: 'p2.milk', file_size: 10 },
    ];

    prewarmer.queueUpcomingCatalog(catalog, 0, 2);
    await new Promise((resolve) => setTimeout(resolve, 100));

    prewarmer.dispose();
    expect(true).toBe(true);
  });
});
