import { describe, expect, mock, test } from 'bun:test';
import {
  createMilkdropPresetPreviewService,
  MAX_PRESET_PREVIEW_CACHE_SIZE,
} from '../../src/js/milkdrop/runtime/preset-preview-service.ts';

describe('milkdrop preset preview service', () => {
  test('queues captures once and prioritizes the latest visible preset order', async () => {
    const previewStates: string[] = [];
    const resolvers = new Map<string, () => void>();
    const capturePreview = mock(
      (presetId: string) =>
        new Promise<{
          imageUrl: string | null;
          actualBackend: 'webgl' | 'webgpu' | null;
          updatedAt: number | null;
          error: string | null;
          source: 'runtime-snapshot';
        }>((resolve) => {
          resolvers.set(presetId, () =>
            resolve({
              imageUrl: `data:${presetId}`,
              actualBackend: 'webgl',
              updatedAt: Date.now(),
              error: null,
              source: 'runtime-snapshot',
            }),
          );
        }),
    );

    const service = createMilkdropPresetPreviewService({
      capturePreview,
      onPreviewChanged: (preview) => {
        previewStates.push(`${preview.presetId}:${preview.status}`);
      },
      onPreviewEvicted: () => {},
    });

    service.requestPreviews(['signal-bloom', 'aurora-drift']);
    service.requestPreviews(['aurora-drift', 'signal-bloom', 'night-drive']);

    expect(capturePreview).toHaveBeenCalledTimes(1);
    expect(capturePreview.mock.calls[0]?.[0]).toBe('signal-bloom');

    resolvers.get('signal-bloom')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(capturePreview).toHaveBeenCalledTimes(2);
    expect(capturePreview.mock.calls[1]?.[0]).toBe('aurora-drift');
    expect(previewStates).toContain('signal-bloom:queued');
    expect(previewStates).toContain('signal-bloom:capturing');
    expect(previewStates).toContain('signal-bloom:ready');

    service.dispose();
  });

  test('refreshes finished previews and requeues them', async () => {
    const capturePreview = mock(async (presetId: string) => ({
      imageUrl: `data:${presetId}`,
      actualBackend: 'webgpu' as const,
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot' as const,
    }));

    const service = createMilkdropPresetPreviewService({
      capturePreview,
      onPreviewChanged: () => {},
      onPreviewEvicted: () => {},
    });

    service.requestPreviews(['signal-bloom']);
    await Promise.resolve();
    await Promise.resolve();

    expect(capturePreview).toHaveBeenCalledTimes(1);

    service.refreshPreviews(['signal-bloom']);
    await Promise.resolve();
    await Promise.resolve();

    expect(capturePreview).toHaveBeenCalledTimes(2);

    service.dispose();
  });

  test('bounds settled previews by LRU recency and recaptures evicted entries', async () => {
    const capturePreview = mock(async (presetId: string) => ({
      imageUrl: `data:${presetId}`,
      actualBackend: 'webgl' as const,
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot' as const,
    }));
    const evictedIds: string[] = [];
    const service = createMilkdropPresetPreviewService({
      capturePreview,
      onPreviewChanged: () => {},
      onPreviewEvicted: (presetId) => evictedIds.push(presetId),
    });
    const presetIds = Array.from(
      { length: MAX_PRESET_PREVIEW_CACHE_SIZE * 3 },
      (_, index) => `preset-${index}`,
    );

    service.requestPreviews(presetIds);
    for (let index = 0; index < presetIds.length * 3; index += 1) {
      await Promise.resolve();
    }

    const retainedIds = presetIds.filter(
      (presetId) => service.getPreview(presetId) !== null,
    );
    expect(retainedIds).toHaveLength(MAX_PRESET_PREVIEW_CACHE_SIZE);
    expect(evictedIds).toHaveLength(
      presetIds.length - MAX_PRESET_PREVIEW_CACHE_SIZE,
    );
    expect(service.getPreview('preset-0')).toBeNull();

    // Reading the oldest retained entry makes it more recent than its neighbor.
    expect(
      service.getPreview(`preset-${MAX_PRESET_PREVIEW_CACHE_SIZE * 2}`),
    ).not.toBeNull();
    service.requestPreviews(['preset-0']);
    await Promise.resolve();
    await Promise.resolve();

    expect(capturePreview).toHaveBeenCalledTimes(presetIds.length + 1);
    expect(service.getPreview('preset-0')?.status).toBe('ready');
    expect(
      service.getPreview(`preset-${MAX_PRESET_PREVIEW_CACHE_SIZE * 2}`),
    ).not.toBeNull();
    expect(
      service.getPreview(`preset-${MAX_PRESET_PREVIEW_CACHE_SIZE * 2 + 1}`),
    ).toBeNull();
    expect(
      presetIds.filter((presetId) => service.getPreview(presetId) !== null),
    ).toHaveLength(MAX_PRESET_PREVIEW_CACHE_SIZE);
    service.dispose();
  });

  test('disposes safely while a capture is active', async () => {
    let finishCapture: (() => void) | undefined;
    const capturePreview = mock(
      (presetId: string) =>
        new Promise<{
          imageUrl: string;
          actualBackend: 'webgl';
          updatedAt: number;
          error: null;
          source: 'runtime-snapshot';
        }>((resolve) => {
          finishCapture = () =>
            resolve({
              imageUrl: `data:${presetId}`,
              actualBackend: 'webgl',
              updatedAt: Date.now(),
              error: null,
              source: 'runtime-snapshot',
            });
        }),
    );
    const changed = mock(() => {});
    const evicted = mock(() => {});
    const service = createMilkdropPresetPreviewService({
      capturePreview,
      onPreviewChanged: changed,
      onPreviewEvicted: evicted,
    });

    service.requestPreviews(['active', 'queued']);
    expect(service.getPreview('active')?.status).toBe('capturing');
    service.dispose();
    finishCapture?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getPreview('active')).toBeNull();
    expect(capturePreview).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(evicted).not.toHaveBeenCalled();
  });
});
