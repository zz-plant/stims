import { describe, expect, test } from 'bun:test';
import { createMilkdropEngineAdapter } from '../../src/js/frontend/engine/milkdrop-engine-session.ts';

describe('MilkDrop engine preset import', () => {
  test('rejects with a retry action instead of silently succeeding before mount', async () => {
    const adapter = createMilkdropEngineAdapter();
    const file = new File(['[preset00]\nfRating=3'], 'example.milk', {
      type: 'text/plain',
    });

    await expect(adapter.importPreset([file])).rejects.toThrow(
      'Failed to import preset because the visualizer is still loading. Wait a moment, then try importing the file again.',
    );

    adapter.dispose();
  });
});
