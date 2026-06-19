import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { saveCheckpoint } from '../core/services/temporal-memory.ts';
import {
  describeFrame,
  extractFrameStats,
  searchByFrame,
} from '../core/services/visual-embedding.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { SkeletonPresetCard } from './PresetShelfSection.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useEngine, useEngineSnapshot, useUI } from './workspace-context.tsx';

const moods = [
  { label: 'Chill', desc: 'slow drifting ambient', icon: '\uD83C\uDF0A' },
  { label: 'Aggressive', desc: 'fast intense heavy', icon: '\u26A1' },
  { label: 'Retro', desc: 'classic geometric 90s', icon: '\uD83D\uDCFA' },
  { label: 'Cosmic', desc: 'space nebula starfield', icon: '\u2728' },
];

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
  const { engineSnapshot } = useEngineSnapshot();
  const panel = ui.routeState.panel;
  const audioSource = engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  const audioEnergy = engineSnapshot?.audioEnergy ?? 0;
  const energyNorm = Math.min(1, Math.max(0, audioEnergy));
  const runtimeReady = engineSnapshot?.runtimeReady ?? false;
  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';

  const [similarPresets, setSimilarPresets] = useState<
    Array<{ presetId: string; score: number }>
  >([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarSearched, setSimilarSearched] = useState(false);
  const [similarError, setSimilarError] = useState(false);
  const [showMoods, setShowMoods] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const moodAbortRef = useRef<AbortController | null>(null);
  const moreLikeThisAbortRef = useRef<AbortController | null>(null);

  const handleMoodGenerate = useCallback(
    (mood: { label: string; desc: string }) => {
      moodAbortRef.current?.abort();
      const controller = new AbortController();
      moodAbortRef.current = controller;
      fetch('/api/generate-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${mood.desc} ${mood.label.toLowerCase()} visualizer preset`,
          complexity: 'moderate',
        }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.milkSource) {
            document.dispatchEvent(
              new CustomEvent('stims:editor:source-change', {
                detail: {
                  source: data.milkSource,
                  title: data.title || mood.label,
                },
              }),
            );
            ui.updatePanel('editor');
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
        });
    },
    [ui],
  );

  const handleMoreLikeThis = async () => {
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    moreLikeThisAbortRef.current?.abort();
    const controller = new AbortController();
    moreLikeThisAbortRef.current = controller;
    setSimilarLoading(true);
    setSimilarError(false);
    setSimilarSearched(false);
    try {
      const results = await searchByFrame(canvas, controller.signal);
      if (controller.signal.aborted) return;
      setSimilarPresets(results);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setSimilarError(true);
      ui.setStatusMessage('Visual search failed.');
    } finally {
      if (!controller.signal.aborted) {
        setSimilarLoading(false);
        setSimilarSearched(true);
      }
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
    const presetId = engineSnapshot?.activePresetId ?? 'unknown';
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
          {/* biome-ignore lint/a11y/useSemanticElements: custom visual span designed specifically for visual status/metering */}
          <span
            ref={barRef}
            className="stims-shell__now-playing-bar"
            role="meter"
            aria-label="Audio energy level"
            aria-valuenow={Math.round(audioEnergy * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
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
          aria-expanded={panel === 'browse'}
          aria-label="Browse presets"
          title="Browse presets"
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
          aria-expanded={panel === 'settings'}
          aria-label="Adjust settings"
          title="Adjust settings"
          onClick={() => ui.updatePanel('settings')}
        >
          <UiIcon
            name="sliders"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Settings</span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-label="Play a random preset"
          title="Play a random preset"
          onClick={engine.handleShufflePreset}
        >
          <UiIcon
            name="shuffle"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Surprise me</span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          data-active={String(panel === 'editor')}
          aria-expanded={panel === 'editor'}
          aria-label="Edit the current preset"
          title="Edit the current preset"
          onClick={() => ui.updatePanel('editor')}
        >
          <UiIcon
            name="gauge"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">Edit</span>
        </button>
        <button
          type="button"
          className="stims-shell__stage-tool"
          aria-expanded={showMore}
          aria-haspopup="menu"
          aria-label="More actions"
          title="More actions"
          onClick={() => setShowMore((s) => !s)}
        >
          <UiIcon
            name="menu"
            className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__stage-tool-label">More</span>
        </button>
        {audioSource ? (
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Stop audio input"
            title="Stop audio input"
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
        {onToggleTheme ? (
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Switch light or dark theme"
            title="Switch light or dark theme"
            onClick={onToggleTheme}
          >
            <UiIcon
              name="moon"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">Theme</span>
          </button>
        ) : null}
      </div>
      {showMore ? (
        <div
          className="stims-shell__dock-overflow"
          role="menu"
          aria-label="More actions"
        >
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Create a preset from a mood"
            title="Create a preset from a mood"
            onClick={() => setShowMoods((s) => !s)}
          >
            <UiIcon
              name="wand"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">Generate</span>
          </button>
          <button
            type="button"
            className="cta-button stims-shell__stage-tool-ghost"
            aria-label="Find presets that look similar"
            title="Find presets that look similar"
            disabled={!runtimeReady || similarLoading}
            onClick={() => void handleMoreLikeThis()}
          >
            <UiIcon
              name="eye"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">
              {similarLoading ? 'Searching\u2026' : 'More like this'}
            </span>
          </button>
          <button
            type="button"
            className="cta-button stims-shell__stage-tool-ghost"
            aria-label="Save the current look"
            title="Save the current look"
            disabled={!runtimeReady}
            onClick={handleSaveThisLook}
          >
            <span className="stims-shell__stage-tool-label">Save</span>
          </button>
          <button
            type="button"
            className="stims-shell__stage-tool"
            aria-label="Copy a share link"
            title="Copy a share link"
            onClick={() => void ui.handleShowCurrentLink()}
          >
            <UiIcon
              name="link"
              className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__stage-tool-label">Share</span>
          </button>
        </div>
      ) : null}
      {showMoods && (
        <div className="stims-shell__mood-row">
          {moods.map((mood) => (
            <button
              key={mood.label}
              type="button"
              className="stims-shell__stage-tool"
              aria-label={`Generate ${mood.label.toLowerCase()} preset`}
              onClick={() => handleMoodGenerate(mood)}
            >
              <span className="stims-shell__stage-tool-label">
                {mood.icon} {mood.label}
              </span>
            </button>
          ))}
        </div>
      )}
      {similarLoading ||
      similarError ||
      (similarSearched && similarPresets.length === 0) ||
      similarPresets.length > 0 ? (
        <div className="stims-shell__similar-presets">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <h2 className="stims-shell__section-label" style={{ margin: 0 }}>
              Similar looks
            </h2>
            {!similarLoading ? (
              <button
                type="button"
                className="stims-shell__clear-filters"
                onClick={() => {
                  setSimilarPresets([]);
                  setSimilarSearched(false);
                  setSimilarError(false);
                }}
                style={{ fontSize: '0.8rem', opacity: 0.8 }}
              >
                Close
              </button>
            ) : null}
          </div>
          {similarError ? (
            <div className="stims-shell__empty-state" role="alert">
              <p className="stims-shell__meta-copy">
                Couldn’t find similar looks right now.
              </p>
              <button
                type="button"
                className="cta-button ghost"
                onClick={() => void handleMoreLikeThis()}
              >
                Try again
              </button>
            </div>
          ) : similarLoading ? (
            <div className="stims-shell__starter-grid">
              <SkeletonPresetCard />
              <SkeletonPresetCard />
              <SkeletonPresetCard />
            </div>
          ) : similarSearched && similarPresets.length === 0 ? (
            <div className="stims-shell__empty-state">
              <p className="stims-shell__meta-copy">
                No matching presets for this look.
              </p>
            </div>
          ) : (
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
          )}
        </div>
      ) : null}
    </div>
  );
}
