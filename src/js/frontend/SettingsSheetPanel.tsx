import { useEffect, useState } from 'react';
import {
  hasWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
} from '../core/renderer-query-override.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import { DEFAULT_PERFORMANCE_SETTINGS } from '../core/state/performance-settings-store.ts';
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

function PerformanceSection() {
  const [perf, setPerf] = useState(() => ({
    shaderDetail: 1,
    ecoMode: false,
    renderScale: 1,
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
          shaderDetail: s.shaderDetail,
          ecoMode: s.ecoMode,
          renderScale: s.renderScale,
          loaded: true,
        });
      },
    );
  }, []);

  const setOption = <K extends keyof typeof perf>(
    key: K,
    value: (typeof perf)[K],
  ) => {
    setPerf((p) => ({ ...p, [key]: value }));
    import('../core/state/performance-settings-store.ts').then(
      ({ setPerformanceOption }) => {
        setPerformanceOption(
          key as 'renderScale' | 'shaderDetail' | 'ecoMode',
          value as never,
        );
      },
    );
  };

  const resetPerformance = () => {
    import('../core/state/performance-settings-store.ts').then(
      ({ resetPerformanceSettingsStore, setPerformanceOption }) => {
        resetPerformanceSettingsStore();
        setPerformanceOption(
          'renderScale',
          DEFAULT_PERFORMANCE_SETTINGS.renderScale,
        );
        setPerformanceOption(
          'shaderDetail',
          DEFAULT_PERFORMANCE_SETTINGS.shaderDetail,
        );
        setPerformanceOption('ecoMode', DEFAULT_PERFORMANCE_SETTINGS.ecoMode);
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
    if (perf.renderScale > 0.75) {
      setRecommendation(
        'If visuals stutter, auto-tune can drop the render resolution to 75%.',
      );
    } else if (!perf.ecoMode) {
      setRecommendation(
        'Auto-tune can turn on Eco mode when frames keep dropping.',
      );
    } else {
      setRecommendation(
        'Auto-tune is watching. These settings already run cool.',
      );
    }
  }, [autoTune, perf.ecoMode, perf.renderScale]);

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
          <label className="ctl-row__label" htmlFor="render-resolution">
            Render resolution
          </label>
          <span className="ctl-row__hint">
            Lower renders fewer pixels and frees up the GPU.
          </span>
        </span>
        <select
          id="render-resolution"
          className="ctl-select ctl-select--auto"
          value={perf.renderScale}
          onChange={(e) => setOption('renderScale', parseFloat(e.target.value))}
        >
          <option value={1}>Full</option>
          <option value={0.75}>75%</option>
          <option value={0.5}>50%</option>
        </select>
      </div>

      <div className="ctl-row">
        <span className="ctl-row__text">
          <label className="ctl-row__label" htmlFor="shader-detail">
            Shader detail
          </label>
          <span className="ctl-row__hint">
            How much per-pixel maths each frame runs.
          </span>
        </span>
        <select
          id="shader-detail"
          className="ctl-select ctl-select--auto"
          value={perf.shaderDetail}
          onChange={(e) =>
            setOption('shaderDetail', parseInt(e.target.value, 10))
          }
        >
          <option value={0}>Low</option>
          <option value={1}>Medium</option>
          <option value={2}>High</option>
        </select>
      </div>

      <SwitchRow
        label="Eco mode"
        hint="Caps at 30 fps and trims effects to save battery."
        checked={perf.ecoMode}
        onChange={(next) => setOption('ecoMode', next)}
      />

      <SwitchRow
        label="Auto-tune"
        hint="Watches for slow frames and suggests safer settings before applying them."
        checked={autoTune}
        onChange={setAutoTune}
      />

      {recommendation ? (
        <div className="ctl-empty" role="status">
          <p className="ctl-empty__body">{recommendation}</p>
          {perf.renderScale > 0.75 ? (
            <button
              type="button"
              className="ctl-btn"
              onClick={() => setOption('renderScale', 0.75)}
            >
              Drop to 75%
            </button>
          ) : !perf.ecoMode ? (
            <button
              type="button"
              className="ctl-btn"
              onClick={() => setOption('ecoMode', true)}
            >
              Turn on Eco mode
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
