import { useEffect } from 'react';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { PresetArtwork } from './PresetArtwork.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';

export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const featuredPreset = engine.featuredPreset;
  const catalogReady = engine.catalogReady;
  const catalog = engine.catalog;

  useEffect(() => {
    if (!catalogReady || catalog.length === 0 || !featuredPreset) return;
    const ids = [featuredPreset.id];
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
        <div className="stims-shell__launch-header stims-shell__launch-layout">
          <div className="stims-shell__launch-rail">
            <div className="stims-shell__launch-copy">
              <h1 id="stims-launch-title">Stims</h1>
              <p className="stims-shell__launch-subhead">
                Audio-reactive visualizer. Select a preset or connect an audio
                source to begin.
              </p>
            </div>

            <div className="stims-shell__launch-actions">
              <button
                type="button"
                className="stims-shell__text-button stims-shell__explore-link"
                onClick={() => ui.updatePanel('browse')}
              >
                Browse presets
              </button>
            </div>

            {featuredPreset ? (
              <button
                type="button"
                className="stims-shell__launch-recommendation"
                aria-label={`Play ${featuredPreset.title}`}
                onClick={() => engine.handlePlayPreset(featuredPreset.id)}
              >
                <PresetArtwork entry={featuredPreset} compact />
                <div className="stims-shell__launch-recommendation-copy">
                  <span className="stims-shell__recommendation-badge">
                    Featured
                  </span>
                  <strong>{featuredPreset.title}</strong>
                  <span className="stims-shell__meta-copy">
                    {describePresetMood(featuredPreset)}
                  </span>
                </div>
                <span
                  className="stims-shell__launch-recommendation-arrow"
                  aria-hidden="true"
                >
                  →
                </span>
              </button>
            ) : null}
          </div>

          <div className="stims-shell__launch-source-dock">
            <AudioSourcePanel showHelp={false} />
          </div>
        </div>
      </div>
    </section>
  );
}
