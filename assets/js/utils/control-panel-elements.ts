type SliderOptions = {
  min: number;
  max: number;
  step: number;
  value: number;
  ariaLabel: string;
  className?: string;
  onInput: (value: number) => void;
};

type CheckboxOptions = {
  id: string;
  label: string;
  checked: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
};

type NoteOptions = {
  text: string;
  className?: string;
};

export function createControlPanelSlider({
  min,
  max,
  step,
  value,
  ariaLabel,
  className = 'control-panel__slider',
  onInput,
}: SliderOptions) {
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min.toString();
  slider.max = max.toString();
  slider.step = step.toString();
  slider.value = value.toString();
  slider.setAttribute('aria-label', ariaLabel);
  slider.className = className;
  slider.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    onInput(Number(target.value));
  });
  return slider;
}

export function createControlPanelCheckbox({
  id,
  label,
  checked,
  className = 'control-panel__checkbox-inline',
  onChange,
}: CheckboxOptions) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;

  const toggle = document.createElement('label');
  toggle.className = className;
  toggle.htmlFor = id;
  toggle.textContent = label;
  toggle.prepend(input);

  input.addEventListener('change', () => onChange(input.checked));

  return { input, toggle };
}

export function createControlPanelNote({
  text,
  className = 'control-panel__note',
}: NoteOptions) {
  const note = document.createElement('p');
  note.className = className;
  note.textContent = text;
  return note;
}
