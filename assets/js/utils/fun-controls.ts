const STYLE_ID = 'fun-controls-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .fun-controls {
      position: fixed;
      top: 12px;
      right: 12px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.6);
      color: #f2f2f2;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      z-index: 1000;
      min-width: 180px;
      backdrop-filter: blur(6px);
    }
    .fun-controls h3 {
      margin: 0 0 8px 0;
      font-size: 14px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .fun-controls label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 6px 0;
      font-size: 13px;
      gap: 8px;
    }
    .fun-controls input[type='checkbox'] {
      accent-color: #7cf0ff;
      width: 16px;
      height: 16px;
    }
    .fun-controls input[type='range'] {
      flex: 1;
      accent-color: #7cf0ff;
    }
    .fun-controls .control-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `;
  document.head.appendChild(style);
}

export class FunControls {
  private readonly container: HTMLDivElement;

  constructor(title = 'Fun Controls') {
    ensureStyles();
    this.container = document.createElement('div');
    this.container.className = 'fun-controls';

    const heading = document.createElement('h3');
    heading.textContent = title;
    this.container.appendChild(heading);

    document.body.appendChild(this.container);
  }

  addToggle(
    id: string,
    label: string,
    defaultValue: boolean,
    onChange: (value: boolean) => void
  ) {
    const wrapper = document.createElement('label');
    wrapper.htmlFor = id;
    wrapper.textContent = label;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = defaultValue;
    input.addEventListener('change', () => onChange(input.checked));

    wrapper.appendChild(input);
    this.container.appendChild(wrapper);
  }

  addRange(
    id: string,
    label: string,
    options: {
      min: number;
      max: number;
      step: number;
      defaultValue: number;
      onChange: (value: number) => void;
    }
  ) {
    const wrapper = document.createElement('label');
    wrapper.htmlFor = id;
    wrapper.textContent = label;

    const row = document.createElement('div');
    row.className = 'control-row';
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.value = String(options.defaultValue);

    const valueLabel = document.createElement('span');
    valueLabel.textContent = options.defaultValue.toFixed(2);

    input.addEventListener('input', () => {
      const val = Number(input.value);
      valueLabel.textContent = val.toFixed(2);
      options.onChange(val);
    });

    row.appendChild(input);
    row.appendChild(valueLabel);
    wrapper.appendChild(row);
    this.container.appendChild(wrapper);
  }
}
