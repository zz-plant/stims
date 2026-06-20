import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
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
  const catalogError = engine.catalogError;
  const catalogReady = engine.catalogReady;

  const hasFavorites = favoritePresets.length > 0;
  const showJumpBack = hasFavorites;

  const [loadingAudio, setLoadingAudio] = useState(false);
  const loadingAudioRef = useRef(false);

  useEffect(() => {
    if (engineSnapshot?.audioActive) setLoadingAudio(false);
  }, [engineSnapshot?.audioActive]);

  const handleStartAudio = useCallback(
    (source: 'demo' | 'microphone' | 'tab') => {
      if (loadingAudioRef.current) return;
      loadingAudioRef.current = true;
      setLoadingAudio(true);
      void engine.handleAudioStart(source).finally(() => {
        loadingAudioRef.current = false;
        if (!engineSnapshot?.audioActive) setLoadingAudio(false);
      });
    },
    [engine.handleAudioStart, engineSnapshot?.audioActive],
  );

  useEffect(() => {
    if (!catalogReady || catalog.length === 0) return;
    // Only the featured preset gets an immediate runtime preview. Rendering
    // shelf previews for the whole catalog on load dominates main thread time
    // and pushes Lighthouse TBT into the red zone.
    const ids = featuredPreset ? [featuredPreset.id] : [];
    if (ids.length === 0) return;

    // Defer preview generation until the main thread is idle so the initial
    // render and interactivity aren't blocked by compiling the renderer.
    const request = () => void engine.requestPresetPreviews(ids);
    const handle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(request, { timeout: 2000 })
        : setTimeout(request, 1000);
    return () => {
      if (
        typeof cancelIdleCallback === 'function' &&
        typeof handle === 'number'
      ) {
        cancelIdleCallback(handle);
      } else {
        clearTimeout(handle);
      }
    };
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
            <p className="stims-shell__eyebrow">Audio visualizer</p>
            <h1 id="stims-launch-title">Play music. Watch it move.</h1>
            <p className="stims-shell__launch-summary">
              Start instantly with demo audio, or connect your own sound when
              you’re ready.
              {catalogReady
                ? ` ${catalog.length} presets run in WebGL or WebGPU.`
                : ' Presets run in WebGL or WebGPU.'}
            </p>
          </div>
          <div className="stims-shell__launch-stack">
            <div
              className="stims-shell__launch-supplement stims-shell__launch-actions"
              aria-live="polite"
              aria-atomic="true"
            >
              {loadingAudio ? (
                <span className="sr-only">Starting audio input…</span>
              ) : null}
              <button
                type="button"
                className="cta-button primary"
                disabled={loadingAudio}
                onClick={() => handleStartAudio('demo')}
              >
                Play with demo audio
              </button>
              <div className="stims-shell__audio-setup-details">
                <AudioSourcePanel />
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="stims-shell__scroll-hint">Scroll to explore presets</p>

      {featuredPreset ? (
        <button
          type="button"
          className="stims-shell__launch-recommendation"
          onClick={() => engine.handlePlayPreset(featuredPreset.id)}
        >
          <PresetArtwork entry={featuredPreset} compact />
          <div className="stims-shell__launch-recommendation-copy">
            <p className="stims-shell__section-label">Recommended preset</p>
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
                ? `Try ${featuredPreset.title} instead, or browse all presets.`
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
                Play recommended preset
              </button>
            ) : null}
            <button
              type="button"
              className="cta-button"
              onClick={ui.handleBrowseRecovery}
            >
              Explore presets
            </button>
          </div>
        </section>
      ) : null}

      {catalogError && catalog.length === 0 ? (
        <section className="stims-shell__launch-alert" data-tone="error">
          <div className="stims-shell__launch-alert-copy">
            <p className="stims-shell__section-label">Couldn’t load presets</p>
            <strong>{catalogError}</strong>
          </div>
          <div className="stims-shell__session-actions">
            <button
              type="button"
              className="cta-button primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
            <button
              type="button"
              className="cta-button"
              onClick={() => ui.updatePanel('browse')}
            >
              Browse presets
            </button>
          </div>
        </section>
      ) : null}

      {showJumpBack ? (
        <PresetShelfSection
          entries={buildJumpBackEntries(favoritePresets, recentPresets)}
          summary=""
          title="Saved presets"
          onSelect={engine.handlePlayPreset}
          presetPreviews={presetPreviews}
          onVisible={() => {
            const ids = buildJumpBackEntries(
              favoritePresets,
              recentPresets,
            ).map(({ entry }) => entry.id);
            if (ids.length > 0) void engine.requestPresetPreviews(ids);
          }}
        />
      ) : catalogReady ? (
        <section
          className="stims-shell__starter-section"
          aria-labelledby="stims-saved-empty"
        >
          <div className="stims-shell__section-heading">
            <h2 id="stims-saved-empty" className="stims-shell__section-label">
              Saved presets
            </h2>
          </div>
          <div className="stims-shell__starter-grid">
            <button
              type="button"
              className="stims-shell__starter-card"
              onClick={() => ui.updatePanel('browse')}
            >
              <div
                className="stims-shell__preset-art"
                data-tone="instant"
                data-preview-status="queued"
                aria-hidden="true"
              >
                <span className="stims-shell__preset-art-grid" />
                <span className="stims-shell__preset-art-orbit" />
                <span className="stims-shell__preset-art-core" />
              </div>
              <span className="stims-shell__starter-label">Empty</span>
              <strong>Save your first preset</strong>
              <span className="stims-shell__meta-copy">
                Browse and save anything you want to replay later.
              </span>
            </button>
          </div>
        </section>
      ) : null}
      {catalogReady && catalog.length > 0 ? (
        <PresetShelfSection
          entries={catalog.slice(0, 6).map((entry) => ({
            entry,
            label: entry.author || 'Unknown',
            summary: describePresetMood(entry),
          }))}
          summary=""
          title="Explore presets"
          titleAction={{
            label: `See all ${catalog.length} \u2192`,
            onClick: () => ui.updatePanel('browse'),
          }}
          onSelect={engine.handlePlayPreset}
          presetPreviews={presetPreviews}
          onVisible={() => {
            const ids = catalog.slice(0, 6).map((entry) => entry.id);
            if (ids.length > 0) void engine.requestPresetPreviews(ids);
          }}
        />
      ) : null}
    </section>
  );
}
