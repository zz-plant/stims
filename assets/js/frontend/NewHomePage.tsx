import { useCallback, useEffect, useState } from 'react';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { PresetShelfSection } from './PresetShelfSection.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';

function buildJumpBackEntries(
  favoritePresets: PresetCatalogEntry[],
  recentPresets: PresetCatalogEntry[],
) {
  return [
    ...favoritePresets.map((entry) => ({
      entry,
      label: 'Saved pick' as const,
      summary: '',
    })),
    ...recentPresets
      .filter(
        (entry) =>
          !favoritePresets.some(
            (favoriteEntry) => favoriteEntry.id === entry.id,
          ),
      )
      .map((entry) => ({
        entry,
        label: 'Recent' as const,
        summary: '',
      })),
  ].slice(0, 3);
}

export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const featuredPreset = engine.featuredPreset;
  const favoritePresets = engine.favoritePresets;
  const missingRequestedPreset = engine.missingRequestedPreset;
  const presetPreviews = engine.presetPreviews;
  const recentPresets = engine.recentPresets;
  const requestedPresetId = ui.routeState.presetId;
  const catalog = engine.catalog;
  const catalogReady = engine.catalogReady;

  const hasFavorites = favoritePresets.length > 0;
  const showJumpBack = hasFavorites;

  const [loadingAudio, setLoadingAudio] = useState(false);

  useEffect(() => {
    if (engineSnapshot?.audioActive) setLoadingAudio(false);
  }, [engineSnapshot?.audioActive]);

  const handleStartAudio = useCallback(
    (source: 'demo' | 'microphone' | 'tab') => {
      setLoadingAudio(true);
      void engine
        .handleAudioStart(source)
        .finally(() => setLoadingAudio(false));
    },
    [engine.handleAudioStart],
  );

  useEffect(() => {
    if (!catalogReady || catalog.length === 0) return;
    const ids = catalog.slice(0, 6).map((e) => e.id);
    if (featuredPreset && !ids.includes(featuredPreset.id)) {
      ids.unshift(featuredPreset.id);
    }
    void engine.requestPresetPreviews(ids);
  }, [catalogReady, catalog, featuredPreset, engine.requestPresetPreviews]);

  return (
    <section
      className="stims-shell__launch"
      data-audio-controls
      aria-labelledby="stims-launch-title"
    >
      <div className="stims-shell__launch-hero">
        <div className="stims-shell__launch-header">
          <div className="stims-shell__launch-copy">
            <p className="stims-shell__eyebrow">Browser visualizer</p>
            <h1 id="stims-launch-title">Sound into motion.</h1>
            <p className="stims-shell__launch-summary">
              Demo audio starts automatically. Switch to your own music anytime.
              {catalogReady
                ? ` ${catalog.length} presets run in WebGL or WebGPU.`
                : ' Presets run in WebGL or WebGPU.'}
            </p>
          </div>
          <div className="stims-shell__launch-stack">
            <div className="stims-shell__launch-supplement stims-shell__launch-actions">
              <button
                type="button"
                className="cta-button ghost"
                disabled={loadingAudio}
                onClick={() => handleStartAudio('microphone')}
              >
                Use microphone
              </button>
              <button
                type="button"
                className="cta-button ghost"
                disabled={loadingAudio}
                onClick={() => handleStartAudio('tab')}
              >
                Capture tab audio
              </button>
            </div>
          </div>
        </div>
      </div>

      {featuredPreset ? (
        <button
          type="button"
          className="stims-shell__launch-recommendation"
          onClick={() => engine.handlePlayPreset(featuredPreset.id)}
        >
          <PresetArtwork entry={featuredPreset} compact />
          <div className="stims-shell__launch-recommendation-copy">
            <p className="stims-shell__section-label">Featured pick</p>
            <strong>{featuredPreset.title}</strong>
            <span className="stims-shell__meta-copy">
              {describePresetMood(featuredPreset)}
            </span>
          </div>
        </button>
      ) : null}

      {missingRequestedPreset ? (
        <section className="stims-shell__launch-alert" data-tone="warn">
          <div className="stims-shell__launch-alert-copy">
            <p className="stims-shell__section-label">Saved pick not found</p>
            <strong>
              {requestedPresetId
                ? `"${requestedPresetId}" isn't available here anymore.`
                : "That saved pick isn't available here anymore."}
            </strong>
            <p className="stims-shell__meta-copy">
              {featuredPreset
                ? `Try ${featuredPreset.title} instead, or browse everything.`
                : 'Open the full list to pick another one.'}
            </p>
          </div>
          <div className="stims-shell__session-actions">
            {featuredPreset ? (
              <button
                type="button"
                className="cta-button primary"
                onClick={ui.handleFeaturedPresetSelection}
              >
                Try featured pick
              </button>
            ) : null}
            <button
              type="button"
              className="cta-button"
              onClick={ui.handleBrowseRecovery}
            >
              Browse everything
            </button>
          </div>
        </section>
      ) : null}

      {showJumpBack ? (
        <PresetShelfSection
          entries={buildJumpBackEntries(favoritePresets, recentPresets)}
          summary=""
          title="Jump back in"
          onSelect={engine.handlePlayPreset}
          presetPreviews={presetPreviews}
        />
      ) : null}
      {catalogReady && catalog.length > 0 ? (
        <PresetShelfSection
          entries={catalog.slice(0, 6).map((entry) => ({
            entry,
            label: entry.author || 'Unknown',
            summary: describePresetMood(entry),
          }))}
          summary=""
          title="Browse all presets"
          titleAction={{
            label: `See all ${catalog.length} \u2192`,
            onClick: () => ui.updatePanel('browse'),
          }}
          onSelect={engine.handlePlayPreset}
          presetPreviews={presetPreviews}
        />
      ) : null}
    </section>
  );
}
