import { describe, expect, mock, test } from 'bun:test';
import {
  getPresetFileCacheSize,
  MAX_PRESET_FILE_CACHE_SIZE,
  setPresetFile,
} from '../../src/js/frontend/hooks/use-live-preset-tile.ts';
import { createMilkdropPresetPreviewService } from '../../src/js/milkdrop/runtime/preset-preview-service.ts';

describe('memory leak prevention', () => {
  test('presetFileById Map caps size to MAX_PRESET_FILE_CACHE_SIZE via setPresetFile', () => {
    for (let i = 0; i < MAX_PRESET_FILE_CACHE_SIZE + 50; i += 1) {
      setPresetFile(`preset-${i}`, `/path/to/preset-${i}.json`);
    }

    expect(getPresetFileCacheSize()).toBeLessThanOrEqual(
      MAX_PRESET_FILE_CACHE_SIZE,
    );
  });

  test('PresetPreviewService dispose clears queue, active state, and previews map', async () => {
    const capturePreview = mock(async (presetId: string) => ({
      imageUrl: `data:image/png;base64,mock-${presetId}`,
      actualBackend: 'webgl' as const,
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot' as const,
    }));

    const onPreviewChanged = mock(() => {});
    const service = createMilkdropPresetPreviewService({
      capturePreview,
      onPreviewChanged,
    });

    service.requestPreviews(['p1', 'p2', 'p3']);
    expect(service.getPreview('p1')?.status).toBe('capturing');

    service.dispose();

    expect(service.getPreview('p1')).toBeNull();
    expect(service.getPreview('p2')).toBeNull();

    // Invoking methods on disposed service should be safe no-ops
    service.requestPreviews(['p4']);
    expect(service.getPreview('p4')).toBeNull();
  });
});
