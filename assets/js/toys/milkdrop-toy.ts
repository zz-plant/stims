import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createMilkdropExperience } from '../milkdrop/runtime';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

export function start({ container }: ToyStartOptions = {}) {
  let runtime: ToyRuntimeInstance | null = null;

  const { quality, configurePanel } = createToyQualityControls({
    title: 'MilkDrop Visualizer',
    description:
      'Browse curated presets, blend between looks, and live-edit the active preset without breaking playback.',
    defaultPresetId: 'balanced',
    storageKey: 'stims:milkdrop:quality',
    getRuntime: () => runtime,
  });

  const experience = createMilkdropExperience({
    container,
    quality,
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
  configurePanel();
  return runtime;
}
