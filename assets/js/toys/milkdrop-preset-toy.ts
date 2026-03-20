import type { PersistentSettingsPanel } from '../core/settings-panel';
import type { ToyStartOptions } from '../core/toy-interface';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createMilkdropExperience } from '../milkdrop/runtime';
import { createToyRuntimeStarter } from '../utils/toy-runtime-starter';
import { createToyQualityControls } from '../utils/toy-settings';
import type {
  MilkdropPresetToyBehaviorApi,
  MilkdropPresetToyBehaviorFactory,
} from './milkdrop-preset-behavior';

type MilkdropPresetToyConfig = {
  presetId: string;
  title: string;
  description: string;
  createBehavior?: MilkdropPresetToyBehaviorFactory;
};

export function createMilkdropPresetToyStarter({
  presetId,
  title,
  description,
  createBehavior,
}: MilkdropPresetToyConfig) {
  return function start({ container }: ToyStartOptions = {}) {
    let runtime: ToyRuntimeInstance | null = null;
    const behavior = createBehavior?.() ?? null;

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
    const behaviorApi: MilkdropPresetToyBehaviorApi = {
      presetId,
      getActivePresetId: () => experience.getActivePresetId(),
      getActiveCompiledPreset: () => experience.getActiveCompiledPreset(),
      applyFields: async (updates) => {
        await experience.applyFields(updates);
      },
      selectPreset: (id) => experience.selectPreset(id),
      setStatus: (message) => experience.setStatus(message),
    };

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
      input: behavior?.input,
      plugins: [
        {
          name: `milkdrop-preset-${presetId}`,
          setup: (runtimeInstance) => {
            experience.attachRuntime(runtimeInstance);
          },
          update: (frame) => {
            const context = { frame, api: behaviorApi };
            behavior?.onFrame?.(context);
            experience.update(frame, {
              signalOverrides: behavior?.getSignalOverrides?.(context),
            });
          },
          dispose: () => {
            behavior?.dispose?.();
            experience.dispose();
          },
        },
      ],
    });

    runtime = startRuntime({ container });
    const panel: PersistentSettingsPanel = configurePanel();
    behavior?.setupPanel?.(panel, behaviorApi);
    return runtime;
  };
}
