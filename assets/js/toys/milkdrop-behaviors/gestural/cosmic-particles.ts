import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  createOptionCycler,
  createQueuedFieldApplier,
  createRotationStepper,
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
          description: 'Orbit keeps a steady pull. Nebula softens the drift.',
          options: presets,
          getActiveId: presetCycler.getActiveId,
          onChange: (id) => presetCycler.select(id),
        });
      },
      onFrame({ frame }) {
        const state = frame.input;
        if (!state || state.pointerCount === 0) {
          stepper.reset();
          return;
        }
        const gesture = state.gesture;
        if (!gesture || gesture.pointerCount < 2) {
          return;
        }
        stepper.step(
          gesture.rotation,
          () => presetCycler.next(),
          () => presetCycler.previous(),
        );
      },
      dispose() {
        syncPresetButtons = null;
      },
    };
  };
