import type { PresetCatalogEntry } from './contracts.ts';
import { useWorkspace } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';
import { PresetArtwork, PresetShelfSection, UiIcon } from './workspace-ui.tsx';

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

export function NewHomePage() {
  const w = useWorkspace();
  const engineReady = w.engineReady;
  const featuredPreset = w.featuredPreset;
  const favoritePresets = w.favoritePresets;
  const missingRequestedPreset = w.missingRequestedPreset;
  const presetPreviews = w.presetPreviews;
  const recentPresets = w.recentPresets;
  const requestedPresetId = w.routeState.presetId;
  const catalog = w.catalog;
  const catalogReady = w.catalogReady;

  const hasFavorites = favoritePresets.length > 0;
  const hasRecent = recentPresets.length > 0;
  const showJumpBack = hasFavorites || hasRecent;

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
              Start with demo audio, then switch to your own music. No sign-up,
              no setup.
              {catalogReady
                ? ` ${catalog.length} authentic MilkDrop presets run in WebGL or WebGPU.`
                : ' Authentic MilkDrop presets run in WebGL or WebGPU.'}
            </p>
            <div className="stims-shell__launch-kicker-row">
              <span>Instant demo</span>
              <span>
                {catalogReady
                  ? `${catalog.length} classic presets`
                  : 'Classic presets'}
              </span>
              <span>Shuffle anytime</span>
            </div>
          </div>
          <div className="stims-shell__launch-stack">
            <button
              id="use-demo-audio"
              data-demo-audio-btn="true"
              className="cta-button primary stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => void w.handleAudioStart('demo')}
            >
              <span className="stims-shell__action-label">See visuals now</span>
              <span className="stims-shell__action-hint">
                Starts built-in audio and drops you into the stage
              </span>
            </button>
            <div className="stims-shell__launch-supplement stims-shell__launch-actions">
              <button
                type="button"
                className="cta-button ghost"
                disabled={!engineReady}
                onClick={() => void w.handleAudioStart('microphone')}
              >
                Use microphone
              </button>
              <button
                type="button"
                className="cta-button ghost"
                disabled={!engineReady}
                onClick={() => void w.handleAudioStart('tab')}
              >
                Capture tab audio
              </button>
            </div>
            <div className="stims-shell__launch-mini-mixer" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <a
              href="https://github.com/zz-plant/stims"
              className="cta-button ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              <UiIcon
                name="github"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              GitHub
            </a>
          </div>
        </div>
      </div>

      {featuredPreset ? (
        <button
          type="button"
          className="stims-shell__launch-recommendation"
          onClick={() => w.handlePresetSelection(featuredPreset.id)}
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
                onClick={w.handleFeaturedPresetSelection}
              >
                Try featured pick
              </button>
            ) : null}
            <button
              type="button"
              className="cta-button"
              onClick={w.handleBrowseRecovery}
            >
              Browse everything
            </button>
          </div>
        </section>
      ) : null}

      {showJumpBack ? (
        <PresetShelfSection
          entries={buildJumpBackEntries(favoritePresets, recentPresets)}
          summary="Saved picks and recent stops."
          title="Jump back in"
          onSelect={w.handlePresetSelection}
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
          summary="Pick a preset to start with."
          title="Browse all presets"
          onSelect={w.handlePresetSelection}
          presetPreviews={presetPreviews}
        />
      ) : null}
    </section>
  );
}
