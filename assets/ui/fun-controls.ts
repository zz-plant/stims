export type PaletteName = 'bright' | 'pastel' | 'neon';
export type MotionMode = 'calm' | 'party';

export interface FunControlState {
  palette: PaletteName;
  motion: number; // 0 - 1
  mode: MotionMode;
  audioReactive: boolean;
}

export interface FunControlOptions {
  container?: HTMLElement;
  initialState?: Partial<FunControlState>;
  audioAvailable?: boolean;
  onPaletteChange?: (palette: PaletteName) => void;
  onMotionChange?: (intensity: number, mode: MotionMode) => void;
  onAudioReactiveChange?: (enabled: boolean) => void;
}

export interface FunControlHandles {
  root: HTMLElement;
  state: FunControlState;
  setAudioAvailable: (available: boolean) => void;
  setState: (next: Partial<FunControlState>) => void;
}

export const FUN_PALETTES: Record<PaletteName, string[]> = {
  bright: ['#ff6b6b', '#ffd166', '#4ecdc4', '#5c7cfa', '#f06595'],
  pastel: ['#ffd1dc', '#c3f0ca', '#cce7ff', '#ffe6a7', '#d7bde2'],
  neon: ['#39ff14', '#ff0099', '#00e5ff', '#f6ff00', '#ff6ec7'],
};

function injectStyles() {
  const styleId = 'fun-controls-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
      .fun-controls-panel {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        z-index: 30;
        background: rgba(8, 8, 12, 0.88);
        color: #f5f5f5;
        padding: 0.9rem;
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(6px);
        max-width: 320px;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .fun-controls-panel h3 {
        margin: 0 0 0.5rem;
        font-size: 0.95rem;
        letter-spacing: 0.02em;
      }
      .fun-controls-panel .fun-row {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.35rem;
        margin-bottom: 0.65rem;
      }
      .fun-controls-panel label {
        font-size: 0.85rem;
        color: #d6d6d6;
      }
      .fun-controls-panel select,
      .fun-controls-panel input[type='range'],
      .fun-controls-panel button,
      .fun-controls-panel input[type='checkbox'] {
        width: 100%;
      }
      .fun-controls-panel select,
      .fun-controls-panel input[type='range'],
      .fun-controls-panel button {
        background: rgba(255, 255, 255, 0.06);
        color: #f5f5f5;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        padding: 0.5rem 0.6rem;
        font-size: 0.9rem;
        transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
      }
      .fun-controls-panel select:focus,
      .fun-controls-panel input[type='range']:focus,
      .fun-controls-panel button:focus,
      .fun-controls-panel input[type='checkbox']:focus-visible {
        outline: 2px solid #7ad7f0;
        outline-offset: 2px;
      }
      .fun-controls-panel button:hover {
        background: rgba(255, 255, 255, 0.12);
        transform: translateY(-1px);
      }
      .fun-controls-panel .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.9rem;
      }
      .fun-controls-panel .toggle-row label {
        margin: 0;
      }
      .fun-controls-panel .mode-button {
        text-transform: capitalize;
      }
      .fun-controls-panel .audio-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .fun-controls-panel .hint {
        font-size: 0.78rem;
        color: #a8b2c1;
        margin: 0.1rem 0 0;
      }
      @media (max-width: 720px) {
        .fun-controls-panel {
          left: 0.5rem;
          right: 0.5rem;
          bottom: 0.5rem;
          max-width: none;
        }
      }
    `;

  document.head.append(style);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function initFunControls(
  options: FunControlOptions = {}
): FunControlHandles {
  if (typeof document === 'undefined') {
    throw new Error('fun-controls requires a DOM to render controls.');
  }

  injectStyles();

  const container = options.container ?? document.body;
  const state: FunControlState = {
    palette: options.initialState?.palette ?? 'bright',
    motion: clamp01(options.initialState?.motion ?? 0.6),
    mode: options.initialState?.mode ?? 'calm',
    audioReactive: options.initialState?.audioReactive ?? true,
  };

  const panel = document.createElement('section');
  panel.className = 'fun-controls-panel';
  panel.setAttribute('aria-label', 'Visualizer controls');

  const title = document.createElement('h3');
  title.textContent = 'Fun Controls';
  panel.append(title);

  const paletteRow = document.createElement('div');
  paletteRow.className = 'fun-row';
  const paletteLabel = document.createElement('label');
  paletteLabel.textContent = 'Color palette';
  paletteLabel.htmlFor = 'fun-palette-select';
  const paletteSelect = document.createElement('select');
  paletteSelect.id = 'fun-palette-select';
  paletteSelect.name = 'fun-palette-select';
  (['bright', 'pastel', 'neon'] as PaletteName[]).forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    paletteSelect.append(option);
  });
  paletteSelect.value = state.palette;
  paletteRow.append(paletteLabel, paletteSelect);
  panel.append(paletteRow);

  const motionRow = document.createElement('div');
  motionRow.className = 'fun-row';
  const motionLabel = document.createElement('label');
  motionLabel.textContent = 'Motion intensity';
  motionLabel.htmlFor = 'fun-motion-range';
  const motionRange = document.createElement('input');
  motionRange.type = 'range';
  motionRange.id = 'fun-motion-range';
  motionRange.min = '0';
  motionRange.max = '100';
  motionRange.value = String(Math.round(state.motion * 100));
  motionRange.step = '1';
  const motionHint = document.createElement('p');
  motionHint.className = 'hint';
  const calmPartyButton = document.createElement('button');
  calmPartyButton.type = 'button';
  calmPartyButton.className = 'mode-button';
  calmPartyButton.ariaPressed = String(state.mode === 'party');
  calmPartyButton.textContent = state.mode === 'party' ? 'Party' : 'Calm';

  motionRow.append(motionLabel, motionRange, calmPartyButton, motionHint);
  panel.append(motionRow);

  const audioRow = document.createElement('div');
  audioRow.className = 'toggle-row';
  const audioLabel = document.createElement('label');
  audioLabel.textContent = 'Audio-reactive';
  audioLabel.htmlFor = 'fun-audio-toggle';
  const audioToggleWrapper = document.createElement('div');
  audioToggleWrapper.className = 'audio-toggle';
  const audioToggle = document.createElement('input');
  audioToggle.type = 'checkbox';
  audioToggle.id = 'fun-audio-toggle';
  audioToggle.checked = state.audioReactive;
  const audioStatus = document.createElement('span');
  audioStatus.textContent = state.audioReactive ? 'Enabled' : 'Disabled';
  audioToggleWrapper.append(audioToggle, audioStatus);
  audioRow.append(audioLabel, audioToggleWrapper);
  panel.append(audioRow);

  function updateMotionHint() {
    const level = Math.round(state.motion * 100);
    const modeLabel = state.mode === 'party' ? 'party' : 'calm';
    motionHint.textContent = `${modeLabel} · ${level}% intensity`;
  }

  function emitPalette() {
    options.onPaletteChange?.(state.palette);
  }
  function emitMotion() {
    options.onMotionChange?.(state.motion, state.mode);
    updateMotionHint();
  }
  function emitAudio() {
    options.onAudioReactiveChange?.(state.audioReactive);
    audioStatus.textContent = state.audioReactive ? 'Enabled' : 'Disabled';
  }

  paletteSelect.addEventListener('change', () => {
    state.palette = paletteSelect.value as PaletteName;
    emitPalette();
  });

  motionRange.addEventListener('input', () => {
    state.motion = clamp01(Number(motionRange.value) / 100);
    emitMotion();
  });

  calmPartyButton.addEventListener('click', () => {
    state.mode = state.mode === 'party' ? 'calm' : 'party';
    calmPartyButton.textContent = state.mode === 'party' ? 'Party' : 'Calm';
    calmPartyButton.ariaPressed = String(state.mode === 'party');
    emitMotion();
  });

  audioToggle.addEventListener('change', () => {
    state.audioReactive = audioToggle.checked;
    emitAudio();
  });

  updateMotionHint();
  emitPalette();
  emitMotion();
  emitAudio();

  container.append(panel);

  function setAudioAvailable(available: boolean) {
    audioToggle.disabled = !available;
    audioStatus.textContent = available
      ? state.audioReactive
        ? 'Enabled'
        : 'Disabled'
      : 'Unavailable';
    if (!available) {
      audioToggle.checked = false;
      state.audioReactive = false;
      options.onAudioReactiveChange?.(false);
    }
  }

  function setState(next: Partial<FunControlState>) {
    if (next.palette) {
      state.palette = next.palette;
      paletteSelect.value = state.palette;
      emitPalette();
    }
    if (typeof next.motion === 'number') {
      state.motion = clamp01(next.motion);
      motionRange.value = String(Math.round(state.motion * 100));
      emitMotion();
    }
    if (next.mode) {
      state.mode = next.mode;
      calmPartyButton.textContent = state.mode === 'party' ? 'Party' : 'Calm';
      calmPartyButton.ariaPressed = String(state.mode === 'party');
      emitMotion();
    }
    if (typeof next.audioReactive === 'boolean') {
      state.audioReactive = next.audioReactive;
      audioToggle.checked = state.audioReactive;
      emitAudio();
    }
  }

  if (options.audioAvailable === false) {
    setAudioAvailable(false);
  }

  return { root: panel, state, setAudioAvailable, setState };
}
