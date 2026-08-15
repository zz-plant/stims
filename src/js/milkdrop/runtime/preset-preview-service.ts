import {
  createQueuedPresetPreview,
  type MilkdropPresetRenderPreview,
} from '../preset-preview.ts';

type CaptureResult = Omit<MilkdropPresetRenderPreview, 'presetId' | 'status'>;

// Keeps enough snapshots for the visible catalog rows plus a generous
// near-visible overscan without retaining every preset a user scrolls past.
export const MAX_PRESET_PREVIEW_CACHE_SIZE = 48;

export function createMilkdropPresetPreviewService({
  capturePreview,
  onPreviewChanged,
  onPreviewEvicted,
}: {
  capturePreview: (presetId: string) => Promise<CaptureResult>;
  onPreviewChanged: (preview: MilkdropPresetRenderPreview) => void;
  onPreviewEvicted: (presetId: string) => void;
}) {
  const previews = new Map<string, MilkdropPresetRenderPreview>();
  let queue: string[] = [];
  let currentPresetId: string | null = null;
  let disposed = false;

  const touch = (presetId: string) => {
    const preview = previews.get(presetId);
    if (!preview) {
      return;
    }
    previews.delete(presetId);
    previews.set(presetId, preview);
  };

  const evictSettledPreviews = () => {
    while (previews.size > MAX_PRESET_PREVIEW_CACHE_SIZE) {
      const evictionCandidate = [...previews].find(
        ([, preview]) =>
          preview.status === 'ready' || preview.status === 'failed',
      );
      if (!evictionCandidate) {
        return;
      }
      const [presetId] = evictionCandidate;
      previews.delete(presetId);
      onPreviewEvicted(presetId);
    }
  };

  const emit = (preview: MilkdropPresetRenderPreview) => {
    previews.set(preview.presetId, preview);
    touch(preview.presetId);
    onPreviewChanged(preview);
    evictSettledPreviews();
  };

  const ensureQueuedPreview = (presetId: string) => {
    const current = previews.get(presetId);
    if (
      current?.status === 'ready' ||
      current?.status === 'capturing' ||
      current?.status === 'queued'
    ) {
      return;
    }
    emit(createQueuedPresetPreview(presetId));
  };

  const runQueue = async () => {
    if (disposed || currentPresetId || queue.length === 0) {
      return;
    }

    const nextPresetId = queue.shift();
    if (!nextPresetId) {
      return;
    }

    currentPresetId = nextPresetId;
    emit({
      presetId: nextPresetId,
      status: 'capturing',
      imageUrl: null,
      actualBackend: null,
      updatedAt: Date.now(),
      error: null,
      source: 'runtime-snapshot',
    });

    try {
      const result = await capturePreview(nextPresetId);
      if (!disposed) {
        emit({
          presetId: nextPresetId,
          status: 'ready',
          ...result,
        });
      }
    } catch (error) {
      if (!disposed) {
        emit({
          presetId: nextPresetId,
          status: 'failed',
          imageUrl: null,
          actualBackend: null,
          updatedAt: Date.now(),
          error:
            error instanceof Error
              ? error.message
              : 'Unable to capture preset preview.',
          source: 'runtime-snapshot',
        });
      }
    } finally {
      currentPresetId = null;
      if (!disposed) {
        void runQueue();
      }
    }
  };

  const enqueue = (presetIds: string[]) => {
    const uniquePresetIds = [...new Set(presetIds.filter(Boolean))];
    const queuedSet = new Set(queue);

    queue = [
      ...uniquePresetIds.filter(
        (presetId) =>
          presetId !== currentPresetId &&
          previews.get(presetId)?.status !== 'ready',
      ),
      ...queue.filter((presetId) => !uniquePresetIds.includes(presetId)),
    ];

    uniquePresetIds.forEach((presetId) => {
      if (
        presetId !== currentPresetId &&
        !queuedSet.has(presetId) &&
        previews.get(presetId)?.status !== 'ready'
      ) {
        ensureQueuedPreview(presetId);
      }
    });

    void runQueue();
  };

  return {
    requestPreviews(presetIds: string[]) {
      if (disposed) {
        return;
      }
      enqueue(presetIds);
    },

    refreshPreviews(presetIds: string[]) {
      if (disposed) {
        return;
      }

      presetIds
        .filter(Boolean)
        .forEach((presetId) => emit(createQueuedPresetPreview(presetId)));
      enqueue(presetIds);
    },

    getPreview(presetId: string) {
      const preview = previews.get(presetId) ?? null;
      if (preview) {
        touch(presetId);
      }
      return preview;
    },

    dispose() {
      disposed = true;
      queue = [];
      currentPresetId = null;
      previews.clear();
    },
  };
}

export type MilkdropPresetPreviewService = ReturnType<
  typeof createMilkdropPresetPreviewService
>;
