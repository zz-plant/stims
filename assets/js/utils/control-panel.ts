import { getSettingsPanel } from '../core/settings-panel';
import { isMobileDevice } from './device-detect';

export type ControlPanelState = {
  idleEnabled: boolean;
  paletteCycle: boolean;
  mobilePreset: boolean;
};

type ChangeHandler = (state: ControlPanelState) => void;
type ToggleConfig = {
  key: keyof ControlPanelState;
  label: string;
  description: string;
};

const isMobile = isMobileDevice();

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

  const toggleConfigs: ToggleConfig[] = [
    {
      key: 'idleEnabled',
      label: 'Idle visuals',
      description:
        'Tweak how the scene behaves when the mic is quiet. Desktop defaults stay vivid; mobile trims intensity.',
    },
    {
      key: 'paletteCycle',
      label: 'Palette drift',
      description: 'Slow hue cycling that eases when sound returns.',
    },
    {
      key: 'mobilePreset',
      label: 'Mobile-friendly idle',
      description: 'Lowers drift and wobble for handheld devices.',
    },
  ];

  function addToggle({ key, label, description }: ToggleConfig) {
    settingsPanel.addToggle({
      label,
      description,
      defaultValue: state[key],
      onChange: (value) => {
        state[key] = value;
        emit();
      },
    });
  }

  toggleConfigs.forEach(addToggle);

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
