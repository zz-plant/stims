import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../../milkdrop/preset-preview.ts';
import type { EngineSnapshot } from '../engine/engine-snapshot.ts';
import { createLazyFactory } from '../use-lazy-factory.ts';

export function usePresetPreviews({
  stageRef,
  engineSnapshot,
  fallbackCatalogReady,
  isDisposed,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  engineSnapshot: EngineSnapshot | null;
  fallbackCatalogReady: boolean;
  isDisposed: () => boolean;
}) {
  const [presetPreviews, setPresetPreviews] = useState<
    Record<string, MilkdropPresetRenderPreview>
  >({});
  const previewServiceRef = useRef<{
    dispose: () => void;
    refreshPreviews: (presetIds: string[]) => void;
    requestPreviews: (presetIds: string[]) => void;
  } | null>(null);
  const previewServicePromiseRef = useRef<Promise<{
    dispose: () => void;
    refreshPreviews: (presetIds: string[]) => void;
    requestPreviews: (presetIds: string[]) => void;
  }> | null>(null);

  const ensurePresetPreviewService = useEffectEvent(
    createLazyFactory({
      name: 'PresetPreviewService',
      factory: async () => {
        const [{ createMilkdropPresetPreviewService }] = await Promise.all([
          import('../../milkdrop/runtime/preset-preview-service.ts'),
        ]);

        const service = createMilkdropPresetPreviewService({
          capturePreview: async (_presetId) => {
            const stage = stageRef.current;
            const canvas = stage?.querySelector('canvas');
            if (!(canvas instanceof HTMLCanvasElement)) {
              throw new Error('Preview canvas was not available.');
            }

            return {
              imageUrl: canvas.toDataURL('image/webp', 0.82),
              actualBackend: engineSnapshot?.backend ?? null,
              updatedAt: Date.now(),
              error: null,
              source: 'runtime-snapshot' as const,
            };
          },
          onPreviewChanged: (preview) => {
            setPresetPreviews((current) => ({
              ...current,
              [preview.presetId]: preview,
            }));
          },
        });

        return service;
      },
      getRef: () => previewServiceRef.current,
      setRef: (svc) => {
        previewServiceRef.current = svc;
      },
      getPromiseRef: () => previewServicePromiseRef.current,
      setPromiseRef: (p) => {
        previewServicePromiseRef.current = p;
      },
      cleanup: (svc) => svc.dispose(),
      isDisposed,
    }),
  );

  useEffect(() => {
    if (!engineSnapshot?.runtimeReady || !fallbackCatalogReady) {
      return;
    }
    void ensurePresetPreviewService().catch(() => {});
  }, [engineSnapshot?.runtimeReady, fallbackCatalogReady]);

  return {
    ensurePresetPreviewService,
    presetPreviews,
    previewServiceRef,
    previewServicePromiseRef,
    requestPresetPreviews: async (presetIds: string[]) => {
      const service = await ensurePresetPreviewService();
      service.requestPreviews(presetIds);
    },
    refreshPresetPreviews: async (presetIds: string[]) => {
      const service = await ensurePresetPreviewService();
      service.refreshPreviews(presetIds);
    },
  };
}
