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
        <div className="stims-shell__launch-header">
          <div className="stims-shell__launch-copy">
            <h1 id="stims-launch-title">Stims</h1>
            <p className="stims-shell__eyebrow">Sound into motion</p>
          </div>
          <div className="stims-shell__launch-source-dock">
            <AudioSourcePanel showHelp={false} />
          </div>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={() => ui.updatePanel('browse')}
          >
            Explore presets
          </button>
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
            <p className="stims-shell__section-label">Recommended</p>
            <strong>{featuredPreset.title}</strong>
            <span className="stims-shell__meta-copy">
              {describePresetMood(featuredPreset)}
            </span>
          </div>
        </button>
      ) : null}
    </section>
  );
}
