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
        padding: 1rem;
        background: radial-gradient(
            140% 140% at 15% 20%,
            rgba(81, 135, 255, 0.14),
            rgba(9, 9, 18, 0.08)
          ),
          rgba(10, 12, 20, 0.82);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
        border-radius: 16px;
        backdrop-filter: blur(12px) saturate(140%);
        color: #f7f8ff;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        min-width: 260px;
        z-index: 20;
        overflow: hidden;
      }
      .fun-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        justify-content: space-between;
        padding: 0.35rem 0.5rem 0.25rem;
        border-radius: 12px;
        background: linear-gradient(120deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0));
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .fun-labels {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .fun-eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.7rem;
        opacity: 0.8;
        margin: 0;
      }
      .fun-title {
        font-size: 1.1rem;
        margin: 0;
        letter-spacing: 0.01em;
      }
      .fun-badges {
        display: flex;
        gap: 0.35rem;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .fun-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        font-size: 0.8rem;
        color: inherit;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
      }
      .fun-pill[data-state='party'] {
        background: linear-gradient(120deg, rgba(255, 102, 178, 0.35), rgba(255, 221, 102, 0.2));
        border-color: rgba(255, 221, 102, 0.4);
      }
      .fun-pill[data-state='calm'] {
        background: linear-gradient(120deg, rgba(109, 211, 255, 0.3), rgba(92, 255, 204, 0.18));
        border-color: rgba(109, 211, 255, 0.4);
      }
      .fun-pill[data-audio='off'] {
        opacity: 0.72;
        border-style: dashed;
      }
      .fun-grid {
        display: grid;
        gap: 0.75rem;
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
        letter-spacing: 0.01em;
      }
      .fun-chip {
        flex: 1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: linear-gradient(140deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.03));
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
        background: linear-gradient(140deg, rgba(109, 211, 255, 0.25), rgba(109, 211, 255, 0.08));
        border-color: rgba(109, 211, 255, 0.5);
      }
      .fun-slider {
        flex: 1;
        appearance: none;
        height: 6px;
        border-radius: 999px;
        background: linear-gradient(90deg, #6dd3ff, #ffd166, #ff66b2);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.45);
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
      .fun-caption {
        font-size: 0.8rem;
        opacity: 0.7;
        margin: 0;
      }
      @media (max-width: 640px) {
        .fun-controls {
          left: 0.5rem;
          right: 0.5rem;
          bottom: 0.5rem;
          min-width: unset;
          grid-template-columns: 1fr;
          font-size: 0.95rem;
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
      <div class="fun-header">
        <div class="fun-labels">
          <p class="fun-eyebrow">Visualizer HUD</p>
          <p class="fun-title">Live controls</p>
        </div>
        <div class="fun-badges">
          <span class="fun-pill" data-mode-indicator data-state="${mode}">
            ${mode === 'party' ? 'Party mode' : 'Calm mode'}
          </span>
          <span
            class="fun-pill"
            data-audio-indicator
            data-audio="${audioEnabled && audioAvailable ? 'on' : 'off'}"
          >
            ${audioEnabled && audioAvailable ? 'Audio reactive' : 'Manual control'}
          </span>
        </div>
      </div>
      <p class="fun-caption">Tweak the mood live—nothing here pauses the show.</p>
      <div class="fun-grid">
        <fieldset>
          <legend>Palette</legend>
          ${(['bright', 'pastel', 'neon'] as PaletteOption[])
            .map(
              (key) => `
                <button class="fun-chip" data-palette="${key}" aria-pressed="${
                  palette === key
                }">${key}</button>
              `,
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
      </div>
    `;

  document.body.appendChild(container);

  const modeIndicator = container.querySelector<HTMLElement>(
    '[data-mode-indicator]',
  );
  const audioIndicator = container.querySelector<HTMLElement>(
    '[data-audio-indicator]',
  );

  function updateModeIndicator() {
    if (!modeIndicator) return;
    modeIndicator.textContent = mode === 'party' ? 'Party mode' : 'Calm mode';
    modeIndicator.dataset.state = mode;
  }

  function updateAudioIndicator() {
    if (!audioIndicator) return;
    const audioOn = audioEnabled && audioAvailable;
    audioIndicator.textContent = audioOn ? 'Audio reactive' : 'Manual control';
    audioIndicator.dataset.audio = audioOn ? 'on' : 'off';
  }

  function notifyPalette() {
    options.onPaletteChange?.(palette, palettes[palette]);
  }

  function notifyMotion() {
    options.onMotionChange?.(motion, mode);
    updateModeIndicator();
  }

  function notifyAudio() {
    options.onAudioToggle?.(audioEnabled && audioAvailable);
    updateAudioIndicator();
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
    '[data-mode="toggle"]',
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

  const sparklesToggle =
    container.querySelector<HTMLInputElement>('.fun-sparkles');
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
    '.fun-peak-sensitivity',
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
