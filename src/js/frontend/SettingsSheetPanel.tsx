import { useEffect, useState } from 'react';
import {
  hasWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
} from '../core/renderer-query-override.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
  type ShaderQuality,
} from '../core/state/performance-settings-store.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import {
  getQualityImpactSummary,
  getSettingsPresetOptions,
} from './workspace-helpers.ts';

/** The raw render numbers, shown as a secondary instrument readout. */
function describeQualityNumbers(preset: QualityPreset): string {
  return getQualityImpactSummary(preset).replace(/^What changes:\s*/u, '');
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="ctl-row">
      <span className="ctl-row__text">
        <span className="ctl-row__label">{label}</span>
        {hint ? <span className="ctl-row__hint">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        className="ctl-switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/** Particle budget steps, kept inside MIN/MAX_PARTICLE_BUDGET. */
const PARTICLE_DENSITY_STEPS: Array<{ value: number; label: string }> = [
  { value: 0.4, label: 'Lowest' },
  { value: 0.7, label: 'Low' },
  { value: 1, label: 'Standard' },
  { value: 1.3, label: 'High' },
  { value: 1.6, label: 'Highest' },
];

/** Pixel ratio caps, kept inside MIN/MAX_PIXEL_RATIO. */
const RESOLUTION_LIMIT_STEPS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 1.75, label: '1.75x' },
  { value: 2, label: '2x' },
  { value: 2.5, label: '2.5x' },
];

/** Snap a stored value onto the nearest offered step so the select stays bound. */
function nearestStep(
  steps: Array<{ value: number; label: string }>,
  value: number,
) {
  let closest = steps[0].value;
  for (const step of steps) {
    if (Math.abs(step.value - value) < Math.abs(closest - value)) {
      closest = step.value;
    }
  }
  return closest;
}

function PerformanceSection() {
  const [perf, setPerf] = useState(() => ({
    shaderQuality: DEFAULT_PERFORMANCE_SETTINGS.shaderQuality,
    particleBudget: DEFAULT_PERFORMANCE_SETTINGS.particleBudget,
    maxPixelRatio: DEFAULT_PERFORMANCE_SETTINGS.maxPixelRatio,
    loaded: false,
  }));
  const [autoTune, setAutoTune] = useState(() => {
    try {
      return localStorage.getItem('stims:performance-auto-tune') === 'true';
    } catch {
      return false;
    }
  });
  const [recommendation, setRecommendation] = useState<string | null>(null);

  useEffect(() => {
    import('../core/state/performance-settings-store.ts').then(
      ({ getActivePerformanceSettings }) => {
        const s = getActivePerformanceSettings();
        setPerf({
          shaderQuality: s.shaderQuality,
          particleBudget: s.particleBudget,
          maxPixelRatio: s.maxPixelRatio,
          loaded: true,
        });
      },
    );
  }, []);

  const setOption = <
    K extends 'shaderQuality' | 'particleBudget' | 'maxPixelRatio',
  >(
    key: K,
    value: PerformanceSettings[K],
  ) => {
    setPerf((p) => ({ ...p, [key]: value }));
    import('../core/state/performance-settings-store.ts').then(
      ({ setPerformanceOption }) => {
        setPerformanceOption(key, value);
      },
    );
  };

  const resetPerformance = () => {
    import('../core/state/performance-settings-store.ts').then(
      ({ setPerformanceSettings }) => {
        setPerformanceSettings(DEFAULT_PERFORMANCE_SETTINGS);
        setPerf({ ...DEFAULT_PERFORMANCE_SETTINGS, loaded: true });
      },
    );
  };

  useEffect(() => {
    try {
      localStorage.setItem('stims:performance-auto-tune', String(autoTune));
    } catch {}
    if (!autoTune) {
      setRecommendation(null);
      return;
    }
    if (perf.maxPixelRatio > 1.5) {
      setRecommendation(
        'If frames drop, auto-tune can hold the resolution limit at 1.5x.',
      );
    } else if (perf.shaderQuality === 'high') {
      setRecommendation('If frames drop, auto-tune can move detail down.');
    } else {
      setRecommendation(
        'Auto-tune is watching. These settings already run light.',
      );
    }
  }, [autoTune, perf.maxPixelRatio, perf.shaderQuality]);

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Performance</h3>
        {perf.loaded ? (
          <button
            type="button"
            className="ctl-btn ctl-btn--quiet"
            onClick={resetPerformance}
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor="performance-detail">
            Detail
          </label>
          <span className="ctl-row__hint">
            Higher draws finer shading and asks more of the GPU. Low also skips
            preset blending.
          </span>
        </span>
        <select
          id="performance-detail"
          className="ctl-select ctl-select--auto"
          value={perf.shaderQuality}
          onChange={(e) =>
            setOption('shaderQuality', e.target.value as ShaderQuality)
          }
        >
          <option value="low">Low</option>
          <option value="balanced">Balanced</option>
          <option value="high">High</option>
        </select>
      </div>

      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor="performance-particles">
            Particle density
          </label>
          <span className="ctl-row__hint">
            How much the visuals draw at once. Lower thins out busy presets.
          </span>
        </span>
        <select
          id="performance-particles"
          className="ctl-select ctl-select--auto"
          value={nearestStep(PARTICLE_DENSITY_STEPS, perf.particleBudget)}
          onChange={(e) =>
            setOption('particleBudget', parseFloat(e.target.value))
          }
        >
          {PARTICLE_DENSITY_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor="performance-resolution">
            Resolution limit
          </label>
          <span className="ctl-row__hint">
            Caps how many pixels are drawn on a high-density screen. Lower is
            softer but steadier.
          </span>
        </span>
        <select
          id="performance-resolution"
          className="ctl-select ctl-select--auto"
          value={nearestStep(RESOLUTION_LIMIT_STEPS, perf.maxPixelRatio)}
          onChange={(e) =>
            setOption('maxPixelRatio', parseFloat(e.target.value))
          }
        >
          {RESOLUTION_LIMIT_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>

      <SwitchRow
        label="Auto-tune"
        hint="Watches for slow frames and suggests safer settings before applying them."
        checked={autoTune}
        onChange={setAutoTune}
      />

      {recommendation ? (
        <div className="ctl-empty" role="status">
          <p className="ctl-empty__body">{recommendation}</p>
          {perf.maxPixelRatio > 1.5 ? (
            <button
              type="button"
              className="ctl-btn"
              onClick={() => setOption('maxPixelRatio', 1.5)}
            >
              Limit to 1.5x
            </button>
          ) : perf.shaderQuality === 'high' ? (
            <button
              type="button"
              className="ctl-btn"
              onClick={() => setOption('shaderQuality', 'balanced')}
            >
              Use balanced detail
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsSheetPanel({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  thumbMode = false,
  onThumbModeChange,
  partyRemoteMode = false,
  onPartyRemoteModeChange,
  hapticsEnabled = true,
  onHapticsEnabledChange,
  offline = false,
  installAvailable = false,
  onInstallApp,
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  thumbMode?: boolean;
  onThumbModeChange?: (enabled: boolean) => void;
  partyRemoteMode?: boolean;
  onPartyRemoteModeChange?: (enabled: boolean) => void;
  hapticsEnabled?: boolean;
  onHapticsEnabledChange?: (enabled: boolean) => void;
  offline?: boolean;
  installAvailable?: boolean;
  onInstallApp?: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const motionPreference = ui.motionPreference;
  const qualityPreset = ui.qualityPreset;
  const renderPreferences = ui.renderPreferences;
  const qualityOptions = getSettingsPresetOptions();

  const backendLabel = engineSnapshot?.backend
    ? engineSnapshot.backend === 'webgpu'
      ? 'WebGPU'
      : 'WebGL'
    : null;

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--settings">
      <section className="ctl-section">
        <div className="ctl-section__head">
          <h3 className="ctl-section__title">Visual quality</h3>
        </div>
        <div
          className="ctl-options"
          role="radiogroup"
          aria-label="Visual quality"
        >
          {qualityOptions.map((preset) => (
            <label
              key={preset.id}
              className="ctl-option"
              title={describeQualityNumbers(preset)}
            >
              <input
                type="radio"
                name="quality-preset"
                className="ctl-option__input"
                value={preset.id}
                checked={preset.id === qualityPreset.id}
                onChange={() => engine.setQualityPreset(preset.id)}
              />
              <span className="ctl-option__label">{preset.label}</span>
              <span className="ctl-option__hint">{preset.description}</span>
            </label>
          ))}
        </div>
        <p className="ctl-readout">{describeQualityNumbers(qualityPreset)}</p>
      </section>

      <section className="ctl-section">
        <AudioSourcePanel />
      </section>

      <PerformanceSection />

      <section className="ctl-section">
        <div className="ctl-section__head">
          <h3 className="ctl-section__title">On this device</h3>
        </div>
        <SwitchRow
          label="Thumb mode"
          hint="Moves the controls within reach at the bottom of the screen."
          checked={thumbMode}
          onChange={(next) => onThumbModeChange?.(next)}
        />
        <SwitchRow
          label="Party remote"
          hint="A large-target remote for shuffle, save, fullscreen, and audio."
          checked={partyRemoteMode}
          onChange={(next) => onPartyRemoteModeChange?.(next)}
        />
        <SwitchRow
          label="Touch haptics"
          hint="Buzzes on tap where the phone supports it."
          checked={hapticsEnabled}
          onChange={(next) => onHapticsEnabledChange?.(next)}
        />
        <SwitchRow
          label="Motion control"
          hint="Steers the visuals by tilting a supported device."
          checked={motionPreference.enabled}
          onChange={onMotionPreferenceChange}
        />
        {offline ? (
          <p className="ctl-section__note">
            Offline mode is on. Community browsing and AI imports are paused
            until you reconnect.
          </p>
        ) : installAvailable ? (
          <button type="button" className="ctl-btn" onClick={onInstallApp}>
            Install Stims on this device
          </button>
        ) : null}
      </section>

      <section className="ctl-section">
        <div className="ctl-section__head">
          <h3 className="ctl-section__title">Graphics</h3>
          {backendLabel ? (
            <span className="ctl-readout">running on {backendLabel}</span>
          ) : null}
        </div>

        <div className="ctl-row ctl-row--stack">
          <span className="ctl-row__text">
            <label className="ctl-row__label" htmlFor="backend-select">
              Renderer
            </label>
            <span className="ctl-row__hint">
              Auto follows the browser's stability rules. WebGL is the safer
              fallback. Changing this takes effect after a reload.
            </span>
          </span>
          <select
            id="backend-select"
            className="ctl-select"
            value={
              renderPreferences.compatibilityMode
                ? 'webgl'
                : hasWebGPUCompatibilityGapOverride()
                  ? 'webgpu'
                  : 'auto'
            }
            onChange={(event) => {
              const val = event.target.value as 'auto' | 'webgl' | 'webgpu';
              if (val === 'webgl') {
                onCompatibilityModeChange(true);
                setWebGPUCompatibilityGapOverride(false);
              } else if (val === 'webgpu') {
                onCompatibilityModeChange(false);
                setWebGPUCompatibilityGapOverride(true);
              } else {
                onCompatibilityModeChange(false);
                setWebGPUCompatibilityGapOverride(false);
              }
              ui.setStatusMessage('Renderer changed. Reload to apply.');
            }}
          >
            <option value="auto">Auto</option>
            <option value="webgpu">WebGPU</option>
            <option value="webgl">WebGL</option>
          </select>
        </div>
      </section>
    </div>
  );
}
