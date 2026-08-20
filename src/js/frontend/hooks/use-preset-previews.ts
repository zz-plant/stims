import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../../milkdrop/preset-preview.ts';
import { encodePresetPreviewImage } from '../../milkdrop/preset-preview.ts';
import type { EngineSnapshot } from '../engine/engine-snapshot.ts';
import { createLazyFactory } from '../use-lazy-factory.ts';

type PreviewControlEngine = {
  pausePreview: () => void;
  resumePreview: () => void;
};

export function usePresetPreviews({
  stageRef,
  engine,
  engineSnapshot,
  fallbackCatalogReady,
  isDisposed,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  engine: PreviewControlEngine;
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
  const requestedIdsRef = useRef<Set<string>>(new Set());

  const ensurePresetPreviewService = useEffectEvent(
    createLazyFactory({
      name: 'PresetPreviewService',
      factory: async () => {
        const [{ createMilkdropPresetPreviewService }] = await Promise.all([
          import('../../milkdrop/runtime/preset-preview-service.ts'),
        ]);

        const service = createMilkdropPresetPreviewService({
          capturePreview: async (presetId) => {
            // This captures the ONE live stage canvas, so the only preset it
            // can honestly produce a preview of is the one currently playing.
            // Capturing for any other id stamped the live preset's frame onto
            // that preset's tile — and because a runtime snapshot outranks the
            // static thumbnail in PresetArtwork, every visible grid tile
            // collapsed to the same image. Refuse rather than mislabel; the
            // static preview stays.
            const activePresetId = engineSnapshot?.activePresetId ?? null;
            if (!activePresetId || presetId !== activePresetId) {
              throw new Error(
                `Preview capture skipped: ${presetId} is not the preset on stage.`,
              );
            }
            engine.resumePreview();
            const stage = stageRef.current;
            const canvas = stage?.querySelector('canvas');
            if (!(canvas instanceof HTMLCanvasElement)) {
              engine.pausePreview();
              throw new Error('Preview canvas was not available.');
            }

            const result = {
              imageUrl: encodePresetPreviewImage(canvas),
              actualBackend: engineSnapshot?.backend ?? null,
              updatedAt: Date.now(),
              error: null,
              source: 'runtime-snapshot' as const,
            };
            engine.pausePreview();
            return result;
          },
          onPreviewChanged: (preview) => {
            setPresetPreviews((current) => ({
              ...current,
              [preview.presetId]: preview,
            }));
          },
          onPreviewEvicted: (presetId) => {
            requestedIdsRef.current.delete(presetId);
            setPresetPreviews((current) => {
              if (!(presetId in current)) {
                return current;
              }
              const next = { ...current };
              delete next[presetId];
              return next;
            });
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

  useEffect(() => {
    if (
      !engineSnapshot?.runtimeReady ||
      engineSnapshot?.audioActive ||
      requestedIdsRef.current.size === 0 ||
      isDisposed()
    ) {
      return;
    }

    const requestedIds = [...requestedIdsRef.current];
    const allReady = requestedIds.every(
      (id) => presetPreviews[id]?.status === 'ready',
    );
    if (allReady) {
      engine.pausePreview();
    }
  }, [
    engineSnapshot?.runtimeReady,
    engineSnapshot?.audioActive,
    presetPreviews,
    engine,
    isDisposed,
  ]);

  useEffect(() => {
    return () => {
      previewServiceRef.current?.dispose();
      previewServiceRef.current = null;
      previewServicePromiseRef.current = null;
    };
  }, []);

  return {
    ensurePresetPreviewService,
    presetPreviews,
    previewServiceRef,
    previewServicePromiseRef,
    requestPresetPreviews: async (presetIds: string[]) => {
      for (const id of presetIds) {
        requestedIdsRef.current.add(id);
      }
      const service = await ensurePresetPreviewService();
      engine.resumePreview();
      service.requestPreviews(presetIds);
    },
    refreshPresetPreviews: async (presetIds: string[]) => {
      for (const id of presetIds) {
        requestedIdsRef.current.add(id);
      }
      const service = await ensurePresetPreviewService();
      engine.resumePreview();
      service.refreshPreviews(presetIds);
    },
  };
}
