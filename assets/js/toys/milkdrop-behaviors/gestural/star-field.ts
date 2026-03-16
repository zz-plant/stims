import type { MilkdropPresetToyBehaviorFactory } from '../../milkdrop-preset-behavior';
import {
  attachButtonGroup,
  createOptionCycler,
  createQueuedFieldApplier,
  createRotationStepper,
  type PresetOption,
} from './shared';

export const createStarFieldBehavior: MilkdropPresetToyBehaviorFactory = () => {
  const intensityModes: PresetOption[] = [
    {
      id: 'calm',
      label: 'Calm',
      fields: {
        wave_scale: 0.72,
        wave_a: 0.55,
        mesh_density: 10,
        warp: 0.04,
      },
      status: 'Sky intensity: Calm',
    },
    {
      id: 'vivid',
      label: 'Vivid',
      fields: {
        wave_scale: 0.9,
        wave_a: 0.7,
        mesh_density: 13,
        warp: 0.06,
      },
      status: 'Sky intensity: Vivid',
    },
    {
      id: 'pulse',
      label: 'Pulse',
      fields: {
        wave_scale: 1.05,
        wave_a: 0.82,
        mesh_density: 16,
        warp: 0.09,
      },
      status: 'Sky intensity: Pulse',
    },
  ];
  const palettes: PresetOption[] = [
    {
      id: 'night',
      label: 'Night',
      fields: {
        bg_r: 0.01,
        bg_g: 0.02,
        bg_b: 0.05,
        wave_r: 0.74,
        wave_g: 0.84,
        wave_b: 1,
      },
      status: 'Sky palette: Night',
    },
    {
      id: 'violet',
      label: 'Violet',
      fields: {
        bg_r: 0.03,
        bg_g: 0.02,
        bg_b: 0.08,
        wave_r: 0.9,
        wave_g: 0.7,
        wave_b: 1,
      },
      status: 'Sky palette: Violet',
    },
    {
      id: 'ember',
      label: 'Ember',
      fields: {
        bg_r: 0.06,
        bg_g: 0.02,
        bg_b: 0.04,
        wave_r: 1,
        wave_g: 0.72,
        wave_b: 0.58,
      },
      status: 'Sky palette: Ember',
    },
  ];

  const stepper = createRotationStepper();
  let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
  let pulseLabel: HTMLElement | null = null;
  let syncPaletteButtons: (() => void) | null = null;

  const intensityCycler = createOptionCycler({
    options: intensityModes,
    initialId: 'vivid',
    applyOption: (option) => {
      applyFields?.(option.fields, option.status);
    },
  });
  const paletteCycler = createOptionCycler({
    options: palettes,
    initialId: 'night',
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
        title: 'Sky intensity',
        description:
          'Calm for slow drift, Pulse for stronger motion and twinkle.',
        options: intensityModes,
        getActiveId: intensityCycler.getActiveId,
        onChange: (id) => intensityCycler.select(id),
      });
      syncPaletteButtons = attachButtonGroup({
        panel,
        title: 'Sky palette',
        description: 'Rotate with two fingers to step through palette moods.',
        options: palettes,
        getActiveId: paletteCycler.getActiveId,
        onChange: (id) => paletteCycler.select(id),
      });
      const section = panel.addSection(
        'Pulse meter',
        'Shows live activity from the current audio source.',
      );
      pulseLabel = document.createElement('span');
      pulseLabel.className = 'control-panel__microcopy';
      pulseLabel.textContent = 'Pulse: warming up';
      section.appendChild(pulseLabel);
      void applyFields?.(intensityModes[1].fields, intensityModes[1].status);
      api.setStatus(
        'Sky controls ready. Drag, pinch, and rotate to steer the scene.',
      );
    },
    onFrame({ frame }) {
      if (pulseLabel) {
        const data = frame.frequencyData;
        const limit = Math.min(data.length, 96);
        let sum = 0;
        for (let index = 0; index < limit; index += 1) {
          sum += data[index] ?? 0;
        }
        const pulse = Math.round((sum / Math.max(limit, 1) / 255) * 100);
        pulseLabel.textContent = `Pulse: ${pulse}%`;
      }

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
      pulseLabel = null;
      syncPaletteButtons = null;
    },
  };
};
