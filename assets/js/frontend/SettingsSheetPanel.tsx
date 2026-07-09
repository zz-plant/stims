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

function describeQuickLook(preset: QualityPreset): string {
  return getQualityImpactSummary(preset).replace(/^What changes:\s*/u, '');
}

function PerformanceSection() {
  const [perf, setPerf] = useState(() => ({
    shaderDetail: 1,
    ecoMode: false,
    renderScale: 1,
    loaded: false,
  }));

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

  const shaderLabel = ['Low', 'Medium', 'High'][perf.shaderDetail] ?? 'Medium';

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

  return (
    <div className="stims-shell__settings-section">
      <div className="stims-shell__settings-section-header">
        <h3 className="stims-shell__settings-label">Performance</h3>
        {perf.loaded ? (
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={resetPerformance}
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="stims-shell__settings-row">
        <label
          className="stims-shell__settings-option-label"
          htmlFor="render-resolution"
        >
          Render resolution
        </label>
        <select
          id="render-resolution"
          className="stims-shell__select"
          value={perf.renderScale}
          onChange={(e) => setOption('renderScale', parseFloat(e.target.value))}
        >
          <option value={1}>Full (100%)</option>
          <option value={0.75}>High (75%)</option>
          <option value={0.5}>Medium (50%)</option>
        </select>
      </div>

      <div className="stims-shell__settings-row">
        <span className="stims-shell__settings-option-label">
          Shader detail
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="1"
          className="stims-shell__range"
          value={perf.shaderDetail}
          aria-label="Shader detail level"
          onChange={(e) =>
            setOption('shaderDetail', parseInt(e.target.value, 10))
          }
        />
        <span className="stims-shell__range-label">{shaderLabel}</span>
      </div>

      <div className="stims-shell__settings-row">
        <span className="stims-shell__settings-option-label">Eco mode</span>
        <button
          type="button"
          className={`stims-shell__toggle ${perf.ecoMode ? 'is-active' : ''}`}
          onClick={() => setOption('ecoMode', !perf.ecoMode)}
          aria-label="Toggle Eco Mode"
          aria-pressed={perf.ecoMode}
        >
          <span className="stims-shell__toggle-knob" />
        </button>
        <span className="stims-shell__settings-hint">
          30 FPS cap, reduced effects
        </span>
      </div>
    </div>
  );
}

export function SettingsSheetPanel({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  thumbMode = false,
  onThumbModeChange,
  offline = false,
  installAvailable = false,
  onInstallApp,
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  thumbMode?: boolean;
  onThumbModeChange?: (enabled: boolean) => void;
  offline?: boolean;
  installAvailable?: boolean;
  onInstallApp?: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const motionPreference = ui.motionPreference;
  const qualityPreset = ui.qualityPreset;
  const renderPreferences = ui.renderPreferences;
  const guidedPresets = getSettingsPresetOptions().slice(0, 3);

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--settings">
      <section className="stims-shell__sheet-surface">
        <h3 className="stims-shell__settings-section-heading">
          Visual quality
        </h3>
        <ul className="stims-shell__preset-guides">
          {guidedPresets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="stims-shell__preset-guide"
                data-active={String(preset.id === qualityPreset.id)}
                onClick={() => engine.setQualityPreset(preset.id)}
              >
                <strong>{preset.label}</strong>
                <span className="stims-shell__meta-copy">
                  {describeQuickLook(preset)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <label className="stims-shell__field-label" htmlFor="quality-select">
          Choose a specific quality profile
        </label>
        <select
          id="quality-select"
          className="stims-shell__select"
          value={qualityPreset.id}
          onChange={(event) => engine.setQualityPreset(event.target.value)}
        >
          {getSettingsPresetOptions().map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="stims-shell__meta-copy">
          {qualityPreset.description ?? describeQuickLook(qualityPreset)}
        </p>
        {qualityPreset.id !== 'balanced' ? (
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={() => engine.setQualityPreset('balanced')}
          >
            Reset to recommended
          </button>
        ) : null}
      </section>

      <section className="stims-shell__sheet-surface">
        <h3 className="stims-shell__settings-section-heading">
          Mobile experience
        </h3>
        <label className="stims-shell__toggle-card">
          <input
            type="checkbox"
            checked={thumbMode}
            onChange={(event) => onThumbModeChange?.(event.target.checked)}
          />
          <span className="stims-shell__toggle-copy">
            <strong>Thumb mode</strong>
            <small>
              Keeps quick browse and sharing actions at the bottom of mobile
              sheets.
            </small>
          </span>
        </label>
        {offline ? (
          <p className="stims-shell__meta-copy">
            Offline party mode is active. Community and AI-backed imports are
            paused.
          </p>
        ) : installAvailable ? (
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={onInstallApp}
          >
            Install Stims on this device
          </button>
        ) : (
          <p className="stims-shell__meta-copy">
            Rotate your phone in a live session for a cleaner theater layout.
          </p>
        )}
      </section>

      <section className="stims-shell__sheet-surface">
        <AudioSourcePanel />
      </section>

      <PerformanceSection />

      <details className="stims-shell__settings-advanced">
        <summary className="stims-shell__settings-summary">
          <span>Compatibility & motion</span>
          <span className="stims-shell__meta-copy">
            Optional controls for older devices and device motion
          </span>
        </summary>
        <div className="stims-shell__settings-advanced-body">
          <label className="stims-shell__toggle-card">
            <input
              type="checkbox"
              checked={renderPreferences.compatibilityMode}
              onChange={(event) =>
                onCompatibilityModeChange(event.target.checked)
              }
            />
            <span className="stims-shell__toggle-copy">
              <strong>Stability mode for older or unstable devices</strong>
              <small>
                Uses safer rendering choices if your browser or GPU has trouble.
              </small>
            </span>
          </label>

          <label className="stims-shell__toggle-card">
            <input
              type="checkbox"
              checked={motionPreference.enabled}
              onChange={(event) =>
                onMotionPreferenceChange(event.target.checked)
              }
            />
            <span className="stims-shell__toggle-copy">
              <strong>Let phone or tablet movement affect visuals</strong>
              <small>
                Works on supported mobile devices after permission is granted.
              </small>
            </span>
          </label>
        </div>
      </details>

      <section className="stims-shell__sheet-surface">
        <h3 className="stims-shell__settings-section-heading">
          Graphics backend
        </h3>
        <p className="stims-shell__meta-copy" style={{ marginBottom: 12 }}>
          {engineSnapshot?.backend
            ? `Currently running on ${engineSnapshot.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}`
            : engine.engineReady
              ? 'Graphics backend ready'
              : 'Starting graphics\u2026'}
          {engineSnapshot?.backend === 'webgl'
            ? ' — WebGPU was unavailable or disabled.'
            : ''}
        </p>

        <label
          className="stims-shell__field-label"
          htmlFor="backend-select"
          style={{ marginTop: 8 }}
        >
          Graphics override
        </label>
        <select
          id="backend-select"
          className="stims-shell__select"
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
            ui.setStatusMessage(
              'Graphics backend preference changed. Please reload.',
            );
          }}
        >
          <option value="auto">Auto (Recommended)</option>
          <option value="webgpu">Force WebGPU</option>
          <option value="webgl">Force WebGL (Stability mode)</option>
        </select>
        <p className="stims-shell__meta-copy" style={{ marginTop: 8 }}>
          Auto uses browser stability rules. Force WebGPU enables WebGPU on
          supported but gated platforms (Safari/mobile). Force WebGL uses safer
          compatibility rendering.
        </p>
      </section>
    </div>
  );
}
