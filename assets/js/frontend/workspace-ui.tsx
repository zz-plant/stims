import type { ReactNode, RefObject } from 'react';
import type { MotionPreference } from '../core/motion-preferences.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import { getIconNodes, type UiIconName } from '../ui/icon-library.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import {
  describePresetMood,
  formatAudioSourceLabel,
  formatPresetSupportNote,
  getPresetCardSupportLabel,
  getQualityImpactSummary,
  getSettingsPresetOptions,
  getToolDescription,
  getToolLabel,
  prettifyCollectionTag,
  type ReadinessItem,
  type StarterPreset,
  TOOL_TABS,
} from './workspace-helpers.ts';

function UiIcon({ name, className }: { name: UiIconName; className: string }) {
  const nodes = getIconNodes(name);
  const title = name.replace(/-/g, ' ');

  return (
    <span className={className} aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        data-icon={name}
      >
        <title>{title}</title>
        {nodes.map(({ tag, attrs }) => {
          const key = `${name}-${tag}-${Object.entries(attrs)
            .map(([attrName, value]) => `${attrName}:${value}`)
            .join('|')}`;
          if (tag === 'path') {
            return <path key={key} {...attrs} />;
          }
          if (tag === 'circle') {
            return <circle key={key} {...attrs} />;
          }
          return <rect key={key} {...attrs} />;
        })}
      </svg>
    </span>
  );
}

function getPresetArtworkTone(entry: PresetCatalogEntry) {
  const mood = describePresetMood(entry);

  switch (mood) {
    case 'Bright pulse':
      return 'bright';
    case 'Sharp geometry':
      return 'geometry';
    case 'Space drift':
      return 'space';
    case 'Moody sweep':
      return 'moody';
    case 'Psychedelic spin':
      return 'psychedelic';
    case 'Classic rush':
      return 'classic';
    default:
      return 'instant';
  }
}

function PresetArtwork({
  entry,
  compact = false,
}: {
  entry: PresetCatalogEntry;
  compact?: boolean;
}) {
  const mood = describePresetMood(entry);

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={getPresetArtworkTone(entry)}
      data-compact={String(compact)}
      aria-hidden="true"
    >
      <span className="stims-shell__preset-art-grid" />
      <span className="stims-shell__preset-art-orbit" />
      <span className="stims-shell__preset-art-core" />
      <span className="stims-shell__preset-art-caption">{mood}</span>
    </div>
  );
}

function PresetShelfSection({
  entries,
  summary,
  title,
  onSelect,
}: {
  entries: Array<{
    entry: PresetCatalogEntry;
    label: string;
    summary: string;
  }>;
  summary: string;
  title: string;
  onSelect: (presetId: string) => void;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="stims-shell__starter-section">
      <div className="stims-shell__section-heading">
        <p className="stims-shell__section-label">{title}</p>
        <p className="stims-shell__meta-copy">{summary}</p>
      </div>
      <div className="stims-shell__starter-grid">
        {entries.map(({ entry, label, summary: cardSummary }) => (
          <button
            key={`${title}-${entry.id}`}
            type="button"
            className="stims-shell__starter-card"
            onClick={() => onSelect(entry.id)}
          >
            <PresetArtwork entry={entry} />
            <span className="stims-shell__starter-label">{label}</span>
            <strong>{entry.title}</strong>
            <span className="stims-shell__meta-copy">{cardSummary}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AudioSourcePanel({
  engineReady,
  onAudioStart,
  onLoadYouTube,
  onYoutubeUrlChange,
  youtubePreviewRef,
  youtubeReady,
  youtubeUrl,
}: {
  engineReady: boolean;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onLoadYouTube: () => void;
  onYoutubeUrlChange: (value: string) => void;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;
}) {
  return (
    <div className="stims-shell__source-panel">
      <div className="stims-shell__source-heading">
        <p className="stims-shell__section-label">Use my music</p>
        <p className="stims-shell__meta-copy">
          Pick a live source only when you want the visuals to follow your own
          sound.
        </p>
      </div>
      <div className="stims-shell__source-grid">
        <button
          id="start-audio-btn"
          type="button"
          className="stims-shell__source-card"
          disabled={!engineReady}
          onClick={() => onAudioStart('microphone')}
        >
          <strong>Microphone</strong>
          <span>
            Needs mic permission. React to the room, your speakers, or live
            sound.
          </span>
        </button>
        <button
          type="button"
          id="use-tab-audio"
          className="stims-shell__source-card"
          disabled={!engineReady}
          onClick={() => onAudioStart('tab')}
        >
          <strong>This tab</strong>
          <span>
            Share this tab when prompted to capture audio already playing here.
          </span>
        </button>
      </div>
      <div className="stims-shell__youtube">
        <label className="stims-shell__field-label" htmlFor="youtube-url">
          Paste a YouTube link, then start capture
        </label>
        <div className="stims-shell__youtube-row">
          <input
            id="youtube-url"
            className="stims-shell__input"
            type="url"
            placeholder="https://youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(event) => onYoutubeUrlChange(event.target.value)}
          />
          <button
            id="load-youtube"
            className="cta-button"
            type="button"
            disabled={!engineReady}
            onClick={onLoadYouTube}
          >
            Load
          </button>
          <button
            id="use-youtube-audio"
            className="cta-button"
            type="button"
            disabled={!engineReady || !youtubeReady}
            onClick={() => onAudioStart('youtube')}
          >
            Start capture
          </button>
        </div>
        <div
          id="youtube-player-container"
          ref={youtubePreviewRef}
          className="stims-shell__youtube-preview"
          hidden
        >
          <div id="workspace-youtube-player"></div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceLaunchPanel({
  embedded = false,
  engineReady,
  favoritePresets,
  featuredPreset,
  launchEyebrow,
  launchSummary,
  launchTitle,
  missingRequestedPreset,
  onAudioStart,
  onBrowseRecovery,
  onFeaturedPresetSelection,
  onLoadYouTube,
  onPresetSelection,
  onToggleExtendedSources,
  onYoutubeUrlChange,
  recentPresets,
  readinessAlerts,
  requestedPresetId,
  showExtendedSources,
  youtubePreviewRef,
  youtubeReady,
  youtubeUrl,
}: {
  embedded?: boolean;
  engineReady: boolean;
  favoritePresets: PresetCatalogEntry[];
  featuredPreset: PresetCatalogEntry | null;
  launchEyebrow: string;
  launchSummary: string;
  launchTitle: string;
  missingRequestedPreset: boolean;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onBrowseRecovery: () => void;
  onFeaturedPresetSelection: () => void;
  onLoadYouTube: () => void;
  onPresetSelection: (presetId: string) => void;
  onToggleExtendedSources: () => void;
  onYoutubeUrlChange: (value: string) => void;
  recentPresets: PresetCatalogEntry[];
  readinessAlerts: ReadinessItem[];
  requestedPresetId: string | null;
  showExtendedSources: boolean;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;
}) {
  const rootClassName = embedded
    ? 'stims-shell__launch-panel'
    : 'stims-shell__launch';
  const jumpBackInEntries = [
    ...favoritePresets.map((entry) => ({
      entry,
      label: 'Saved pick',
      summary: 'A look you already marked to come back to.',
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
        label: 'Recent',
        summary: 'A preset you opened recently and can jump back into.',
      })),
  ].slice(0, 3);

  return (
    <div className={rootClassName} data-audio-controls>
      <div className="stims-shell__launch-hero">
        <div className="stims-shell__launch-header">
          <div className="stims-shell__launch-copy">
            <p className="stims-shell__eyebrow">{launchEyebrow}</p>
            <h1>{launchTitle}</h1>
            <p>{launchSummary}</p>
          </div>
        </div>

        <div className="stims-shell__launch-stack">
          <div className="stims-shell__launch-actions">
            <button
              id="use-demo-audio"
              data-demo-audio-btn="true"
              className="cta-button primary stims-shell__action-button"
              type="button"
              disabled={!engineReady}
              onClick={() => onAudioStart('demo')}
            >
              <span className="stims-shell__action-label">
                Play with demo audio
              </span>
            </button>
            <button
              type="button"
              className="cta-button stims-shell__action-button stims-shell__action-button--secondary"
              onClick={onToggleExtendedSources}
            >
              <span className="stims-shell__action-label">Use my music</span>
            </button>
          </div>
          <div className="stims-shell__confidence-note">
            <strong>Runs best on desktop and laptop.</strong>
            <span>
              Phones and older browsers can fall back to lighter visuals
              automatically.
            </span>
          </div>

          <div className="stims-shell__launch-more">
            {showExtendedSources ? (
              <AudioSourcePanel
                engineReady={engineReady}
                onAudioStart={onAudioStart}
                onLoadYouTube={onLoadYouTube}
                onYoutubeUrlChange={onYoutubeUrlChange}
                youtubePreviewRef={youtubePreviewRef}
                youtubeReady={youtubeReady}
                youtubeUrl={youtubeUrl}
              />
            ) : null}
          </div>
        </div>
      </div>

      {missingRequestedPreset ? (
        <section className="stims-shell__launch-alert" data-tone="warn">
          <div className="stims-shell__launch-alert-copy">
            <p className="stims-shell__section-label">
              Requested preset missing
            </p>
            <strong>
              {requestedPresetId
                ? `"${requestedPresetId}" is no longer bundled here.`
                : 'That preset is no longer bundled here.'}
            </strong>
            <p className="stims-shell__meta-copy">
              {featuredPreset
                ? `Start with ${featuredPreset.title} or open the full library.`
                : 'Open the preset library to pick another one.'}
            </p>
          </div>
          <div className="stims-shell__session-actions">
            {featuredPreset ? (
              <button
                type="button"
                className="cta-button primary"
                onClick={onFeaturedPresetSelection}
              >
                Load featured preset
              </button>
            ) : null}
            <button
              type="button"
              className="cta-button"
              onClick={onBrowseRecovery}
            >
              Browse presets
            </button>
          </div>
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

      <PresetShelfSection
        entries={jumpBackInEntries}
        summary="Saved and recent presets stay close so repeat sessions start faster."
        title="Jump back in"
        onSelect={onPresetSelection}
      />
    </div>
  );
}

export function WorkspaceStagePanel({
  audioSource,
  backend,
  engineReady,
  invalidExperienceSlug,
  isFullscreen,
  launchPanel,
  liveMode,
  missingRequestedPreset,
  onAudioStart,
  onLoadYouTube,
  onOpenBrowse,
  onOpenSettings,
  onShowCurrentLink,
  onShufflePreset,
  onToggleExtendedSources,
  onToggleFullscreen,
  onYoutubeUrlChange,
  stageEyebrow,
  stageRef,
  stageSummary,
  stageTitle,
  showExtendedSources,
  youtubePreviewRef,
  youtubeReady,
  youtubeUrl,
}: {
  audioSource: 'demo' | 'microphone' | 'tab' | 'youtube' | null | undefined;
  backend: 'webgl' | 'webgpu' | null | undefined;
  engineReady: boolean;
  invalidExperienceSlug: string | null;
  isFullscreen: boolean;
  launchPanel: ReactNode;
  liveMode: boolean;
  missingRequestedPreset: boolean;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onLoadYouTube: () => void;
  onOpenBrowse: () => void;
  onOpenSettings: () => void;
  onShowCurrentLink: () => void;
  onShufflePreset: () => void;
  onToggleExtendedSources: () => void;
  onToggleFullscreen: () => void;
  onYoutubeUrlChange: (value: string) => void;
  stageEyebrow: string;
  stageRef: RefObject<HTMLDivElement | null>;
  stageSummary: string;
  stageTitle: string;
  showExtendedSources: boolean;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;
}) {
  return (
    <section
      className="stims-shell__workspace"
      data-mode={liveMode ? 'live' : 'home'}
    >
      <section className="stims-shell__stage-section">
        {liveMode ? (
          <div className="stims-shell__stage-header">
            <div className="stims-shell__stage-copy">
              <p className="stims-shell__eyebrow">{stageEyebrow}</p>
              <h2>{stageTitle}</h2>
              <p className="stims-shell__meta-copy stims-shell__stage-summary">
                {stageSummary}
              </p>
            </div>
            <div className="stims-shell__session-meta">
              <span className="stims-shell__meta-pill">
                {backend === 'webgpu'
                  ? 'Full detail'
                  : backend === 'webgl'
                    ? 'Performance mode'
                    : 'Starting up'}
              </span>
              <span className="stims-shell__meta-pill">
                {formatAudioSourceLabel(audioSource)}
              </span>
            </div>
          </div>
        ) : null}
        {liveMode && audioSource === 'demo' ? (
          <section className="stims-shell__audio-bridge">
            <div className="stims-shell__audio-bridge-copy">
              <p className="stims-shell__section-label">Switch to your music</p>
              <p className="stims-shell__meta-copy">
                Demo audio is running. Bring in your microphone, this tab, or a
                YouTube link when you want the visuals to follow your own sound.
              </p>
            </div>
            <div className="stims-shell__audio-bridge-actions">
              <button
                type="button"
                className="cta-button"
                onClick={onToggleExtendedSources}
              >
                {showExtendedSources ? 'Hide sources' : 'Use my music'}
              </button>
            </div>
            {showExtendedSources ? (
              <AudioSourcePanel
                engineReady={engineReady}
                onAudioStart={onAudioStart}
                onLoadYouTube={onLoadYouTube}
                onYoutubeUrlChange={onYoutubeUrlChange}
                youtubePreviewRef={youtubePreviewRef}
                youtubeReady={youtubeReady}
                youtubeUrl={youtubeUrl}
              />
            ) : null}
          </section>
        ) : null}

        <div
          className="stims-shell__stage-frame"
          data-mode={liveMode ? 'live' : 'home'}
        >
          <div ref={stageRef} className="stims-shell__stage-root" />
          {!liveMode ? (
            <div className="stims-shell__stage-hero">{launchPanel}</div>
          ) : null}
          {!missingRequestedPreset && !invalidExperienceSlug ? (
            <div
              className="stims-shell__stage-dock"
              role="toolbar"
              aria-label={liveMode ? 'Live controls' : 'Launch controls'}
            >
              {liveMode ? (
                <button
                  type="button"
                  className="stims-shell__stage-tool"
                  aria-label="Open library"
                  title="Open library"
                  onClick={onOpenBrowse}
                >
                  <UiIcon
                    name="sparkles"
                    className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                  />
                  <span className="stims-shell__stage-tool-label">Library</span>
                </button>
              ) : null}
              <button
                type="button"
                className="stims-shell__stage-tool"
                aria-label="Surprise me"
                title="Surprise me"
                onClick={onShufflePreset}
              >
                <UiIcon
                  name="pulse"
                  className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                />
                <span className="stims-shell__stage-tool-label">
                  Surprise me
                </span>
              </button>
              {liveMode ? (
                <button
                  type="button"
                  className="stims-shell__stage-tool"
                  aria-label="Open look settings"
                  title="Open look settings"
                  onClick={onOpenSettings}
                >
                  <UiIcon
                    name="sliders"
                    className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                  />
                  <span className="stims-shell__stage-tool-label">Look</span>
                </button>
              ) : null}
              <button
                type="button"
                className="stims-shell__stage-tool"
                aria-label={
                  isFullscreen ? 'Exit full screen' : 'Enter full screen'
                }
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
              <button
                type="button"
                className="stims-shell__stage-tool"
                aria-label="Share current link"
                title="Share current link"
                onClick={onShowCurrentLink}
              >
                <UiIcon
                  name="link"
                  className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                />
                <span className="stims-shell__stage-tool-label">Share</span>
              </button>
            </div>
          ) : null}
          {invalidExperienceSlug ? (
            <div className="active-toy-status is-error">
              <div className="active-toy-status__content">
                <h2>Older link</h2>
                <p>
                  This older Stims link points to a view that is no longer
                  available: "{invalidExperienceSlug}".
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function BrowseSheetPanel({
  catalog,
  catalogError,
  catalogReady,
  collectionTags,
  currentPresetId,
  favoritePresets,
  filteredCatalog,
  onCollectionTagChange,
  onPresetSelection,
  onSearchQueryChange,
  onShufflePreset,
  recentPresets,
  routeState,
  searchQuery,
  starterPresets,
}: {
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  currentPresetId: string | null;
  favoritePresets: PresetCatalogEntry[];
  filteredCatalog: PresetCatalogEntry[];
  onCollectionTagChange: (collectionTag: string | null) => void;
  onPresetSelection: (presetId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onShufflePreset: () => void;
  recentPresets: PresetCatalogEntry[];
  routeState: SessionRouteState;
  searchQuery: string;
  starterPresets: StarterPreset[];
}) {
  const showStarterPresets =
    searchQuery.trim().length === 0 && routeState.collectionTag === null;
  const showActivitySections = showStarterPresets;

  return (
    <div className="stims-shell__sheet-panel">
      <div className="stims-shell__browse-toolbar">
        <strong>Pick a look and press play.</strong>
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={onShufflePreset}
          disabled={catalog.length === 0}
        >
          Shuffle
        </button>
      </div>

      <label className="stims-shell__field-label" htmlFor="preset-search">
        Search
      </label>
      <input
        id="preset-search"
        className="stims-shell__input"
        type="search"
        placeholder="Search by preset, mood, creator, or collection"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.target.value)}
      />

      <nav className="stims-shell__collections" aria-label="Collections">
        <button
          type="button"
          className="stims-shell__collection-pill"
          data-active={String(routeState.collectionTag === null)}
          onClick={() => onCollectionTagChange(null)}
        >
          All
        </button>
        {collectionTags.map((collectionTag) => (
          <button
            key={collectionTag}
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(routeState.collectionTag === collectionTag)}
            onClick={() =>
              onCollectionTagChange(
                routeState.collectionTag === collectionTag
                  ? null
                  : collectionTag,
              )
            }
          >
            {prettifyCollectionTag(collectionTag)}
          </button>
        ))}
      </nav>

      {showStarterPresets && starterPresets.length > 0 ? (
        <section className="stims-shell__starter-section">
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Start here</p>
            <p className="stims-shell__meta-copy">
              Four quick ways into the catalog.
            </p>
          </div>
          <div className="stims-shell__starter-grid">
            {starterPresets.map((starter) => (
              <button
                key={starter.key}
                type="button"
                className="stims-shell__starter-card"
                onClick={() => onPresetSelection(starter.preset.id)}
              >
                <PresetArtwork entry={starter.preset} />
                <span className="stims-shell__starter-label">
                  {starter.label}
                </span>
                <strong>{starter.preset.title}</strong>
                <span className="stims-shell__meta-copy">
                  {starter.summary}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {showActivitySections ? (
        <PresetShelfSection
          entries={recentPresets.map((entry) => ({
            entry,
            label: 'Recent',
            summary: 'Reopen a preset you touched in an earlier session.',
          }))}
          summary="Recent presets help you resume a session without hunting."
          title="Recent"
          onSelect={onPresetSelection}
        />
      ) : null}

      {showActivitySections ? (
        <PresetShelfSection
          entries={favoritePresets.map((entry) => ({
            entry,
            label: 'Saved',
            summary: 'Pinned for quick return the next time you open Stims.',
          }))}
          summary="Saved presets stay visible even before the visualizer is live."
          title="Saved"
          onSelect={onPresetSelection}
        />
      ) : null}

      {!catalogReady && !catalogError ? (
        <p className="stims-shell__meta-copy">Loading catalog…</p>
      ) : null}
      {catalogError ? (
        <p className="stims-shell__meta-copy">{catalogError}</p>
      ) : null}
      <div className="stims-shell__section-heading">
        <p className="stims-shell__section-label">Full library</p>
        <p className="stims-shell__meta-copy">
          {filteredCatalog.length} preset
          {filteredCatalog.length === 1 ? '' : 's'}
          {searchQuery.trim().length > 0 || routeState.collectionTag
            ? ' match the current filters.'
            : ' ready to explore.'}
        </p>
      </div>
      <ul className="stims-shell__preset-list">
        {filteredCatalog.map((entry) => {
          const supportLabel = getPresetCardSupportLabel(entry);

          return (
            <li key={entry.id}>
              <button
                type="button"
                className="stims-shell__preset-card"
                data-active={String(entry.id === currentPresetId)}
                onClick={() => onPresetSelection(entry.id)}
              >
                <PresetArtwork entry={entry} compact />
                <span className="stims-shell__preset-card-copy">
                  <span className="stims-shell__preset-title">
                    {entry.title}
                  </span>
                  <span className="stims-shell__preset-vibe">
                    {describePresetMood(entry)}
                  </span>
                  <span className="stims-shell__preset-meta-row">
                    <span className="stims-shell__preset-meta">
                      {entry.author || 'Unknown author'}
                    </span>
                    {supportLabel ? (
                      <span className="stims-shell__preset-tech">
                        {supportLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="stims-shell__meta-copy">
                    {formatPresetSupportNote(entry)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SettingsSheetPanel({
  motionPreference,
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  onQualityPresetChange,
  onRenderPreferenceChange,
  qualityPreset,
  renderPreferences,
}: {
  motionPreference: MotionPreference;
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  onQualityPresetChange: (presetId: string) => void;
  onRenderPreferenceChange: (update: Partial<RenderPreferences>) => void;
  qualityPreset: QualityPreset;
  renderPreferences: RenderPreferences;
}) {
  const guidedPresets = getSettingsPresetOptions().slice(0, 3);

  return (
    <div className="stims-shell__sheet-panel">
      <p className="stims-shell__section-label">Quick looks</p>
      <ul className="stims-shell__preset-guides">
        {guidedPresets.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="stims-shell__preset-guide"
              data-active={String(preset.id === qualityPreset.id)}
              onClick={() => onQualityPresetChange(preset.id)}
            >
              <strong>{preset.label}</strong>
              <span className="stims-shell__meta-copy">
                {getQualityImpactSummary(preset)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <label className="stims-shell__field-label" htmlFor="quality-select">
        Or pick a specific visual profile
      </label>
      <select
        id="quality-select"
        className="stims-shell__select"
        value={qualityPreset.id}
        onChange={(event) => onQualityPresetChange(event.target.value)}
      >
        {getSettingsPresetOptions().map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      <p className="stims-shell__meta-copy">
        {qualityPreset.description ?? getQualityImpactSummary(qualityPreset)}
      </p>

      <details className="stims-shell__settings-advanced">
        <summary className="stims-shell__settings-summary">
          <span>Advanced tuning</span>
          <span className="stims-shell__meta-copy">
            Open this only when you want device-specific controls
          </span>
        </summary>
        <div className="stims-shell__settings-advanced-body">
          <label className="stims-shell__toggle">
            <input
              type="checkbox"
              checked={renderPreferences.compatibilityMode}
              onChange={(event) =>
                onCompatibilityModeChange(event.target.checked)
              }
            />
            <span className="stims-shell__toggle-copy">
              <strong>Keep visuals steadier on tricky hardware</strong>
              <small>
                Back off riskier graphics paths when the browser gets unstable.
              </small>
            </span>
          </label>

          <label className="stims-shell__toggle">
            <input
              type="checkbox"
              checked={motionPreference.enabled}
              onChange={(event) =>
                onMotionPreferenceChange(event.target.checked)
              }
            />
            <span className="stims-shell__toggle-copy">
              <strong>Use motion controls on supported devices</strong>
              <small>
                Mostly useful on phones and tablets that can react to tilt.
              </small>
            </span>
          </label>

          <label className="stims-shell__field-label" htmlFor="render-scale">
            Scene sharpness
          </label>
          <input
            id="render-scale"
            type="range"
            min="0.6"
            max="1.4"
            step="0.05"
            value={renderPreferences.renderScale ?? 1}
            onChange={(event) =>
              onRenderPreferenceChange({
                renderScale: Number.parseFloat(event.target.value),
              })
            }
          />
          <p className="stims-shell__meta-copy">
            Current scene sharpness:{' '}
            {(renderPreferences.renderScale ?? 1).toFixed(2)}x
          </p>

          <label className="stims-shell__field-label" htmlFor="max-pixel-ratio">
            Detail ceiling
          </label>
          <input
            id="max-pixel-ratio"
            type="range"
            min="0.75"
            max="3"
            step="0.05"
            value={renderPreferences.maxPixelRatio ?? 1.5}
            onChange={(event) =>
              onRenderPreferenceChange({
                maxPixelRatio: Number.parseFloat(event.target.value),
              })
            }
          />
          <p className="stims-shell__meta-copy">
            Current detail ceiling:{' '}
            {(renderPreferences.maxPixelRatio ?? 1.5).toFixed(2)}x
          </p>
        </div>
      </details>
    </div>
  );
}

function StageAnchoredToolCallout({
  panel,
}: {
  panel: 'editor' | 'inspector';
}) {
  return (
    <div className="stims-shell__sheet-callout">
      <h3>
        {panel === 'editor'
          ? 'Editor stays on the stage.'
          : 'Inspector stays on the stage.'}
      </h3>
    </div>
  );
}

export function WorkspaceToolSheet({
  catalog,
  catalogError,
  catalogReady,
  collectionTags,
  currentPresetId,
  favoritePresets,
  filteredCatalog,
  motionPreference,
  onClose,
  onCollectionTagChange,
  onCompatibilityModeChange,
  onImport,
  onMotionPreferenceChange,
  onPresetSelection,
  onQualityPresetChange,
  onRenderPreferenceChange,
  onSearchQueryChange,
  onShowCurrentLink,
  onShufflePreset,
  onTabChange,
  onExportPreset,
  panel,
  qualityPreset,
  recentPresets,
  renderPreferences,
  routeState,
  searchQuery,
  starterPresets,
  stageAnchoredToolOpen,
}: {
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  currentPresetId: string | null;
  favoritePresets: PresetCatalogEntry[];
  filteredCatalog: PresetCatalogEntry[];
  motionPreference: MotionPreference;
  onClose: () => void;
  onCollectionTagChange: (collectionTag: string | null) => void;
  onCompatibilityModeChange: (enabled: boolean) => void;
  onImport: (files: FileList | null) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  onPresetSelection: (presetId: string) => void;
  onQualityPresetChange: (presetId: string) => void;
  onRenderPreferenceChange: (update: Partial<RenderPreferences>) => void;
  onSearchQueryChange: (query: string) => void;
  onShowCurrentLink: () => void;
  onShufflePreset: () => void;
  onTabChange: (panel: PanelState) => void;
  onExportPreset: () => void;
  panel: PanelState;
  qualityPreset: QualityPreset;
  recentPresets: PresetCatalogEntry[];
  renderPreferences: RenderPreferences;
  routeState: SessionRouteState;
  searchQuery: string;
  starterPresets: StarterPreset[];
  stageAnchoredToolOpen: boolean;
}) {
  if (!panel) {
    return null;
  }

  const visibleTabs = stageAnchoredToolOpen
    ? TOOL_TABS
    : TOOL_TABS.filter((tool) => tool === 'browse' || tool === 'settings');

  return (
    <>
      {!stageAnchoredToolOpen ? (
        <button
          type="button"
          className="stims-shell__sheet-backdrop"
          aria-label="Close tools"
          onClick={onClose}
        />
      ) : null}
      <aside className="stims-shell__sheet" aria-label="Tools">
        <div className="stims-shell__sheet-header">
          <div className="stims-shell__sheet-heading">
            <h2>{getToolLabel(panel)}</h2>
            <p className="stims-shell__meta-copy">
              {getToolDescription(panel)}
            </p>
          </div>
          <button
            type="button"
            className="stims-shell__icon-button"
            onClick={onClose}
          >
            <UiIcon
              name="close"
              className="stims-shell__button-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__button-label">Close</span>
          </button>
        </div>

        <nav className="stims-shell__tool-tabs" aria-label="Tool sections">
          {visibleTabs.map((tool) => (
            <button
              key={tool}
              type="button"
              className="stims-shell__sheet-tab"
              data-active={String(panel === tool)}
              onClick={() => onTabChange(tool)}
            >
              {getToolLabel(tool)}
            </button>
          ))}
        </nav>

        <div className="stims-shell__sheet-body">
          {panel === 'browse' ? (
            <BrowseSheetPanel
              catalog={catalog}
              catalogError={catalogError}
              catalogReady={catalogReady}
              collectionTags={collectionTags}
              currentPresetId={currentPresetId}
              favoritePresets={favoritePresets}
              filteredCatalog={filteredCatalog}
              onCollectionTagChange={onCollectionTagChange}
              onPresetSelection={onPresetSelection}
              onSearchQueryChange={onSearchQueryChange}
              onShufflePreset={onShufflePreset}
              recentPresets={recentPresets}
              routeState={routeState}
              searchQuery={searchQuery}
              starterPresets={starterPresets}
            />
          ) : null}

          {panel === 'settings' ? (
            <SettingsSheetPanel
              motionPreference={motionPreference}
              onCompatibilityModeChange={onCompatibilityModeChange}
              onMotionPreferenceChange={onMotionPreferenceChange}
              onQualityPresetChange={onQualityPresetChange}
              onRenderPreferenceChange={onRenderPreferenceChange}
              qualityPreset={qualityPreset}
              renderPreferences={renderPreferences}
            />
          ) : null}

          {panel === 'editor' || panel === 'inspector' ? (
            <StageAnchoredToolCallout panel={panel} />
          ) : null}
        </div>

        <div className="stims-shell__sheet-footer">
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">
              Share or bring your own
            </p>
            <p className="stims-shell__meta-copy">
              Import and export stay here so the main experience can stay
              focused.
            </p>
          </div>
          <div className="stims-shell__session-actions">
            <button
              type="button"
              className="cta-button"
              onClick={onExportPreset}
            >
              Export preset
            </button>
            <label className="cta-button stims-shell__file-button">
              Import preset
              <input
                type="file"
                accept=".milk,.txt,text/plain"
                multiple
                onChange={(event) => onImport(event.target.files)}
              />
            </label>
            <button
              type="button"
              className="cta-button"
              onClick={onShowCurrentLink}
            >
              Copy link
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function WorkspaceToast({
  onDismiss,
  toast,
}: {
  onDismiss: () => void;
  toast: {
    message: string;
    tone: 'info' | 'warn' | 'error';
  } | null;
}) {
  if (!toast) {
    return null;
  }

  return (
    <output
      className="stims-shell__toast"
      data-tone={toast.tone}
      aria-live="polite"
    >
      <span>{toast.message}</span>
      <button
        type="button"
        className="stims-shell__toast-dismiss"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </output>
  );
}
