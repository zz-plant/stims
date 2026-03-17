import type { PersistentSettingsPanel } from '../../../core/settings-panel';
import type { ToyRuntimeFrame } from '../../../core/toy-runtime';
import { createStatefulControlPanelButtonGroup } from '../../../utils/toy-settings';
import type {
  MilkdropPresetFieldValue,
  MilkdropPresetToyBehaviorApi,
} from '../../milkdrop-preset-behavior';

export type FieldMap = Record<string, MilkdropPresetFieldValue>;

export type PresetOption = {
  id: string;
  label: string;
  fields: FieldMap;
  status: string;
};

export function createQueuedFieldApplier(api: MilkdropPresetToyBehaviorApi) {
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

export function createRotationStepper(threshold = 0.45) {
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

export function createPerformanceActionStepper(threshold = 0.55) {
  const active = new Map<string, boolean>();
  const trigger = (id: string, value: number, action: () => void) => {
    const isActive = value >= threshold;
    if (isActive && !active.get(id)) {
      action();
    }
    active.set(id, isActive);
  };

  return {
    trigger,
    reset() {
      active.clear();
    },
  };
}

export function handleDesktopPerformanceCycle({
  frame,
  rotationStepper,
  actionStepper,
  onNext,
  onPrevious,
  onQuickLook,
}: {
  frame: ToyRuntimeFrame;
  rotationStepper: ReturnType<typeof createRotationStepper>;
  actionStepper: ReturnType<typeof createPerformanceActionStepper>;
  onNext: () => void;
  onPrevious: () => void;
  onQuickLook?: (index: number) => void;
}) {
  const state = frame.input;
  if (!state || state.pointerCount === 0) {
    rotationStepper.reset();
  } else {
    const gesture = state.gesture;
    if (gesture?.pointerCount && gesture.pointerCount >= 2) {
      rotationStepper.step(gesture.rotation, onNext, onPrevious);
    }
  }

  const actions = state?.performance.actions;
  if (!actions) {
    actionStepper.reset();
    return;
  }

  actionStepper.trigger('mode-next', actions.modeNext, onNext);
  actionStepper.trigger('mode-previous', actions.modePrevious, onPrevious);
  actionStepper.trigger('quick-1', actions.quickLook1, () => onQuickLook?.(0));
  actionStepper.trigger('quick-2', actions.quickLook2, () => onQuickLook?.(1));
  actionStepper.trigger('quick-3', actions.quickLook3, () => onQuickLook?.(2));
}

export function buildDesktopGestureSignalOverrides(
  frame: ToyRuntimeFrame,
  {
    wheelScaleSensitivity = 0.12,
    maxScaleOffset = 0.35,
  }: {
    wheelScaleSensitivity?: number;
    maxScaleOffset?: number;
  } = {},
) {
  const state = frame.input;
  if (!state) {
    return null;
  }

  if (state.gesture?.pointerCount && state.gesture.pointerCount >= 2) {
    return null;
  }

  const wheelScaleOffset = Math.max(
    -maxScaleOffset,
    Math.min(maxScaleOffset, state.performance.wheelAccum * wheelScaleSensitivity),
  );

  return {
    gestureScale: 1 + wheelScaleOffset,
    gesture_scale: 1 + wheelScaleOffset,
  };
}

export function attachButtonGroup({
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

export function createOptionCycler({
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
