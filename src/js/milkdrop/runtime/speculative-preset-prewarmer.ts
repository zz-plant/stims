import type { MilkdropCatalogPreset } from '../catalog-store';
import { compileMilkdropPreset } from '../compiler';

export type SpeculativePrewarmerOptions = {
  maxQueued?: number;
};

export type SpeculativePresetPrewarmer = {
  queuePreset: (preset: MilkdropCatalogPreset) => void;
  queueUpcomingCatalog: (
    presets: MilkdropCatalogPreset[],
    currentIndex: number,
    count?: number,
  ) => void;
  dispose: () => void;
};

export function createSpeculativePresetPrewarmer({
  maxQueued = 5,
}: SpeculativePrewarmerOptions = {}): SpeculativePresetPrewarmer {
  const queue: MilkdropCatalogPreset[] = [];
  const queuedIds = new Set<string>();
  let idleHandle: number | null = null;
  let isDisposed = false;

  const scheduleNext = () => {
    if (isDisposed || idleHandle !== null || queue.length === 0) {
      return;
    }

    const runWork = () => {
      idleHandle = null;
      if (isDisposed || queue.length === 0) {
        return;
      }

      const nextPreset = queue.shift();
      if (nextPreset) {
        queuedIds.delete(nextPreset.preset_id);
        if (nextPreset.milkdrop) {
          try {
            compileMilkdropPreset(nextPreset.milkdrop, nextPreset.preset_id);
          } catch {
            // Pre-compilation failure is silently swallowed during speculative idle warmup
          }
        }
      }

      if (queue.length > 0) {
        scheduleNext();
      }
    };

    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => runWork(), { timeout: 1000 });
    } else {
      idleHandle = setTimeout(runWork, 50) as unknown as number;
    }
  };

  return {
    queuePreset: (preset: MilkdropCatalogPreset) => {
      if (isDisposed || !preset?.milkdrop || queuedIds.has(preset.preset_id)) {
        return;
      }

      if (queue.length >= maxQueued) {
        const removed = queue.shift();
        if (removed) {
          queuedIds.delete(removed.preset_id);
        }
      }

      queue.push(preset);
      queuedIds.add(preset.preset_id);
      scheduleNext();
    },
    queueUpcomingCatalog: (
      presets: MilkdropCatalogPreset[],
      currentIndex: number,
      count = 3,
    ) => {
      if (isDisposed || !presets || presets.length === 0) {
        return;
      }

      const total = presets.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const targetIndex = (currentIndex + offset) % total;
        const preset = presets[targetIndex];
        if (preset) {
          if (isDisposed || !preset?.milkdrop || queuedIds.has(preset.preset_id)) {
            continue;
          }

          if (queue.length >= maxQueued) {
            const removed = queue.shift();
            if (removed) {
              queuedIds.delete(removed.preset_id);
            }
          }

          queue.push(preset);
          queuedIds.add(preset.preset_id);
        }
      }
      scheduleNext();
    },
    dispose: () => {
      isDisposed = true;
      if (idleHandle !== null) {
        if (typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(idleHandle);
        } else {
          clearTimeout(idleHandle);
        }
        idleHandle = null;
      }
      queue.length = 0;
      queuedIds.clear();
    },
  };
}
