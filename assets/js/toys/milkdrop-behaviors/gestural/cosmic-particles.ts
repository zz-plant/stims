import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  buildDesktopGestureSignalOverrides,
  createOptionCycler,
  createPerformanceActionStepper,
  createQueuedFieldApplier,
  createRotationStepper,
  handleDesktopPerformanceCycle,
  type PresetOption,
} from './shared';

export const createCosmicParticlesBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const presets: PresetOption[] = [
      {
        id: 'orbit',
        label: 'Orbit',
        fields: {
          wave_mode: 2,
          wave_mystery: 0.3,
          mesh_density: 19,
          zoom: 1.05,
          rot: 0.01,
        },
        status: 'Cosmic preset: Orbit',
      },
      {
        id: 'nebula',
        label: 'Nebula',
        fields: {
          wave_mode: 0,
          wave_mystery: 0.16,
          mesh_density: 15,
          zoom: 1.01,
          rot: 0.004,
        },
        status: 'Cosmic preset: Nebula',
      },
    ];

    const stepper = createRotationStepper();
    const actionStepper = createPerformanceActionStepper();
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncPresetButtons: (() => void) | null = null;
    const presetCycler = createOptionCycler({
      options: presets,
      initialId: 'orbit',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
        syncPresetButtons?.();
      },
    });

    return {
      setupPanel(panel, api) {
        applyFields = createQueuedFieldApplier(api);
        syncPresetButtons = attachButtonGroup({
          panel,
          title: 'Cosmic preset',
          description:
            'Orbit keeps a steady pull. Press Q/E on desktop or rotate with two fingers to swap the feel.',
          options: presets,
          getActiveId: presetCycler.getActiveId,
          onChange: (id) => presetCycler.select(id),
        });
        api.setStatus(
          'Move to steer the orbit, drag to shove the field, scroll to deepen the pull, then press 1/2 or Q/E to flip the cosmic preset.',
        );
      },
      getSignalOverrides({ frame }) {
        return buildDesktopGestureSignalOverrides(frame, {
          wheelScaleSensitivity: 0.16,
          maxScaleOffset: 0.44,
        });
      },
      onFrame({ frame }) {
        handleDesktopPerformanceCycle({
          frame,
          rotationStepper: stepper,
          actionStepper,
          onNext: () => presetCycler.next(),
          onPrevious: () => presetCycler.previous(),
          onQuickLook: (index) => {
            presetCycler.select(
              presets[index]?.id ?? presetCycler.getActiveId(),
            );
          },
        });
      },
      dispose() {
        syncPresetButtons = null;
      },
    };
  };
