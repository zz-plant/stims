import { useEffect } from 'react';
import type { UiIconName } from '../ui/icon-library.ts';
import { useGeneratePreset } from './hooks/useGeneratePreset.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';

const MOOD_SHORTCUTS: Array<{ label: string; desc: string; icon: UiIconName }> =
  [
    { label: 'Chill', desc: 'slow drifting ambient', icon: 'sparkles' },
    { label: 'Aggressive', desc: 'intense bass reactive', icon: 'pulse' },
    {
      label: 'Retro',
      desc: 'classic 90s demoscene',
      icon: 'picture-in-picture',
    },
    { label: 'Cosmic', desc: 'deep space nebula drift', icon: 'sparkles' },
  ];

export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const featuredPreset = engine.featuredPreset;
  const catalogReady = engine.catalogReady;
  const catalog = engine.catalog;
  const { state, description, setDescription, generate } = useGeneratePreset();

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generate();
  };

  const handleMoodClick = (mood: (typeof MOOD_SHORTCUTS)[0]) => {
    setDescription(mood.desc);
    generate(mood.desc);
  };

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

          <form className="stims-shell__generate-form" onSubmit={handleSubmit}>
            <div className="stims-shell__generate-input-wrap">
              <label htmlFor="generate-input" className="stims-shell__sr-only">
                Describe what you want to see
              </label>
              <input
                id="generate-input"
                type="text"
                className="stims-shell__generate-input"
                placeholder="Describe what you want to see..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={state === 'generating'}
                aria-busy={state === 'generating'}
              />
              <button
                type="submit"
                className="stims-shell__generate-btn"
                disabled={state === 'generating' || !description.trim()}
                aria-label={
                  state === 'generating' ? 'Generating...' : 'Generate'
                }
              >
                {state === 'generating' ? (
                  <>
                    <UiIcon
                      name="spinner"
                      className="stims-shell__generate-spinner"
                      aria-hidden="true"
                    />
                    Generating…
                  </>
                ) : (
                  'Generate'
                )}
              </button>
            </div>
          </form>

          <fieldset
            className="stims-shell__mood-shortcuts"
            aria-label="Quick moods"
          >
            {MOOD_SHORTCUTS.map((mood) => (
              <button
                key={mood.label}
                type="button"
                className="stims-shell__mood-btn"
                onClick={() => handleMoodClick(mood)}
                disabled={state === 'generating'}
                aria-label={`Generate ${mood.label.toLowerCase()} preset`}
              >
                <UiIcon
                  name={mood.icon}
                  className="stims-shell__mood-icon"
                  aria-hidden="true"
                />
                <span>{mood.label}</span>
              </button>
            ))}
          </fieldset>

          <button
            type="button"
            className="stims-shell__text-button stims-shell__explore-link"
            onClick={() => ui.updatePanel('browse')}
            disabled={state === 'generating'}
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
          disabled={state === 'generating'}
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
