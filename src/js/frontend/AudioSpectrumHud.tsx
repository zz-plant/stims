import { useEffect, useRef } from 'react';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { RendererFallbackBadge } from './RendererFallbackBadge.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

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

function AudioSpectrumBars() {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateBars = () => {
      const energy = Math.max(0.08, Math.min(1, getAudioEnergy()));
      BARS_CONFIG.forEach((barConfig, index) => {
        const bar = barsRef.current?.children.item(index);
        if (!(bar instanceof HTMLElement)) {
          return;
        }
        const height = Math.min(1, energy * barConfig.mult);
        bar.style.transform = `scaleY(${height})`;
        bar.style.opacity = String(0.35 + height * 0.65);
      });
    };

    updateBars();
    return subscribeAudioEnergy(updateBars);
  }, []);

  return (
    <div
      ref={barsRef}
      className="stims-hud-bar__spectrum"
      aria-hidden="true"
      title="Live Frequency Analyzer"
    >
      {BARS_CONFIG.map((bar) => (
        <span key={bar.id} className="stims-hud-bar__spectrum-bar" />
      ))}
    </div>
  );
}

export function AudioSpectrumHud() {
  const { ui, engine } = useWorkspace();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateHeaderEnergy = () => {
      const energy = getAudioEnergy();
      if (headerRef.current) {
        headerRef.current.style.setProperty(
          '--stims-hud-energy',
          String(energy.toFixed(3)),
        );
      }
    };
    updateHeaderEnergy();
    return subscribeAudioEnergy(updateHeaderEnergy);
  }, []);

  const selectedPreset = engine.selectedPreset ?? engine.featuredPreset;
  const activeTitle = selectedPreset?.title ?? 'No Preset Loaded';
  const activeAuthor = selectedPreset?.author
    ? `by ${selectedPreset.author}`
    : '';

  const activePanel = ui.routeState.panel;

  return (
    <header ref={headerRef} className="stims-hud-bar">
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

      <AudioSpectrumBars />

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
