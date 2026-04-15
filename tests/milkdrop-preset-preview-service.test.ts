import { describe, expect, mock, test } from 'bun:test';
import { createMilkdropPresetPreviewService } from '../assets/js/milkdrop/runtime/preset-preview-service.ts';

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
});
