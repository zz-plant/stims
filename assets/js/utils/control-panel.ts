import { getSettingsPanel } from '../core/settings-panel';

export type ControlPanelState = {
  idleEnabled: boolean;
  paletteCycle: boolean;
  mobilePreset: boolean;
};

type ChangeHandler = (state: ControlPanelState) => void;

const isMobile =
  typeof navigator !== 'undefined' &&
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

export function createControlPanel(initial: Partial<ControlPanelState> = {}) {
  const state: ControlPanelState = {
    idleEnabled: initial.idleEnabled ?? !isMobile,
    paletteCycle: initial.paletteCycle ?? true,
    mobilePreset: initial.mobilePreset ?? isMobile,
  };

  const listeners: ChangeHandler[] = [];
  const settingsPanel = getSettingsPanel();
  const panel = settingsPanel.getElement();

  settingsPanel.configure({
    title: 'Toy settings',
  });

  settingsPanel.addToggle({
    label: 'Idle visuals',
    description:
      'Tweak how the scene behaves when the mic is quiet. Desktop defaults stay vivid; mobile trims intensity.',
    defaultValue: state.idleEnabled,
    onChange: (value) => {
      state.idleEnabled = value;
      emit();
    },
  });

  settingsPanel.addToggle({
    label: 'Palette drift',
    description: 'Slow hue cycling that eases when sound returns.',
    defaultValue: state.paletteCycle,
    onChange: (value) => {
      state.paletteCycle = value;
      emit();
    },
  });

  settingsPanel.addToggle({
    label: 'Mobile-friendly idle',
    description: 'Lowers drift and wobble for handheld devices.',
    defaultValue: state.mobilePreset,
    onChange: (value) => {
      state.mobilePreset = value;
      emit();
    },
  });

  function emit() {
    listeners.forEach((cb) => cb({ ...state }));
  }

  function onChange(cb: ChangeHandler) {
    listeners.push(cb);
  }

  function getState(): ControlPanelState {
    return { ...state };
  }

  return { panel, getState, onChange };
}
