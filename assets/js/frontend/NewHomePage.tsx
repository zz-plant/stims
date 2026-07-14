import { useEffect, useRef, useState } from 'react';
import type { UiIconName } from '../ui/icon-library.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
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

function ImageDropZone({
  onImageSelected,
}: {
  onImageSelected: (file: File) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      onImageSelected(file);
    }
  };

  const handleClick = () => inputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file?.type.startsWith('image/')) {
      onImageSelected(file);
    }
  };

  return (
    <button
      className={`stims-shell__image-dropzone ${dragActive ? 'stims-shell__image-dropzone--active' : ''}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={handleClick}
      type="button"
      tabIndex={0}
      aria-label="Upload image to generate preset"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="stims-shell__image-dropzone-input"
        hidden
      />
      <UiIcon
        name="image"
        className="stims-shell__image-dropzone-icon"
        aria-hidden="true"
      />
      <p className="stims-shell__image-dropzone-text">
        {dragActive ? 'Drop image here' : 'Drop image or click to upload'}
      </p>
      <p className="stims-shell__image-dropzone-hint">
        AI will generate a visualizer from your image
      </p>
    </button>
  );
}

export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const featuredPreset = engine.featuredPreset;
  const catalogReady = engine.catalogReady;
  const catalog = engine.catalog;
  const [showCreate, setShowCreate] = useState(false);
  const { state, description, setDescription, generate } = useGeneratePreset();

  const _handleImageSelect = (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    ui.setStatusMessage('Analyzing image…');
    fetch('/api/image-to-preset', {
      method: 'POST',
      body: formData,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data.milkSource) {
          engine.updateEditorSource(data.milkSource);
          ui.setStatusMessage(`Generated: ${data.title || 'New Preset'}`);
        } else {
          throw new Error('No source returned');
        }
      })
      .catch((err) => {
        ui.setStatusMessage(`Failed: ${err.message}`);
      });
  };

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
            <p className="stims-shell__eyebrow">Your audio, in motion</p>
            <p>
              Paste a YouTube link, share a browser tab, or connect a
              microphone. Stims turns the music you choose into a live visual.
            </p>
          </div>

          <div className="stims-shell__launch-source-dock">
            <AudioSourcePanel showHelp={false} />
          </div>

          <div className="stims-shell__launch-actions">
            <button
              type="button"
              className="stims-shell__text-button stims-shell__explore-link"
              onClick={() => ui.updatePanel('browse')}
            >
              Explore presets
            </button>
          </div>

          <details
            className="stims-shell__launch-create"
            open={showCreate}
            onToggle={(event) => setShowCreate(event.currentTarget.open)}
          >
            <summary className="stims-shell__launch-create-summary">
              <span>
                <strong>Create a visual preset</strong>
                <small>Optional tools for making a look</small>
              </span>
            </summary>
            <div className="stims-shell__launch-create-body">
              <form
                className="stims-shell__generate-form"
                onSubmit={handleSubmit}
              >
                <div className="stims-shell__generate-input-wrap">
                  <label
                    htmlFor="generate-input"
                    className="stims-shell__sr-only"
                  >
                    Describe what you want to see
                  </label>
                  <input
                    id="generate-input"
                    type="text"
                    className="stims-shell__generate-input"
                    placeholder="Describe a visual style..."
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
                      state === 'generating'
                        ? 'Generating...'
                        : 'Generate visual preset'
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
                      'Generate preset'
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

              <ImageDropZone
                onImageSelected={async (file) => {
                  const formData = new FormData();
                  formData.append('image', file);
                  ui.setStatusMessage('Analyzing image…');
                  try {
                    const res = await fetch('/api/image-to-preset', {
                      method: 'POST',
                      body: formData,
                    });
                    if (!res.ok) throw new Error(`Server error: ${res.status}`);
                    const data = await res.json();
                    if (data.milkSource) {
                      await engine.updateEditorSource(data.milkSource);
                      ui.setStatusMessage(
                        `Generated: ${data.title || 'New Preset'}`,
                      );
                    } else {
                      throw new Error('No source returned');
                    }
                  } catch (err) {
                    const error = err as Error;
                    ui.setStatusMessage(
                      `Image-to-preset failed: ${error.message}`,
                    );
                  }
                }}
              />
            </div>
          </details>
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
