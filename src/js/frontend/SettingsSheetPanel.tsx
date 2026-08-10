import { useEffect, useState } from 'react';
import {
  applyAccessibility,
  getActiveAccessibilityPreference,
  setAccessibilityPreference,
  type TextScale,
} from '../core/accessibility-preferences.ts';
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
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import { PerformanceHardwareSection } from './PerformanceHardwareSection.tsx';
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
  { value: 3, label: '3x' },
  { value: 4, label: '4x' },
];

/** UI text scale steps for low-vision users. */
const TEXT_SCALE_STEPS: Array<{ value: TextScale; label: string }> = [
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2, label: '200%' },
];

/** Crossfade duration steps, seconds. */
const BLEND_DURATION_STEPS: Array<{ value: number; label: string }> = [
  { value: 0.5, label: '0.5s' },
  { value: 1, label: '1s' },
  { value: 2, label: '2s' },
  { value: 3, label: '3s' },
  { value: 5, label: '5s' },
  { value: 8, label: '8s' },
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

function AccessibilitySection({
  onOpenShortcuts,
  onOpenCredits,
}: {
  onOpenShortcuts: () => void;
  onOpenCredits: () => void;
}) {
  const [prefs, setPrefs] = useState(() => getActiveAccessibilityPreference());

  useEffect(() => {
    applyAccessibility(prefs);
  }, [prefs]);

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Accessibility</h3>
      </div>
      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor="a11y-text-scale">
            Text size
          </label>
          <span className="ctl-row__hint">
            Enlarges all controls and labels. Browser zoom also works.
          </span>
        </span>
        <select
          id="a11y-text-scale"
          className="ctl-select ctl-select--auto"
          value={prefs.textScale}
          onChange={(e) => {
            const textScale = parseFloat(e.target.value) as TextScale;
            setPrefs((p) => ({ ...p, textScale }));
            setAccessibilityPreference({ textScale });
          }}
        >
          {TEXT_SCALE_STEPS.map((step) => (
            <option key={step.value} value={step.value}>
              {step.label}
            </option>
          ))}
        </select>
      </div>
      <SwitchRow
        label="High contrast"
        hint="Stronger borders and brighter text for the control panels."
        checked={prefs.highContrast}
        onChange={(highContrast) => {
          setPrefs((p) => ({ ...p, highContrast }));
          setAccessibilityPreference({ highContrast });
        }}
      />
      <SwitchRow
        label="Freeze visuals"
        hint="Holds the current frame still so you can inspect it or reduce motion."
        checked={prefs.freezeFrame}
        onChange={(freezeFrame) => {
          setPrefs((p) => ({ ...p, freezeFrame }));
          setAccessibilityPreference({ freezeFrame });
        }}
      />
      <button type="button" className="ctl-btn" onClick={onOpenShortcuts}>
        Keyboard shortcuts
      </button>
      <button type="button" className="ctl-btn" onClick={onOpenCredits}>
        About &amp; credits
      </button>
    </section>
  );
}

function describeAdaptiveQualityStatus(
  adaptiveQuality: EngineSnapshot['adaptiveQuality'],
) {
  if (!adaptiveQuality) {
    return 'Adaptive quality keeps frame rate steady once playback starts — no need to babysit it.';
  }
  switch (adaptiveQuality.adaptation) {
    case 'degraded':
      return 'Frames were dropping, so detail is currently reduced below your settings to keep motion smooth.';
    case 'recovering':
      return 'Detail is easing back up toward your settings now that frames have room again.';
    case 'enhanced':
      return 'Frames have headroom, so detail is currently a step above your settings.';
    default:
      return 'Running at your selected detail level — frame rate has been steady.';
  }
}

function PerformanceSection() {
  const [perf, setPerf] = useState(() => ({
    shaderQuality: DEFAULT_PERFORMANCE_SETTINGS.shaderQuality,
    particleBudget: DEFAULT_PERFORMANCE_SETTINGS.particleBudget,
    maxPixelRatio: DEFAULT_PERFORMANCE_SETTINGS.maxPixelRatio,
    loaded: false,
  }));
  const { engineSnapshot } = useEngineSnapshot();

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let disposed = false;
    import('../core/state/performance-settings-store.ts').then(
      ({ getActivePerformanceSettings, subscribeToPerformanceSettings }) => {
        if (disposed) return;
        const s = getActivePerformanceSettings();
        setPerf({
          shaderQuality: s.shaderQuality,
          particleBudget: s.particleBudget,
          maxPixelRatio: s.maxPixelRatio,
          loaded: true,
        });
        // Quality-preset changes can move maxPixelRatio while this panel is
        // open (a preset-derived resolution follows the preset), so stay
        // subscribed rather than reading once.
        unsubscribe = subscribeToPerformanceSettings((next) => {
          setPerf({
            shaderQuality: next.shaderQuality,
            particleBudget: next.particleBudget,
            maxPixelRatio: next.maxPixelRatio,
            loaded: true,
          });
        });
      },
    );
    return () => {
      disposed = true;
      unsubscribe?.();
    };
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
      ({ resetPerformanceSettingsToDefaults }) => {
        const next = resetPerformanceSettingsToDefaults();
        setPerf({ ...next, loaded: true });
      },
    );
  };

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

      <div className="ctl-row">
        <span className="ctl-row__text">
          <span className="ctl-row__label">Adaptive quality</span>
          <span className="ctl-row__hint" role="status">
            {describeAdaptiveQualityStatus(
              engineSnapshot?.adaptiveQuality ?? null,
            )}
          </span>
        </span>
      </div>
    </section>
  );
}

export function SettingsSheetPanel({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  onOpenShortcuts,
  onOpenCredits,
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
  onOpenShortcuts: () => void;
  onOpenCredits: () => void;
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
        <div className="ctl-section__head">
          <h3 className="ctl-section__title">Playback</h3>
        </div>
        <SwitchRow
          label="Autoplay"
          hint="Automatically shuffles to a new preset while audio plays."
          checked={engineSnapshot?.autoplay ?? false}
          onChange={(next) => engine.setAutoplay(next)}
        />
        <div className="ctl-row">
          <span className="ctl-row__text">
            <label className="ctl-row__label" htmlFor="transition-mode">
              Preset transitions
            </label>
            <span className="ctl-row__hint">
              Blend crossfades into the next preset. Cut switches instantly.
            </span>
          </span>
          <select
            id="transition-mode"
            className="ctl-select ctl-select--auto"
            value={engineSnapshot?.transitionMode ?? 'blend'}
            onChange={(e) =>
              engine.setTransitionMode(e.target.value as 'blend' | 'cut')
            }
          >
            <option value="blend">Blend</option>
            <option value="cut">Cut</option>
          </select>
        </div>
        {(engineSnapshot?.transitionMode ?? 'blend') === 'blend' ? (
          <div className="ctl-row">
            <span className="ctl-row__text">
              <label className="ctl-row__label" htmlFor="blend-duration">
                Blend duration
              </label>
              <span className="ctl-row__hint">
                How long the crossfade between presets takes.
              </span>
            </span>
            <select
              id="blend-duration"
              className="ctl-select ctl-select--auto"
              value={nearestStep(
                BLEND_DURATION_STEPS,
                engineSnapshot?.blendDuration ?? 0.3,
              )}
              onChange={(e) =>
                engine.setBlendDuration(parseFloat(e.target.value))
              }
            >
              {BLEND_DURATION_STEPS.map((step) => (
                <option key={step.value} value={step.value}>
                  {step.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      <section className="ctl-section">
        <AudioSourcePanel />
      </section>

      <AccessibilitySection
        onOpenShortcuts={onOpenShortcuts}
        onOpenCredits={onOpenCredits}
      />

      <PerformanceSection />

      <PerformanceHardwareSection />

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
