import { useLayoutEffect, useRef, useState } from 'react';
import {
  searchByFrame,
  extractFrameStats,
  describeFrame,
} from '../core/services/visual-embedding.ts';
import { saveCheckpoint } from '../core/services/temporal-memory.ts';
import { useEngine, useUI } from './workspace-context.tsx';
import { PresetArtwork, UiIcon } from './workspace-ui.tsx';

function useDirectCSSProperty<T extends HTMLElement>(
  name: string,
  value: number,
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.setProperty(name, String(value));
    }
  }, [name, value]);
  return ref;
}

export function StimsControlDock({
  isFullscreen,
  onToggleFullscreen,
  onToggleTheme,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme?: () => void;
}) {
  const ui = useUI();
  const engine = useEngine();
  const panel = ui.routeState.panel;
  const audioSource =
    engine.engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  const audioEnergy = engine.engineSnapshot?.audioEnergy ?? 0;
  const energyNorm = Math.min(1, Math.max(0, audioEnergy));
  const runtimeReady = engine.engineSnapshot?.runtimeReady ?? false;
  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';

  const [similarPresets, setSimilarPresets] = useState<
    Array<{ presetId: string; score: number }>
  >([]);
  const [similarLoading, setSimilarLoading] = useState(false);

  const handleMoreLikeThis = async () => {
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    setSimilarLoading(true);
    try {
      const results = await searchByFrame(canvas);
      setSimilarPresets(results);
    } catch {
      ui.setStatusMessage('Visual search failed.');
    } finally {
      setSimilarLoading(false);
    }
  };

  const handleSaveThisLook = () => {
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    const stats = extractFrameStats(canvas);
    const frameDesc = describeFrame(stats);
    const presetId = engine.engineSnapshot?.activePresetId ?? 'unknown';
    const name =
      engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? 'preset';
    saveCheckpoint(name, `Visual: ${frameDesc}`, presetId);
    ui.setStatusMessage(`Saved look: "${name}"`);
  };

  const barRef = useDirectCSSProperty<HTMLSpanElement>(
    '--stims-energy',
    energyNorm,
  );
  const dockRef = useDirectCSSProperty<HTMLDivElement>(
    '--stims-audio-glow',
    energyNorm,
  );

  return (
    <div className="stims-shell__stage-dock-wrap">
      {runtimeReady && presetTitle ? (
        <div className="stims-shell__now-playing">
          <div className="stims-shell__now-playing-info">
            <span className="stims-shell__now-playing-title">
              {presetTitle}
            </span>
            {presetAuthor ? (
              <span className="stims-shell__now-playing-artist">
                {presetAuthor}
              </span>
            ) : null}
          </div>
          <span ref={barRef} className="stims-shell__now-playing-bar" />
        </div>
      ) : null}
      <div
        ref={dockRef}
        className="stims-shell__stage-dock"
        role="toolbar"
        aria-label="Live controls"
      >
        <button
          type="button"
          className="stims-shell__stage-tool"
          data-active={String(panel === 'browse')}
          aria-label="Open browse panel"
          title="Open browse panel"
          onClick={() => ui.updatePanel('browse')}
        >
          <UiIcon
            name="sparkles"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Browse</span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          data-active={String(panel === 'settings')}
          aria-label="Open look settings"
          title="Open look settings"
          onClick={() => ui.updatePanel('settings')}
        >
          <UiIcon
            name="sliders"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Style</span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label="Surprise me"
          title="Surprise me"
          onClick={engine.handleShufflePreset}
        >
          <UiIcon
            name="pulse"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Surprise me</span>
        </button>
        {audioSource ? (
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Stop audio"
            title="Stop audio"
            onClick={engine.handleAudioStop}
          >
            <UiIcon
              name="close"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">Stop</span>
          </button>
        ) : null}
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          onClick={onToggleFullscreen}
        >
          <UiIcon
            name="expand"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">
            {isFullscreen ? 'Exit full screen' : 'Full screen'}
          </span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label="Share current link"
          title="Share current link"
          onClick={() => void ui.handleShowCurrentLink()}
        >
          <UiIcon
            name="link"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Share</span>
        </button>
        {onToggleTheme ? (
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={onToggleTheme}
          >
            <UiIcon
              name="moon"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">Theme</span>
          </button>
        ) : null}
        <button
          type="button"
          className="cta-button stims-shell__stage-tool-ghost"
          aria-label="Find similar presets"
          title="More like this"
          disabled={!runtimeReady || similarLoading}
          onClick={() => void handleMoreLikeThis()}
        >
          <UiIcon
            name="sparkles"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">
            {similarLoading ? 'Searching\u2026' : 'More like \u00D7'}
          </span>
        </button>
        <button
          type="button"
          className="cta-button stims-shell__stage-tool-ghost"
          aria-label="Save current look"
          title="Save this look"
          disabled={!runtimeReady}
          onClick={handleSaveThisLook}
        >
          <span className="stims-shell__stage-tool-label">Save</span>
        </button>
      </div>
      {similarPresets.length > 0 ? (
        <div className="stims-shell__similar-presets">
          <h2 className="stims-shell__section-label">Similar presets</h2>
          <div className="stims-shell__starter-grid">
            {similarPresets.map((p) => {
              const entry = engine.catalog.find((e) => e.id === p.presetId);
              if (!entry) return null;
              return (
                <button
                  key={p.presetId}
                  type="button"
                  className="stims-shell__starter-card"
                  onClick={() => engine.handlePresetSelection(p.presetId)}
                >
                  <PresetArtwork
                    entry={entry}
                    compact
                    preview={engine.presetPreviews[p.presetId] ?? null}
                  />
                  <strong>{entry.title}</strong>
                  <span className="stims-shell__meta-copy">
                    {(p.score * 100).toFixed(0)}% match
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
