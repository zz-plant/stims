import { DEFAULT_QUALITY_PRESETS } from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createMilkdropExperience } from '../milkdrop/runtime';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createRendererQualityManager } from '../utils/toy-settings';

const MILKDROP_QUALITY_STORAGE_KEY = 'stims:milkdrop:quality';

export function start({ container }: ToyStartOptions = {}) {
  let runtime: ToyRuntimeInstance | null = null;

  const quality = createRendererQualityManager({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
    storageKey: MILKDROP_QUALITY_STORAGE_KEY,
    getRuntime: () => runtime,
  });

  const experience = createMilkdropExperience({
    container,
    quality,
    qualityControl: {
      presets: DEFAULT_QUALITY_PRESETS,
      storageKey: MILKDROP_QUALITY_STORAGE_KEY,
    },
  });

  const startRuntime = createToyRuntimeStarter({
    toyOptions: {
      cameraOptions: { position: { x: 0, y: 0, z: 5 } },
      rendererOptions: {
        antialias: false,
      },
    },
    audio: {
      fftSize: 1024,
    },
    plugins: [
      {
        name: 'milkdrop-experience',
        setup: (runtimeInstance) => {
          experience.attachRuntime(runtimeInstance);
        },
        update: (frame) => {
          experience.update(frame);
        },
        dispose: () => {
          experience.dispose();
        },
      },
    ],
  });

  runtime = startRuntime({ container });
  return runtime;
}
