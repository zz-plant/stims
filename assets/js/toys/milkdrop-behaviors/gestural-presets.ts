import type { PersistentSettingsPanel } from '../../core/settings-panel';
import { createStatefulControlPanelButtonGroup } from '../../utils/toy-settings';
import type {
  MilkdropPresetFieldValue,
  MilkdropPresetToyBehaviorApi,
  MilkdropPresetToyBehaviorFactory,
} from '../milkdrop-preset-behavior';

type FieldMap = Record<string, MilkdropPresetFieldValue>;

type PresetOption = {
  id: string;
  label: string;
  fields: FieldMap;
  status: string;
};

function createQueuedFieldApplier(api: MilkdropPresetToyBehaviorApi) {
  let queue = Promise.resolve();
  return (fields: FieldMap, status: string) => {
    queue = queue
      .then(async () => {
        await api.applyFields(fields);
        api.setStatus(status);
      })
      .catch(() => {});
    return queue;
  };
}

function createRotationStepper(threshold = 0.45) {
  let latch = 0;
  return {
    reset() {
      latch = 0;
    },
    step(rotation: number, onPositive: () => void, onNegative: () => void) {
      if (latch <= threshold && rotation > threshold) {
        onPositive();
      } else if (latch >= -threshold && rotation < -threshold) {
        onNegative();
      }
      latch = rotation;
    },
  };
}

function attachButtonGroup({
  panel,
  title,
  description,
  options,
  getActiveId,
  onChange,
}: {
  panel: PersistentSettingsPanel;
  title: string;
  description: string;
  options: Array<{ id: string; label: string }>;
  getActiveId: () => string;
  onChange: (id: string) => void;
}) {
  const section = panel.addSection(title, description);
  const group = createStatefulControlPanelButtonGroup({
    panel: section,
    options,
    getActiveId,
    onChange,
    buttonClassName: 'cta-button',
    activeClassName: 'active',
    setDisabledOnActive: true,
    setAriaPressed: false,
  });
  return () => group.sync();
}

function createOptionCycler({
  options,
  initialId,
  applyOption,
}: {
  options: PresetOption[];
  initialId: string;
  applyOption: (option: PresetOption) => void;
}) {
  let activeId = initialId;

  const select = (id: string) => {
    const option = options.find((entry) => entry.id === id);
    if (!option || option.id === activeId) {
      return;
    }
    activeId = option.id;
    applyOption(option);
  };

  const indexOfActive = () => {
    const index = options.findIndex((entry) => entry.id === activeId);
    return index >= 0 ? index : 0;
  };

  const next = () => {
    const nextIndex = (indexOfActive() + 1) % options.length;
    select(options[nextIndex]?.id ?? activeId);
  };

  const previous = () => {
    const nextIndex = (indexOfActive() - 1 + options.length) % options.length;
    select(options[nextIndex]?.id ?? activeId);
  };

  return {
    getActiveId: () => activeId,
    select,
    next,
    previous,
  };
}

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
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncColorButtons: (() => void) | null = null;
    const motionCycler = createOptionCycler({
      options: motionModes,
      initialId: 'glide',
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
          description: 'Rotate with two fingers to cycle color modes.',
          options: colorModes,
          getActiveId: colorCycler.getActiveId,
          onChange: (id) => colorCycler.select(id),
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
          () => colorCycler.next(),
          () => colorCycler.previous(),
        );
      },
      dispose() {
        syncColorButtons = null;
      },
    };
  };

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

export const createBioluminescentTidepoolsBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const moods: PresetOption[] = [
      {
        id: 'nocturne',
        label: 'Nocturne',
        fields: {
          bg_r: 0.01,
          bg_g: 0.08,
          bg_b: 0.09,
          wave_r: 0.3,
          wave_g: 0.92,
          wave_b: 0.86,
          mesh_r: 0.18,
          mesh_g: 0.74,
          mesh_b: 0.82,
        },
        status: 'Tidepool mood: Nocturne',
      },
      {
        id: 'lagoon',
        label: 'Lagoon',
        fields: {
          bg_r: 0.01,
          bg_g: 0.1,
          bg_b: 0.06,
          wave_r: 0.34,
          wave_g: 0.96,
          wave_b: 0.74,
          mesh_r: 0.24,
          mesh_g: 0.8,
          mesh_b: 0.66,
        },
        status: 'Tidepool mood: Lagoon',
      },
      {
        id: 'ember',
        label: 'Ember',
        fields: {
          bg_r: 0.08,
          bg_g: 0.03,
          bg_b: 0.05,
          wave_r: 1,
          wave_g: 0.58,
          wave_b: 0.5,
          mesh_r: 0.9,
          mesh_g: 0.44,
          mesh_b: 0.52,
        },
        status: 'Tidepool mood: Ember',
      },
      {
        id: 'aurora',
        label: 'Aurora',
        fields: {
          bg_r: 0.03,
          bg_g: 0.04,
          bg_b: 0.11,
          wave_r: 0.6,
          wave_g: 0.7,
          wave_b: 1,
          mesh_r: 0.44,
          mesh_g: 0.58,
          mesh_b: 0.96,
        },
        status: 'Tidepool mood: Aurora',
      },
    ];
    const currentModes: PresetOption[] = [
      {
        id: 'gentle',
        label: 'Gentle',
        fields: {
          rot: 0.002,
          warp: 0.07,
          decay: 0.97,
        },
        status: 'Current profile: Gentle',
      },
      {
        id: 'flow',
        label: 'Flow',
        fields: {
          rot: 0.004,
          warp: 0.09,
          decay: 0.96,
        },
        status: 'Current profile: Flow',
      },
      {
        id: 'surge',
        label: 'Surge',
        fields: {
          rot: 0.008,
          warp: 0.14,
          decay: 0.93,
        },
        status: 'Current profile: Surge',
      },
    ];

    const stepper = createRotationStepper();
    let applyFields: ReturnType<typeof createQueuedFieldApplier> | null = null;
    let syncMoodButtons: (() => void) | null = null;
    const moodCycler = createOptionCycler({
      options: moods,
      initialId: 'nocturne',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
        syncMoodButtons?.();
      },
    });
    const currentCycler = createOptionCycler({
      options: currentModes,
      initialId: 'flow',
      applyOption: (option) => {
        applyFields?.(option.fields, option.status);
      },
    });

    return {
      setupPanel(panel, api) {
        applyFields = createQueuedFieldApplier(api);
        syncMoodButtons = attachButtonGroup({
          panel,
          title: 'Tidepool mood',
          description: 'Rotate with two fingers to cycle palette moods.',
          options: moods,
          getActiveId: moodCycler.getActiveId,
          onChange: (id) => moodCycler.select(id),
        });
        attachButtonGroup({
          panel,
          title: 'Current profile',
          description: 'Tune how strongly the currents drift across the field.',
          options: currentModes,
          getActiveId: currentCycler.getActiveId,
          onChange: (id) => currentCycler.select(id),
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
          () => moodCycler.next(),
          () => moodCycler.previous(),
        );
      },
      dispose() {
        syncMoodButtons = null;
      },
    };
  };
