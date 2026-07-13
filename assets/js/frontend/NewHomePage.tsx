import { useEffect } from 'react';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { PresetArtwork } from './PresetArtwork.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';

export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const featuredPreset = engine.featuredPreset;
  const missingRequestedPreset = engine.missingRequestedPreset;
  const requestedPresetId = ui.routeState.presetId;
  const catalog = engine.catalog;
  const catalogError = engine.catalogError;
  const catalogReady = engine.catalogReady;

  const focusYouTubeInput = () => {
    requestAnimationFrame(() => {
      const youtubeInput = document.querySelector<HTMLInputElement>(
        '[data-youtube-url-input="true"]',
      );
      youtubeInput?.focus();
      youtubeInput?.select();
    });
  };

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
            <h1 id="stims-launch-title">Stims</h1>
            <p className="stims-shell__launch-summary">
              Paste a YouTube link, capture a tab, or connect live audio. Stims
              visualizes music you choose.
            </p>
          </div>
          <div className="stims-shell__launch-stack">
            <div
              className="stims-shell__launch-supplement stims-shell__launch-actions"
              aria-live="polite"
              aria-atomic="true"
            >
              <button
                type="button"
                className="cta-button primary"
                onClick={focusYouTubeInput}
              >
                Visualize YouTube
              </button>
              <button
                type="button"
                className="cta-button ghost"
                onClick={() => ui.updatePanel('browse')}
              >
                Explore presets
              </button>
              <div className="stims-shell__launch-source-dock">
                <AudioSourcePanel showHelp={false} />
              </div>
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
    </section>
  );
}
