import type { PersistentSettingsPanel } from '../../../core/settings-panel';
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
