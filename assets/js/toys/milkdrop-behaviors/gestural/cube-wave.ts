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
  const actionStepper = createPerformanceActionStepper();
  let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
  let syncModeButtons: (() => void) | null = null;
  const modeCycler = createOptionCycler({
    options: modes,
    initialId: 'pulse',
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
        description:
          'Press Q/E on desktop or rotate with two fingers to step through modes.',
        options: modes,
        getActiveId: modeCycler.getActiveId,
        onChange: (id) => modeCycler.select(id),
      });
      void applyFields?.(modes[2].fields, modes[2].status);
      api.setStatus(
        'Move to steer the grid, drag to shove it harder, scroll to lift the energy, then press 1/2/3 or Q/E to swap modes.',
      );
    },
    getSignalOverrides({ frame }) {
      return buildDesktopGestureSignalOverrides(frame, {
        wheelScaleSensitivity: 0.14,
        maxScaleOffset: 0.38,
      });
    },
    onFrame({ frame }) {
      handleDesktopPerformanceCycle({
        frame,
        rotationStepper: stepper,
        actionStepper,
        onNext: () => modeCycler.next(),
        onPrevious: () => modeCycler.previous(),
        onQuickLook: (index) => {
          modeCycler.select(modes[index]?.id ?? modeCycler.getActiveId());
        },
      });
    },
    dispose() {
      syncModeButtons = null;
    },
  };
};
