export type PaletteOption = 'bright' | 'pastel' | 'neon';

export interface FunControlsCallbacks {
  onPaletteChange?: (palette: PaletteOption, colors: string[]) => void;
  onMotionChange?: (intensity: number, mode: 'calm' | 'party') => void;
  onAudioToggle?: (enabled: boolean) => void;
  onSparkleToggle?: (enabled: boolean) => void;
  onBurstToggle?: (enabled: boolean) => void;
  onPeakSensitivityChange?: (value: number) => void;
}

export interface FunControlsInit extends FunControlsCallbacks {
  paletteOptions?: Record<PaletteOption, string[]>;
  initialPalette?: PaletteOption;
  initialMotion?: number;
  initialMode?: 'calm' | 'party';
  audioAvailable?: boolean;
  audioEnabled?: boolean;
  initialSparklesEnabled?: boolean;
  initialBurstsEnabled?: boolean;
  initialPeakSensitivity?: number;
}

const defaultPalettes: Record<PaletteOption, string[]> = {
  bright: ['#ff3366', '#ffd166', '#33ffcc'],
  pastel: ['#f4b6c2', '#c9e4de', '#faedcb'],
  neon: ['#39ff14', '#00f0ff', '#ff00ff'],
};

function ensureStyles() {
  if (document.getElementById('fun-controls-style')) return;

  const style = document.createElement('style');
  style.id = 'fun-controls-style';
  style.textContent = `
      .fun-controls {
        position: fixed;
        bottom: 1rem;
        right: 1rem;
        display: grid;
        gap: 0.5rem;
        padding: 0.75rem;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        backdrop-filter: blur(8px);
        color: #f5f5f5;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        min-width: 240px;
        z-index: 20;
      }
      .fun-controls label {
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .fun-controls fieldset {
        border: none;
        padding: 0;
        margin: 0;
        display: flex;
        gap: 0.25rem;
        justify-content: space-between;
      }
      .fun-subsection {
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding-top: 0.5rem;
        margin-top: 0.35rem;
        display: grid;
        gap: 0.35rem;
      }
      .fun-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .fun-controls legend {
        font-size: 0.85rem;
        margin-bottom: 0.25rem;
      }
      .fun-chip {
        flex: 1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        border-radius: 8px;
        padding: 0.35rem 0.5rem;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background 0.2s, border-color 0.2s, transform 0.2s;
      }
      .fun-chip[aria-pressed='true'],
      .fun-chip:focus-visible {
        outline: 2px solid #6dd3ff;
        outline-offset: 2px;
        background: rgba(109, 211, 255, 0.15);
        border-color: rgba(109, 211, 255, 0.5);
      }
      .fun-slider {
        flex: 1;
        appearance: none;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, #ff3366, #ffd166, #33ffcc);
      }
      .fun-slider::-webkit-slider-thumb {
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid rgba(0,0,0,0.2);
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      }
      .fun-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid rgba(0,0,0,0.2);
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      }
      .fun-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.85rem;
      }
      .fun-toggle input {
        width: 18px;
        height: 18px;
        accent-color: #6dd3ff;
      }
      @media (max-width: 640px) {
        .fun-controls {
          left: 0.5rem;
          right: 0.5rem;
          bottom: 0.5rem;
          min-width: unset;
          grid-template-columns: 1fr;
          font-size: 0.9rem;
        }
        .fun-controls fieldset {
          flex-wrap: wrap;
        }
        .fun-chip {
          flex: 1 1 30%;
          text-align: center;
        }
      }
    `;
  document.head.appendChild(style);
}

export function initFunControls(options: FunControlsInit = {}) {
  ensureStyles();

  const palettes = options.paletteOptions || defaultPalettes;
  let palette: PaletteOption = options.initialPalette || 'bright';
  let motion = options.initialMotion ?? 0.5;
  let mode: 'calm' | 'party' = options.initialMode || 'calm';
  let audioAvailable = options.audioAvailable !== false;
  let audioEnabled = options.audioEnabled !== false;
  let sparklesEnabled = options.initialSparklesEnabled !== false;
  let burstsEnabled = options.initialBurstsEnabled !== false;
  let peakSensitivity = options.initialPeakSensitivity ?? 0.35;

  const container = document.createElement('section');
  container.className = 'fun-controls';
  container.setAttribute('aria-label', 'Visualizer controls');
  container.innerHTML = `
      <fieldset>
        <legend>Palette</legend>
        ${(['bright', 'pastel', 'neon'] as PaletteOption[])
          .map(
            (key) => `
              <button class="fun-chip" data-palette="${key}" aria-pressed="${
              palette === key
            }">${key}</button>
            `
          )
          .join('')}
      </fieldset>
      <label>
        Motion
        <input class="fun-slider" type="range" min="0" max="1" step="0.01" value="${motion}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${motion}" aria-label="Motion intensity" />
      </label>
      <button class="fun-chip" data-mode="toggle" aria-pressed="${
        mode === 'party'
      }">${mode === 'party' ? 'Party' : 'Calm'} mode</button>
      <label class="fun-toggle">
        <input type="checkbox" class="fun-audio" ${
          audioEnabled ? 'checked' : ''
        } ${audioAvailable ? '' : 'disabled'} aria-label="Audio reactive" />
        Audio reactive
      </label>
      <div class="fun-subsection" aria-label="Peak fun">
        <div class="fun-row">
          <label class="fun-toggle">
            <input type="checkbox" class="fun-sparkles" ${
              sparklesEnabled ? 'checked' : ''
            } aria-label="Sparkles" />
            Sparkles
          </label>
          <label class="fun-toggle">
            <input type="checkbox" class="fun-bursts" ${
              burstsEnabled ? 'checked' : ''
            } aria-label="Bursts" />
            Bursts
          </label>
        </div>
        <label>
          Peak sensitivity
          <input
            class="fun-slider fun-peak-sensitivity"
            type="range"
            min="0.05"
            max="1"
            step="0.01"
            value="${peakSensitivity}"
            aria-valuemin="0.05"
            aria-valuemax="1"
            aria-valuenow="${peakSensitivity}"
            aria-label="Peak sensitivity"
          />
        </label>
      </div>
    `;

  document.body.appendChild(container);

  function notifyPalette() {
    options.onPaletteChange?.(palette, palettes[palette]);
  }

  function notifyMotion() {
    options.onMotionChange?.(motion, mode);
  }

  function notifyAudio() {
    options.onAudioToggle?.(audioEnabled && audioAvailable);
  }

  function notifySparkles() {
    options.onSparkleToggle?.(sparklesEnabled);
  }

  function notifyBursts() {
    options.onBurstToggle?.(burstsEnabled);
  }

  function notifySensitivity() {
    options.onPeakSensitivityChange?.(peakSensitivity);
  }

  container
    .querySelectorAll<HTMLButtonElement>('[data-palette]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        palette = btn.dataset.palette as PaletteOption;
        container
          .querySelectorAll<HTMLButtonElement>('[data-palette]')
          .forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        notifyPalette();
      });
    });

  const slider = container.querySelector<HTMLInputElement>('.fun-slider');
  slider?.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    motion = Math.min(1, Math.max(0, value));
    slider.setAttribute('aria-valuenow', motion.toString());
    notifyMotion();
  });

  const modeButton = container.querySelector<HTMLButtonElement>(
    '[data-mode="toggle"]'
  );
  modeButton?.addEventListener('click', () => {
    mode = mode === 'party' ? 'calm' : 'party';
    modeButton.textContent = `${mode === 'party' ? 'Party' : 'Calm'} mode`;
    modeButton.setAttribute('aria-pressed', String(mode === 'party'));
    notifyMotion();
  });

  const audioToggle = container.querySelector<HTMLInputElement>('.fun-audio');
  audioToggle?.addEventListener('change', (event) => {
    audioEnabled = (event.target as HTMLInputElement).checked;
    notifyAudio();
  });

  const sparklesToggle = container.querySelector<HTMLInputElement>(
    '.fun-sparkles'
  );
  sparklesToggle?.addEventListener('change', (event) => {
    sparklesEnabled = (event.target as HTMLInputElement).checked;
    notifySparkles();
  });

  const burstsToggle = container.querySelector<HTMLInputElement>('.fun-bursts');
  burstsToggle?.addEventListener('change', (event) => {
    burstsEnabled = (event.target as HTMLInputElement).checked;
    notifyBursts();
  });

  const peakSlider = container.querySelector<HTMLInputElement>(
    '.fun-peak-sensitivity'
  );
  peakSlider?.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    peakSensitivity = Math.min(1, Math.max(0.05, value));
    peakSlider.setAttribute('aria-valuenow', peakSensitivity.toString());
    notifySensitivity();
  });

  notifyPalette();
  notifyMotion();
  notifyAudio();
  notifySparkles();
  notifyBursts();
  notifySensitivity();

  return {
    container,
    setAudioAvailable(available: boolean) {
      audioAvailable = available;
      if (audioToggle) {
        audioToggle.disabled = !available;
        if (!available) {
          audioToggle.checked = false;
        }
      }
      notifyAudio();
    },
    updateAudioEnabled(enabled: boolean) {
      audioEnabled = enabled;
      if (audioToggle) {
        audioToggle.checked = enabled;
      }
      notifyAudio();
    },
    appendControl(element: HTMLElement) {
      container.appendChild(element);
    },
  };
}
