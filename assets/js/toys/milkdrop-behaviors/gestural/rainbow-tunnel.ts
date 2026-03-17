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

export const createRainbowTunnelBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const motionModes: PresetOption[] = [
      {
        id: 'cruise',
        label: 'Cruise',
        fields: {
          wave_mode: 0,
          wave_mystery: 0.24,
          mesh_density: 18,
          decay: 0.94,
        },
        status: 'Motion mode: Cruise',
      },
      {
        id: 'glide',
        label: 'Glide',
        fields: {
          wave_mode: 2,
          wave_mystery: 0.48,
          mesh_density: 24,
          decay: 0.93,
        },
        status: 'Motion mode: Glide',
      },
      {
        id: 'burst',
        label: 'Burst',
        fields: {
          wave_mode: 2,
          wave_mystery: 0.62,
          mesh_density: 30,
          decay: 0.9,
        },
        status: 'Motion mode: Burst',
      },
    ];
    const colorModes: PresetOption[] = [
      {
        id: 'steady',
        label: 'Steady',
        fields: {
          wave_r: 1,
          wave_g: 0.42,
          wave_b: 0.26,
          mesh_r: 0.34,
          mesh_g: 0.88,
          mesh_b: 1,
        },
        status: 'Color mode: Steady',
      },
      {
        id: 'neon',
        label: 'Neon',
        fields: {
          wave_r: 0.34,
          wave_g: 0.96,
          wave_b: 1,
          mesh_r: 0.24,
          mesh_g: 0.62,
          mesh_b: 1,
        },
        status: 'Color mode: Neon',
      },
      {
        id: 'prism',
        label: 'Prism',
        fields: {
          wave_r: 1,
          wave_g: 0.6,
          wave_b: 0.92,
          mesh_r: 0.7,
          mesh_g: 0.4,
          mesh_b: 1,
        },
        status: 'Color mode: Prism',
      },
    ];

    const stepper = createRotationStepper();
    const actionStepper = createPerformanceActionStepper();
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncColorButtons: (() => void) | null = null;
    const motionCycler = createOptionCycler({
      options: motionModes,
      initialId: 'burst',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
      },
    });
    const colorCycler = createOptionCycler({
      options: colorModes,
      initialId: 'steady',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
        syncColorButtons?.();
      },
    });

    return {
      setupPanel(panel, api) {
        applyFields = createQueuedFieldApplier(api);
        attachButtonGroup({
          panel,
          title: 'Motion mode',
          description: 'Cruise is calmer; Burst leans into speed and wobble.',
          options: motionModes,
          getActiveId: motionCycler.getActiveId,
          onChange: (id) => motionCycler.select(id),
        });
        syncColorButtons = attachButtonGroup({
          panel,
          title: 'Color drift',
          description:
            'Press Q/E on desktop or rotate with two fingers to cycle color modes.',
          options: colorModes,
          getActiveId: colorCycler.getActiveId,
          onChange: (id) => colorCycler.select(id),
        });
        void applyFields?.(motionModes[2].fields, motionModes[2].status);
        api.setStatus(
          'Move to steer the tunnel, drag to torque it, scroll to increase speed, then press 1/2/3 or Q/E for motion and color changes.',
        );
      },
      getSignalOverrides({ frame }) {
        return buildDesktopGestureSignalOverrides(frame, {
          wheelScaleSensitivity: 0.2,
          maxScaleOffset: 0.5,
        });
      },
      onFrame({ frame }) {
        handleDesktopPerformanceCycle({
          frame,
          rotationStepper: stepper,
          actionStepper,
          onNext: () => colorCycler.next(),
          onPrevious: () => colorCycler.previous(),
          onQuickLook: (index) => {
            motionCycler.select(
              motionModes[index]?.id ?? motionCycler.getActiveId(),
            );
          },
        });
      },
      dispose() {
        syncColorButtons = null;
      },
    };
  };
