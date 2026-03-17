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
    const actionStepper = createPerformanceActionStepper();
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
          description:
            'Press Q/E on desktop or rotate with two fingers to cycle palette moods.',
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
        api.setStatus(
          'Move to shape the currents, drag to push the pool, scroll to brighten the lift, then press 1/2/3 or Q/E to shift the tide.',
        );
      },
      getSignalOverrides({ frame }) {
        return buildDesktopGestureSignalOverrides(frame, {
          wheelScaleSensitivity: 0.18,
          maxScaleOffset: 0.44,
        });
      },
      onFrame({ frame }) {
        handleDesktopPerformanceCycle({
          frame,
          rotationStepper: stepper,
          actionStepper,
          onNext: () => moodCycler.next(),
          onPrevious: () => moodCycler.previous(),
          onQuickLook: (index) => {
            currentCycler.select(
              currentModes[index]?.id ?? currentCycler.getActiveId(),
            );
          },
        });
      },
      dispose() {
        syncMoodButtons = null;
      },
    };
  };
