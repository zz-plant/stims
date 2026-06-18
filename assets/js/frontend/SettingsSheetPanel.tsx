import { useEffect, useState } from 'react';
import type { QualityPreset } from '../core/settings-panel.ts';
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

  return (
    <div className="stims-shell__settings-section">
      <h3 className="stims-shell__settings-label">Performance</h3>

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
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
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
        <p className="stims-shell__section-label">Visual quality</p>
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
      </section>

      <PerformanceSection />

      <details className="stims-shell__settings-advanced">
        <summary className="stims-shell__settings-summary">
          <span>Manual preferences</span>
          <span className="stims-shell__meta-copy">
            Optional controls for compatibility and device motion
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
        <p className="stims-shell__section-label">Graphics backend</p>
        <p className="stims-shell__meta-copy">
          {engineSnapshot?.backend
            ? `Running on ${engineSnapshot.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}`
            : engine.engineReady
              ? 'Graphics backend ready'
              : 'Starting graphics\u2026'}
          {engineSnapshot?.backend === 'webgl'
            ? ' — WebGPU was unavailable or disabled.'
            : ''}
        </p>
      </section>
    </div>
  );
}
