import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  createOptionCycler,
  createQueuedFieldApplier,
  createRotationStepper,
  type PresetOption,
} from './shared';

export const createAuroraPainterBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const quickPresets: PresetOption[] = [
      {
        id: 'starter',
        label: 'Starter',
        fields: {
          wave_scale: 1.1,
          warp: 0.1,
          rot: 0.006,
          wave_a: 0.84,
          mesh_alpha: 0.16,
        },
        status: 'Aurora preset: Starter',
      },
      {
        id: 'drift',
        label: 'Drift',
        fields: {
          wave_scale: 0.9,
          warp: 0.06,
          rot: 0.002,
          wave_a: 0.72,
          mesh_alpha: 0.1,
        },
        status: 'Aurora preset: Drift',
      },
      {
        id: 'bright',
        label: 'Bright',
        fields: {
          wave_scale: 1.3,
          warp: 0.14,
          rot: 0.01,
          wave_a: 0.94,
          mesh_alpha: 0.2,
        },
        status: 'Aurora preset: Bright',
      },
    ];
    const palettes: PresetOption[] = [
      {
        id: 'nocturne',
        label: 'Nocturne',
        fields: {
          bg_r: 0.02,
          bg_g: 0.05,
          bg_b: 0.08,
          wave_r: 0.54,
          wave_g: 0.96,
          wave_b: 0.84,
          shape_1_r: 0.46,
          shape_1_g: 0.92,
          shape_1_b: 0.84,
          shape_2_r: 0.76,
          shape_2_g: 0.64,
          shape_2_b: 1,
        },
        status: 'Aurora palette: Nocturne',
      },
      {
        id: 'daybreak',
        label: 'Daybreak',
        fields: {
          bg_r: 0.03,
          bg_g: 0.04,
          bg_b: 0.09,
          wave_r: 0.95,
          wave_g: 0.64,
          wave_b: 0.38,
          shape_1_r: 0.98,
          shape_1_g: 0.78,
          shape_1_b: 0.5,
          shape_2_r: 1,
          shape_2_g: 0.56,
          shape_2_b: 0.42,
        },
        status: 'Aurora palette: Daybreak',
      },
      {
        id: 'electric',
        label: 'Electric',
        fields: {
          bg_r: 0.01,
          bg_g: 0.04,
          bg_b: 0.12,
          wave_r: 0.4,
          wave_g: 0.78,
          wave_b: 1,
          shape_1_r: 0.34,
          shape_1_g: 0.82,
          shape_1_b: 1,
          shape_2_r: 0.52,
          shape_2_g: 0.72,
          shape_2_b: 1,
        },
        status: 'Aurora palette: Electric',
      },
      {
        id: 'violet',
        label: 'Violet',
        fields: {
          bg_r: 0.05,
          bg_g: 0.02,
          bg_b: 0.1,
          wave_r: 0.78,
          wave_g: 0.54,
          wave_b: 1,
          shape_1_r: 0.72,
          shape_1_g: 0.52,
          shape_1_b: 1,
          shape_2_r: 0.9,
          shape_2_g: 0.72,
          shape_2_b: 1,
        },
        status: 'Aurora palette: Violet',
      },
    ];

    const stepper = createRotationStepper();
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncPaletteButtons: (() => void) | null = null;

    const quickCycler = createOptionCycler({
      options: quickPresets,
      initialId: 'starter',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
      },
    });
    const paletteCycler = createOptionCycler({
      options: palettes,
      initialId: 'nocturne',
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
          title: 'Quick preset',
          description: 'Starter is balanced, then drift or brighten as needed.',
          options: quickPresets,
          getActiveId: quickCycler.getActiveId,
          onChange: (id) => quickCycler.select(id),
        });
        syncPaletteButtons = attachButtonGroup({
          panel,
          title: 'Color mood',
          description: 'Rotate with two fingers to cycle moods while playing.',
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
          () => {
            paletteCycler.next();
          },
          () => {
            paletteCycler.previous();
          },
        );
      },
      dispose() {
        syncPaletteButtons = null;
      },
    };
  };
