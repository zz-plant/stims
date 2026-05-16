import { useCallback, useState } from 'react';
import type { MilkdropPresetRenderPreview } from '../milkdrop/preset-preview.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import type { ReadinessItem } from './workspace-helpers.ts';
import { describePresetMood } from './workspace-helpers.ts';
import { PresetArtwork, PresetShelfSection } from './workspace-ui.tsx';

const FIRST_VISIT_KEY = 'stims:visited_before';

function buildJumpBackEntries(
  favoritePresets: PresetCatalogEntry[],
  recentPresets: PresetCatalogEntry[],
) {
  return [
    ...favoritePresets.map((entry) => ({
      entry,
      label: 'Saved pick' as const,
      summary: 'A favorite you saved for an easy return.',
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
        summary: 'Something you opened recently and can jump back into.',
      })),
  ].slice(0, 3);
}

export function NewHomePage({
  engineReady,
  featuredPreset,
  favoritePresets,
  missingRequestedPreset,
  onAudioStart,
  onBrowseRecovery,
  onFeaturedPresetSelection,
  onPresetSelection,
  presetPreviews,
  readinessAlerts,
  recentPresets,
  requestedPresetId,
}: {
  engineReady: boolean;
  featuredPreset: PresetCatalogEntry | null;
  favoritePresets: PresetCatalogEntry[];
  missingRequestedPreset: boolean;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onBrowseRecovery: () => void;
  onFeaturedPresetSelection: () => void;
  onPresetSelection: (presetId: string) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  readinessAlerts: ReadinessItem[];
  recentPresets: PresetCatalogEntry[];
  requestedPresetId: string | null;
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined')
      return true;
    return localStorage.getItem(FIRST_VISIT_KEY) === 'true';
  });
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(FIRST_VISIT_KEY, 'true');
    } catch {}
  }, []);

  const hasFavorites = favoritePresets.length > 0;
  const hasRecent = recentPresets.length > 0;
  const showJumpBack = hasFavorites || hasRecent;

  return (
    <div className="stims-shell__launch" data-audio-controls>
      <div className="stims-shell__launch-hero">
        <div className="stims-shell__launch-header">
          <div className="stims-shell__launch-copy">
            <p className="stims-shell__eyebrow">Browser visualizer</p>
            <h1>Sound into motion.</h1>
            <p className="stims-shell__launch-summary">
              Start with demo audio, then switch to your own music. Authentic
              MilkDrop presets run in WebGL or WebGPU.
            </p>
          </div>
          <div className="stims-shell__launch-stack">
            <button
              id="use-demo-audio"
              data-demo-audio-btn="true"
              className="cta-button primary stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => onAudioStart('demo')}
            >
              <span className="stims-shell__action-label">See visuals now</span>
              <span className="stims-shell__action-hint">
                Starts instantly with built-in sound
              </span>
            </button>
            <div className="stims-shell__launch-supplement">
              <button
                type="button"
                className="cta-button ghost"
                disabled={!engineReady}
                onClick={() => onAudioStart('microphone')}
              >
                Use microphone
              </button>
              <button
                type="button"
                className="cta-button ghost"
                disabled={!engineReady}
                onClick={() => onAudioStart('tab')}
              >
                Capture tab audio
              </button>
            </div>
          </div>
        </div>

        {featuredPreset ? (
          <button
            type="button"
            className="stims-shell__launch-recommendation"
            onClick={() => onPresetSelection(featuredPreset.id)}
          >
            <div className="stims-shell__launch-recommendation-top">
              <p className="stims-shell__section-label">Featured pick</p>
            </div>
            <PresetArtwork entry={featuredPreset} />
            <div className="stims-shell__launch-recommendation-copy">
              <strong>{featuredPreset.title}</strong>
              <span className="stims-shell__meta-copy">
                {describePresetMood(featuredPreset)}
              </span>
            </div>
          </button>
        ) : null}
      </div>

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
                onClick={onFeaturedPresetSelection}
              >
                Try featured pick
              </button>
            ) : null}
            <button
              type="button"
              className="cta-button"
              onClick={onBrowseRecovery}
            >
              Browse everything
            </button>
          </div>
        </section>
      ) : null}

      {!dismissed ? (
        <section className="stims-shell__confidence-note">
          <strong>Browser-native MilkDrop visualizer</strong>
          <span>
            Runs authentic .milk presets via WebGPU or WebGL. Press play with
            demo audio, then switch to your own music.
          </span>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={dismiss}
          >
            Got it
          </button>
        </section>
      ) : null}

      {readinessAlerts.length > 0 ? (
        <section className="stims-shell__readiness-chips">
          {readinessAlerts.map((item) => (
            <article
              key={item.id}
              className="stims-shell__readiness-chip"
              data-state={item.state}
            >
              <strong>{item.label}</strong>
              <span>{item.summary}</span>
            </article>
          ))}
        </section>
      ) : null}

      {showJumpBack ? (
        <PresetShelfSection
          entries={buildJumpBackEntries(favoritePresets, recentPresets)}
          summary="Saved picks and recent stops."
          title="Jump back in"
          onSelect={onPresetSelection}
          presetPreviews={presetPreviews}
        />
      ) : null}
    </div>
  );
}
