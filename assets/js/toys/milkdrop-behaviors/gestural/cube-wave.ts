import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  createOptionCycler,
  createQueuedFieldApplier,
  createRotationStepper,
  type PresetOption,
} from './shared';

export const createCubeWaveBehavior: MilkdropPresetToyBehaviorFactory = () => {
  const modes: PresetOption[] = [
    {
      id: 'stack',
      label: 'Stack',
      fields: {
        wave_mode: 0,
        wave_mystery: 0.12,
        mesh_density: 28,
        mesh_alpha: 0.26,
        shape_1_sides: 4,
        shape_2_sides: 4,
      },
      status: 'Grid mode: Stack',
    },
    {
      id: 'chop',
      label: 'Chop',
      fields: {
        wave_mode: 2,
        wave_mystery: 0.3,
        mesh_density: 20,
        mesh_alpha: 0.22,
        shape_1_sides: 3,
        shape_2_sides: 3,
      },
      status: 'Grid mode: Chop',
    },
    {
      id: 'pulse',
      label: 'Pulse',
      fields: {
        wave_mode: 1,
        wave_mystery: 0.2,
        mesh_density: 24,
        mesh_alpha: 0.3,
        shape_1_sides: 6,
        shape_2_sides: 6,
      },
      status: 'Grid mode: Pulse',
    },
  ];

  const stepper = createRotationStepper();
  let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
  let syncModeButtons: (() => void) | null = null;
  const modeCycler = createOptionCycler({
    options: modes,
    initialId: 'stack',
    applyOption: (option) => {
      applyFields?.(option.fields, option.status);
      syncModeButtons?.();
    },
  });

  return {
    setupPanel(panel, api) {
      applyFields = createQueuedFieldApplier(api);
      syncModeButtons = attachButtonGroup({
        panel,
        title: 'Grid mode',
        description: 'Rotate with two fingers to step through modes.',
        options: modes,
        getActiveId: modeCycler.getActiveId,
        onChange: (id) => modeCycler.select(id),
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
        () => modeCycler.next(),
        () => modeCycler.previous(),
      );
    },
    dispose() {
      syncModeButtons = null;
    },
  };
};
