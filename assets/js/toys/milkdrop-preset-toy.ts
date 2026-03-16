import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createMilkdropExperience } from '../milkdrop/runtime';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';

type MilkdropPresetToyConfig = {
  presetId: string;
  title: string;
  description: string;
};

export function createMilkdropPresetToyStarter({
  presetId,
  title,
  description,
}: MilkdropPresetToyConfig) {
  return function start({ container }: ToyStartOptions = {}) {
    let runtime: ToyRuntimeInstance | null = null;

    const { quality, configurePanel } = createToyQualityControls({
      title,
      description,
      defaultPresetId: 'balanced',
      storageKey: 'stims:milkdrop:quality',
      getRuntime: () => runtime,
    });

    const experience = createMilkdropExperience({
      container,
      quality,
      initialPresetId: presetId,
    });

    const startRuntime = createToyRuntimeStarter({
      toyOptions: {
        cameraOptions: { position: { x: 0, y: 0, z: 5 } },
        rendererOptions: {
          antialias: true,
        },
      },
      audio: {
        fftSize: 1024,
      },
      plugins: [
        {
          name: `milkdrop-preset-${presetId}`,
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
  };
}
