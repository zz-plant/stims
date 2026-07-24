import { useMemo } from 'react';
import { useAudioEnergy } from './hooks/useAudioEnergy.ts';
import { RendererFallbackBadge } from './RendererFallbackBadge.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

const BARS_CONFIG = [
  { id: 'b1', mult: 1.35 },
  { id: 'b2', mult: 0.95 },
  { id: 'b3', mult: 1.15 },
  { id: 'b4', mult: 1.4 },
  { id: 'b5', mult: 0.85 },
  { id: 'b6', mult: 1.25 },
  { id: 'b7', mult: 0.75 },
  { id: 'b8', mult: 1.1 },
];

export function AudioSpectrumHud() {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot: _engineSnapshot } = useEngineSnapshot();
  const audioEnergy = useAudioEnergy();

  const selectedPreset = engine.selectedPreset ?? engine.featuredPreset;
  const activeTitle = selectedPreset?.title ?? 'No Preset Loaded';
  const activeAuthor = selectedPreset?.author
    ? `by ${selectedPreset.author}`
    : '';

  const energyNorm = Math.max(0.08, Math.min(1, audioEnergy));

  const bands = useMemo(
    () =>
      BARS_CONFIG.map((b) => ({
        id: b.id,
        height: Math.min(1, energyNorm * b.mult),
      })),
    [energyNorm],
  );

  const activePanel = ui.routeState.panel;

  return (
    <header className="stims-hud-bar">
      <div className="stims-hud-bar__brand">
        <div className="stims-hud-bar__logo-mark" aria-hidden="true">
          <span className="stims-hud-bar__logo-dot" />
          <span className="stims-hud-bar__logo-ring" />
        </div>
        <span className="stims-hud-bar__title">STIMS</span>
        <span className="stims-hud-bar__version">2.0</span>
      </div>

      <div className="stims-hud-bar__preset-info">
        <div className="stims-hud-bar__preset-title">{activeTitle}</div>
        {activeAuthor ? (
          <div className="stims-hud-bar__preset-author">{activeAuthor}</div>
        ) : null}
      </div>

      <div
        className="stims-hud-bar__spectrum"
        aria-hidden="true"
        title="Live Frequency Analyzer"
      >
        {bands.map((band) => (
          <span
            key={band.id}
            className="stims-hud-bar__spectrum-bar"
            style={{
              transform: `scaleY(${band.height})`,
              opacity: 0.35 + band.height * 0.65,
            }}
          />
        ))}
      </div>

      <div className="stims-hud-bar__actions">
        <RendererFallbackBadge />
        <button
          type="button"
          className={`stims-hud-bar__quick-btn ${activePanel === 'settings' ? 'is-active' : ''}`}
          onClick={() =>
            ui.updatePanel(activePanel === 'settings' ? null : 'settings')
          }
          aria-label="Open Settings Panel"
          title="Settings & Graphics Options"
        >
          <UiIcon
            name="sliders"
            className="stims-icon-slot stims-icon-slot--sm"
          />
        </button>
      </div>
    </header>
  );
}
