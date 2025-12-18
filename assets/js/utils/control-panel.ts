export type ControlPanelState = {
  idleEnabled: boolean;
  paletteCycle: boolean;
  mobilePreset: boolean;
};

type ChangeHandler = (state: ControlPanelState) => void;

const isMobile =
  typeof navigator !== 'undefined' &&
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

function createToggle(
  label: string,
  checked: boolean,
  description: string,
  onChange: (value: boolean) => void
) {
  const wrapper = document.createElement('label');
  wrapper.className = 'control-panel__row';

  const text = document.createElement('div');
  text.className = 'control-panel__text';
  text.innerHTML = `<span class="control-panel__label">${label}</span><small>${description}</small>`;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));

  wrapper.appendChild(text);
  wrapper.appendChild(input);
  return { wrapper, input };
}

export function createControlPanel(initial: Partial<ControlPanelState> = {}) {
  const state: ControlPanelState = {
    idleEnabled: initial.idleEnabled ?? !isMobile,
    paletteCycle: initial.paletteCycle ?? true,
    mobilePreset: initial.mobilePreset ?? isMobile,
  };

  const listeners: ChangeHandler[] = [];
  const panel = document.createElement('div');
  panel.className = 'control-panel';

  const heading = document.createElement('div');
  heading.className = 'control-panel__heading';
  heading.textContent = 'Idle Controls';

  const description = document.createElement('p');
  description.className = 'control-panel__description';
  description.textContent =
    'Tweak how the scene behaves when the mic is quiet. Desktop defaults stay vivid; mobile trims intensity.';

  const idleToggle = createToggle(
    'Idle visuals',
    state.idleEnabled,
    'Subtle motion and gradients while audio is quiet.',
    (value) => {
      state.idleEnabled = value;
      emit();
    }
  );

  const paletteToggle = createToggle(
    'Palette drift',
    state.paletteCycle,
    'Slow hue cycling that eases when sound returns.',
    (value) => {
      state.paletteCycle = value;
      emit();
    }
  );

  const mobileToggle = createToggle(
    'Mobile-friendly idle',
    state.mobilePreset,
    'Lowers drift and wobble for handheld devices.',
    (value) => {
      state.mobilePreset = value;
      emit();
    }
  );

  [
    heading,
    description,
    idleToggle.wrapper,
    paletteToggle.wrapper,
    mobileToggle.wrapper,
  ].forEach((el) => panel.appendChild(el));

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
