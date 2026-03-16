import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  createOptionCycler,
  createQueuedFieldApplier,
  createRotationStepper,
  type PresetOption,
} from './shared';

export const createSpiralBurstBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const modes: PresetOption[] = [
      {
        id: 'burst',
        label: 'Burst',
        fields: {
          wave_mode: 2,
          wave_mystery: 0.42,
          mesh_density: 18,
          decay: 0.92,
        },
        status: 'Spiral mode: Burst',
      },
      {
        id: 'bloom',
        label: 'Bloom',
        fields: {
          wave_mode: 1,
          wave_mystery: 0.24,
          mesh_density: 15,
          decay: 0.95,
        },
        status: 'Spiral mode: Bloom',
      },
      {
        id: 'vortex',
        label: 'Vortex',
        fields: {
          wave_mode: 2,
          wave_mystery: 0.54,
          mesh_density: 22,
          decay: 0.91,
        },
        status: 'Spiral mode: Vortex',
      },
      {
        id: 'heartbeat',
        label: 'Heartbeat',
        fields: {
          wave_mode: 0,
          wave_mystery: 0.16,
          mesh_density: 16,
          decay: 0.94,
        },
        status: 'Spiral mode: Heartbeat',
      },
    ];
    const palettes: PresetOption[] = [
      {
        id: 'magenta',
        label: 'Magenta',
        fields: {
          bg_r: 0.04,
          bg_g: 0.01,
          bg_b: 0.08,
          wave_r: 1,
          wave_g: 0.5,
          wave_b: 0.72,
        },
        status: 'Spiral palette: Magenta',
      },
      {
        id: 'solar',
        label: 'Solar',
        fields: {
          bg_r: 0.08,
          bg_g: 0.03,
          bg_b: 0.02,
          wave_r: 1,
          wave_g: 0.72,
          wave_b: 0.4,
        },
        status: 'Spiral palette: Solar',
      },
      {
        id: 'cyber',
        label: 'Cyber',
        fields: {
          bg_r: 0.02,
          bg_g: 0.03,
          bg_b: 0.09,
          wave_r: 0.56,
          wave_g: 0.78,
          wave_b: 1,
        },
        status: 'Spiral palette: Cyber',
      },
    ];

    const stepper = createRotationStepper();
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncPaletteButtons: (() => void) | null = null;
    const modeCycler = createOptionCycler({
      options: modes,
      initialId: 'burst',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
      },
    });
    const paletteCycler = createOptionCycler({
      options: palettes,
      initialId: 'magenta',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
        syncPaletteButtons?.();
      },
    });

    return {
      setupPanel(panel, api) {
        applyFields = createQueuedFieldApplier(api);
        attachButtonGroup({
          panel,
          title: 'Spiral mode',
          description:
            'Switch burst profile without leaving the preset runtime.',
          options: modes,
          getActiveId: modeCycler.getActiveId,
          onChange: (id) => modeCycler.select(id),
        });
        syncPaletteButtons = attachButtonGroup({
          panel,
          title: 'Spiral palette',
          description: 'Rotate with two fingers to cycle palettes.',
          options: palettes,
          getActiveId: paletteCycler.getActiveId,
          onChange: (id) => paletteCycler.select(id),
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
          () => paletteCycler.next(),
          () => paletteCycler.previous(),
        );
      },
      dispose() {
        syncPaletteButtons = null;
      },
    };
  };
