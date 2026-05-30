import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PRESET_PREVIEW_REQUEST_LIMIT } from '../milkdrop/preset-preview.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import {
  PresetShelfSection,
  SkeletonPresetCard,
} from './PresetShelfSection.tsx';
import { StimsControlDock } from './StimsControlDock.tsx';
import {
  StimsCornerBrand,
  StimsFrameChrome,
  StimsFrameHeader,
  StimsRailActions,
  StimsStageFrame,
} from './StimsStageFrame.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useUI, useWorkspace } from './workspace-context.tsx';
import { EditorPanel } from './EditorPanel.tsx';

import {
  buildAppliedFilterSummary,
  describePresetMood,
  formatPresetSupportNote,
  getFeaturedCollectionTags,
  getPresetCardSupportLabel,
  getQualityImpactSummary,
  getSettingsPresetOptions,
  getToolDescription,
  getToolLabel,
  prettifyCollectionTag,
  TOOL_TABS,
} from './workspace-helpers.ts';

export { PresetArtwork } from './PresetArtwork.tsx';
export {
  PresetShelfSection,
  SkeletonPresetCard,
} from './PresetShelfSection.tsx';
export { UiIcon } from './UiIcon.tsx';
export { WorkspaceToast } from './WorkspaceToast.tsx';

function describeQuickLook(preset: QualityPreset): string {
  return getQualityImpactSummary(preset).replace(/^What changes:\s*/u, '');
}

function AudioSourcePanel() {
  const { ui, engine } = useWorkspace();
  const engineReady = engine.engineReady;
  const onAudioStart = (source: 'demo' | 'microphone' | 'tab' | 'youtube') =>
    engine.handleAudioStart(source);
  const onLoadRecentYouTubeVideo = engine.loadRecentYouTubeVideo;
  const onLoadYouTube = () => engine.loadYouTubePreview();
  const onYoutubeUrlChange = ui.setYoutubeUrl;
  const onYoutubeUrlKeyDown = engine.handleYoutubeUrlKeyDown;
  const recentYouTubeVideos = ui.recentYouTubeVideos;
  const youtubeCanLoad = ui.youtubeCanLoad;
  const youtubeFeedback = ui.youtubeFeedback;
  const youtubeInputInvalid = ui.youtubeInputInvalid;
  const youtubeLoading = ui.youtubeLoading;
  const youtubePreviewRef = ui.youtubePreviewRef;
  const youtubeReady = ui.youtubeReady;
  const youtubeUrl = ui.youtubeUrl;

  return (
    <section
      className="stims-shell__source-panel"
      aria-labelledby="stims-source-heading"
    >
      <div className="stims-shell__source-heading">
        <h2 id="stims-source-heading" className="stims-shell__section-label">
          Use my music
        </h2>
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
          <span>Live mic input</span>
        </button>
        <button
          type="button"
          id="use-tab-audio"
          className="stims-shell__source-card"
          disabled={!engineReady}
          onClick={() => onAudioStart('tab')}
        >
          <strong>This tab</strong>
          <span>Audio from this browser tab</span>
        </button>
      </div>
      <div className="stims-shell__youtube">
        <label className="stims-shell__field-label" htmlFor="youtube-url">
          YouTube link
        </label>
        <div className="stims-shell__youtube-row">
          <input
            id="youtube-url"
            className="stims-shell__input"
            type="url"
            placeholder="https://youtube.com/watch?v=..."
            autoComplete="off"
            inputMode="url"
            spellCheck={false}
            aria-describedby="youtube-url-feedback"
            aria-invalid={youtubeInputInvalid}
            value={youtubeUrl}
            onChange={(event) => onYoutubeUrlChange(event.target.value)}
            onKeyDown={onYoutubeUrlKeyDown}
          />
          <button
            id="load-youtube"
            className="cta-button"
            type="button"
            disabled={!engineReady || !youtubeCanLoad}
            aria-disabled={!engineReady || !youtubeCanLoad}
            aria-busy={youtubeLoading}
            onClick={onLoadYouTube}
          >
            {youtubeLoading ? (
              <>
                <UiIcon name="spinner" className="stims-shell__button-icon" />
                Loading…
              </>
            ) : (
              'Load'
            )}
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
        <p
          id="youtube-url-feedback"
          className="stims-shell__youtube-feedback"
          data-state={
            youtubeInputInvalid ? 'invalid' : youtubeReady ? 'ready' : 'idle'
          }
          aria-live="polite"
          aria-atomic="true"
        >
          {youtubeFeedback}
        </p>
        {recentYouTubeVideos.length > 0 ? (
          <div className="stims-shell__youtube-recent">
            <p className="stims-shell__field-label">Recent videos</p>
            <div className="stims-shell__chip-list">
              {recentYouTubeVideos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  className="stims-shell__chip"
                  onClick={() => onLoadRecentYouTubeVideo(video.id)}
                >
                  <span className="stims-shell__chip-copy">
                    <strong>{video.title}</strong>
                    <span>{video.id}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div
          id="youtube-player-container"
          ref={youtubePreviewRef}
          className="stims-shell__youtube-preview"
          hidden
        >
          <div id="workspace-youtube-player"></div>
        </div>
      </div>
    </section>
  );
}

export function WorkspaceStagePanel({
  audioEnergy = 0,
  isFullscreen,
  launchPanel,
  liveMode,
  onToggleFullscreen,
  onToggleTheme,
  stageEyebrow,
  stageSummary,
  stageTitle,
}: {
  audioEnergy?: number;
  isFullscreen: boolean;
  launchPanel: ReactNode;
  liveMode: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  stageEyebrow: string;
  stageSummary: string;
  stageTitle: string;
}) {
  const { ui, engine } = useWorkspace();
  const backend = engine.engineSnapshot?.backend;
  const panel = ui.routeState.panel;
  const missingRequestedPreset = engine.missingRequestedPreset;
  const invalidExperienceSlug = ui.routeState.invalidExperienceSlug;
  const audioSource =
    engine.engineSnapshot?.audioSource ?? ui.routeState.audioSource;

  const engineRunning = engine.engineSnapshot?.runtimeReady ?? false;
  const audioActive = engine.engineSnapshot?.audioActive ?? false;
  const mutedVisualizer = engineRunning && !audioActive;
  const stageHint = engine.selectedPreset
    ? `${engine.selectedPreset.title}\u00A0\u00B7\u00A0${engine.selectedPreset.author || 'Unknown'}`
    : 'Ready for sound';

  return (
    <section
      className="stims-shell__workspace"
      data-mode={liveMode ? 'live' : 'home'}
      aria-label="Stims visualizer workspace"
    >
      <StimsStageFrame
        stageRef={ui.stageRef}
        liveMode={liveMode}
        hintText={stageHint}
        muted={mutedVisualizer}
      >
        <StimsFrameChrome>
          <StimsCornerBrand>
            <span className="stims-shell__logo">
              <a href="/">
                <span>Stims</span>
                <small>Sound into motion</small>
              </a>
            </span>
            {liveMode ? (
              <div className="stims-shell__corner-status">
                <span className="stims-shell__corner-pill">
                  {backend === 'webgpu' ? 'WebGPU' : 'WebGL'}
                  {audioEnergy > 0 ? (
                    <span
                      className="stims-shell__audio-meter"
                      style={
                        {
                          '--audio-energy': `${audioEnergy}`,
                        } as React.CSSProperties
                      }
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              </div>
            ) : null}
          </StimsCornerBrand>
          <StimsRailActions>
            {panel ? (
              <span className="stims-shell__corner-pill">
                {getToolLabel(panel)} open
              </span>
            ) : null}
            {liveMode && !missingRequestedPreset && !invalidExperienceSlug ? (
              <StimsControlDock
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onToggleTheme={onToggleTheme}
              />
            ) : null}
            <a
              className="stims-shell__corner-link"
              href="https://github.com/zz-plant/stims"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </StimsRailActions>
        </StimsFrameChrome>
        {liveMode ? (
          <StimsFrameHeader>
            <div className="stims-shell__stage-copy">
              <p className="stims-shell__eyebrow">{stageEyebrow}</p>
              <h2>{stageTitle}</h2>
              <p className="stims-shell__meta-copy stims-shell__stage-summary">
                {stageSummary}
              </p>
            </div>
            {audioSource === 'demo' ? (
              <div className="stims-shell__frame-sidecar">
                <button
                  type="button"
                  className="stims-shell__text-button stims-shell__audio-bridge-link"
                  onClick={ui.toggleExtendedSources}
                >
                  {ui.showExtendedSources
                    ? 'Hide sources'
                    : 'Switch to your music \u2192'}
                </button>
                {ui.showExtendedSources ? <AudioSourcePanel /> : null}
              </div>
            ) : null}
          </StimsFrameHeader>
        ) : null}
        {!liveMode ? (
          <div className="stims-shell__stage-hero">{launchPanel}</div>
        ) : null}
        {invalidExperienceSlug ? (
          <div className="active-toy-status is-error">
            <div className="active-toy-status__content">
              <h2>Link no longer works</h2>
              <p>
                This Stims link points to a view that is no longer available: "
                {invalidExperienceSlug}".
              </p>
            </div>
          </div>
        ) : null}
      </StimsStageFrame>
    </section>
  );
}

function BrowseSheetPanel({
  onCollectionTagChange,
  onImport,
}: {
  onCollectionTagChange: (collectionTag: string | null) => void;
  onImport: (files: FileList | null) => void;
}) {
  const { ui, engine } = useWorkspace();
  const catalog = engine.catalog;
  const catalogError = engine.catalogError;
  const catalogReady = engine.catalogReady;
  const collectionTags = engine.collectionTags;
  const currentPresetId = engine.engineSnapshot?.activePresetId ?? null;
  const favoritePresets = engine.favoritePresets;
  const filteredCatalog = engine.filteredCatalog;
  const presetPreviews = engine.presetPreviews;
  const recentPresets = engine.recentPresets;
  const routeState = ui.routeState;
  const searchQuery = ui.searchQuery;
  const starterPresets = engine.starterPresets;

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [communityPresets, setCommunityPresets] = useState<PresetCatalogEntry[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);

  useEffect(() => {
    if (routeState.collectionTag === 'collection:community') {
      setCommunityLoading(true);
      setCommunityError(null);
      fetch('/api/presets?sort=top&limit=20')
        .then((res) => res.json())
        .then((data) => {
          setCommunityPresets(data.presets || []);
          setCommunityLoading(false);
        })
        .catch((err: Error) => {
          setCommunityError(err.message);
          setCommunityLoading(false);
        });
    }
  }, [routeState.collectionTag]);

  const showStarterPresets =
    searchQuery.trim().length === 0 && routeState.collectionTag === null;
  const showActivitySections = showStarterPresets;
  const featuredCollectionTags = getFeaturedCollectionTags(collectionTags);
  const hiddenCollectionTags = collectionTags.filter(
    (tag) => !featuredCollectionTags.includes(tag),
  );
  const usingHiddenCollectionFilter =
    routeState.collectionTag !== null &&
    !featuredCollectionTags.includes(routeState.collectionTag);
  const visiblePreviewIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    const push = (items: Array<{ id: string }>) => {
      for (let i = 0; i < items.length; i++) {
        const id = items[i].id;
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    };
    if (starterPresets.length > 0) {
      const starters = starterPresets;
      for (let i = 0; i < starters.length; i++) {
        push([starters[i].preset]);
      }
    }
    push(recentPresets);
    push(favoritePresets);
    push(filteredCatalog);
    return ids.slice(0, PRESET_PREVIEW_REQUEST_LIMIT);
  }, [starterPresets, recentPresets, favoritePresets, filteredCatalog]);
  const previewCounts = useMemo(
    () =>
      visiblePreviewIds.reduce(
        (summary, presetId) => {
          const preview = presetPreviews[presetId];
          if (!preview || preview.status === 'queued') {
            summary.queued += 1;
            return summary;
          }

          summary[preview.status] += 1;
          return summary;
        },
        {
          queued: 0,
          capturing: 0,
          ready: 0,
          failed: 0,
        },
      ),
    [visiblePreviewIds, presetPreviews],
  );
  const previewSummary = useMemo(
    () =>
      [
        previewCounts.ready ? `${previewCounts.ready} ready` : '',
        previewCounts.capturing ? `${previewCounts.capturing} capturing` : '',
        previewCounts.queued ? `${previewCounts.queued} queued` : '',
        previewCounts.failed ? `${previewCounts.failed} failed` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    [previewCounts],
  );

  useEffect(() => {
    engine.requestPresetPreviews(visiblePreviewIds);
  }, [visiblePreviewIds, engine.requestPresetPreviews]);

  useEffect(() => {
    if (usingHiddenCollectionFilter) {
      setShowAdvancedFilters(true);
    }
  }, [usingHiddenCollectionFilter]);

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--browse">
      <section className="stims-shell__sheet-surface stims-shell__sheet-surface--sticky">
        <div className="stims-shell__browse-toolbar">
          <div className="stims-shell__browse-toolbar-copy">
            <strong>Select a preset and press play.</strong>
            <p className="stims-shell__meta-copy">
              Tap any card to play it. Previews update as they finish loading.
            </p>
          </div>
          <div className="stims-shell__browse-toolbar-actions">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={engine.handleShufflePreset}
              disabled={catalog.length === 0}
            >
              Shuffle
            </button>
            <details className="stims-shell__browse-toolbar-extras">
              <summary
                className="stims-shell__text-button"
                aria-label="More browse tools"
              >
                More
              </summary>
              <div className="stims-shell__browse-toolbar-extras-body">
                <p
                  className="stims-shell__meta-copy"
                  data-testid="browse-preview-summary"
                >
                  Previews: {previewSummary || 'waiting on captures'}
                </p>
                <button
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() =>
                    engine.refreshPresetPreviews(visiblePreviewIds)
                  }
                  disabled={visiblePreviewIds.length === 0}
                >
                  Refresh previews
                </button>
              </div>
            </details>
          </div>
        </div>

        <label className="stims-shell__field-label" htmlFor="preset-search">
          Search
        </label>
        <input
          id="preset-search"
          className="stims-shell__input"
          type="search"
          placeholder="Search by title, mood, creator, or collection"
          spellCheck={false}
          value={searchQuery}
          onChange={(event) => ui.setSearchQuery(event.target.value)}
        />

        <p
          className="stims-shell__active-filters"
          aria-live="polite"
          aria-atomic="true"
        >
          {buildAppliedFilterSummary({
            searchQuery,
            collectionTag: routeState.collectionTag,
          })}
        </p>

        <nav
          className="stims-shell__collections"
          aria-label="Popular collections"
        >
          <button
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(routeState.collectionTag === null)}
            onClick={() => onCollectionTagChange(null)}
          >
            All
          </button>
          {featuredCollectionTags.map((collectionTag) => (
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
          <button
            type="button"
            className="stims-shell__collection-pill"
            data-active={String(
              routeState.collectionTag === 'collection:community',
            )}
            onClick={() =>
              onCollectionTagChange(
                routeState.collectionTag === 'collection:community'
                  ? null
                  : 'collection:community',
              )
            }
          >
            Community
          </button>
        </nav>
        <div
          className="stims-shell__browse-toolbar-extras"
          data-open={String(showAdvancedFilters)}
        >
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={() => {
              setShowAdvancedFilters((current) => !current);
            }}
          >
            Advanced filters
          </button>
          {showAdvancedFilters && hiddenCollectionTags.length > 0 ? (
            <nav
              className="stims-shell__collections"
              aria-label="All collections"
            >
              {hiddenCollectionTags.map((collectionTag) => (
                <button
                  key={collectionTag}
                  type="button"
                  className="stims-shell__collection-pill"
                  data-active={String(
                    routeState.collectionTag === collectionTag,
                  )}
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
          ) : showAdvancedFilters ? (
            <p className="stims-shell__meta-copy">No additional filters.</p>
          ) : null}
        </div>
      </section>

      {showActivitySections ? (
        <PresetShelfSection
          entries={recentPresets.map((entry) => ({
            entry,
            label: 'Recent',
            summary: 'Open something you used earlier.',
          }))}
          summary="Recent picks help you resume without hunting."
          title="Recent"
          onSelect={engine.handlePresetSelection}
          presetPreviews={presetPreviews}
        />
      ) : null}

      {showActivitySections ? (
        <PresetShelfSection
          entries={favoritePresets.map((entry) => ({
            entry,
            label: 'Saved',
            summary: 'Saved for a quick return the next time you open Stims.',
          }))}
          summary="Saved picks stay visible even before anything is playing."
          title="Saved"
          onSelect={engine.handlePresetSelection}
          presetPreviews={presetPreviews}
        />
      ) : null}

      <section className="stims-shell__sheet-surface">
        {!catalogReady && !catalogError ? (
          <ul
            className="stims-shell__preset-list"
            style={{ opacity: 0.7 }}
            aria-busy={true}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have fixed order
              <li key={i}>
                <SkeletonPresetCard />
              </li>
            ))}
          </ul>
        ) : null}
        {catalogError ? (
          <p className="stims-shell__meta-copy">{catalogError}</p>
        ) : null}
        {routeState.collectionTag === 'collection:community' ? (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Community</p>
            {communityLoading ? (
              <p className="stims-shell__meta-copy">Loading community presets...</p>
            ) : communityError ? (
              <p className="stims-shell__meta-copy">{communityError}</p>
            ) : (
              <p className="stims-shell__meta-copy">
                {communityPresets.length} result
                {communityPresets.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        ) : (
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Everything</p>
            <p className="stims-shell__meta-copy">
              {filteredCatalog.length} result
              {filteredCatalog.length === 1 ? '' : 's'}
              ready to explore.
            </p>
          </div>
        )}
        <ul className="stims-shell__preset-list">
          {(routeState.collectionTag === 'collection:community'
            ? communityPresets
            : filteredCatalog
          ).map((entry) => {
            const supportLabel = getPresetCardSupportLabel(entry);

            return (
              <li key={entry.id}>
                <div className="stims-shell__preset-card-wrap">
                  <button
                    type="button"
                    className="stims-shell__preset-card"
                    data-active={String(entry.id === currentPresetId)}
                    onClick={() => engine.handlePresetSelection(entry.id)}
                  >
                    <PresetArtwork
                      entry={entry}
                      compact
                      preview={presetPreviews[entry.id] ?? null}
                    />
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
                  <button
                    type="button"
                    className="stims-shell__preset-fav"
                    aria-label={
                      entry.isFavorite ? 'Remove from saved' : 'Save preset'
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      void engine.toggleFavoritePreset(
                        entry.id,
                        !entry.isFavorite,
                      );
                    }}
                  >
                    <span
                      className="stims-shell__preset-fav-icon"
                      data-active={String(entry.isFavorite)}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="stims-shell__session-actions">
          <button
            type="button"
            className="cta-button"
            onClick={engine.exportPreset}
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
            onClick={() => void ui.handleShowCurrentLink()}
          >
            Copy link
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsSheetPanel({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
}) {
  const { ui, engine } = useWorkspace();
  const motionPreference = ui.motionPreference;
  const qualityPreset = ui.qualityPreset;
  const renderPreferences = ui.renderPreferences;
  const guidedPresets = getSettingsPresetOptions().slice(0, 3);

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--settings">
      <section className="stims-shell__sheet-surface">
        <p className="stims-shell__section-label">Renderer</p>
        <p className="stims-shell__meta-copy">
          {engine.engineSnapshot?.backend
            ? `Running on ${engine.engineSnapshot.backend === 'webgpu' ? 'WebGPU' : 'WebGL'}`
            : engine.engineReady
              ? 'Renderer ready'
              : 'Initializing renderer\u2026'}
          {engine.engineSnapshot?.backend === 'webgl'
            ? ' — WebGPU was unavailable or disabled.'
            : ''}
        </p>
      </section>

      <section className="stims-shell__sheet-surface">
        <p className="stims-shell__section-label">Quick looks</p>
        <ul className="stims-shell__preset-guides">
          {guidedPresets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="stims-shell__preset-guide"
                data-active={String(preset.id === qualityPreset.id)}
                onClick={() => engine.setQualityPreset(preset.id)}
              >
                <strong>{preset.label}</strong>
                <span className="stims-shell__meta-copy">
                  {describeQuickLook(preset)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <label className="stims-shell__field-label" htmlFor="quality-select">
          Or pick an exact render profile
        </label>
        <select
          id="quality-select"
          className="stims-shell__select"
          value={qualityPreset.id}
          onChange={(event) => engine.setQualityPreset(event.target.value)}
        >
          {getSettingsPresetOptions().map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="stims-shell__meta-copy">
          {qualityPreset.description ?? describeQuickLook(qualityPreset)}
        </p>
      </section>

      <details className="stims-shell__settings-advanced">
        <summary className="stims-shell__settings-summary">
          <span>Advanced controls</span>
          <span className="stims-shell__meta-copy">
            Open this only if you want manual controls
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
              <strong>Keep things steadier on tricky hardware</strong>
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
        </div>
      </details>
    </div>
  );
}

export function WorkspaceToolSheet({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  stageAnchoredToolOpen,
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  stageAnchoredToolOpen: boolean;
}) {
  const w = useUI();
  const panel = w.routeState.panel;
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        w.updatePanel(null);
        return;
      }

      if (event.key === 'Tab' && sheetRef.current) {
        const focusableElements = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    const sheetElement = sheetRef.current;
    sheetElement?.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );

    // Focus the most useful element for the active panel.
    // Defer by a frame to let the overlay mount its DOM first.
    requestAnimationFrame(() => {
      if (w.routeState.panel === 'browse') {
        const searchEl = document.querySelector<HTMLElement>(
          '.milkdrop-overlay__search',
        );
        (searchEl ?? sheetElement)?.focus();
      } else {
        sheetElement?.focus();
      }
    });

    return () => {
      sheetElement?.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
    };
  }, [w.routeState.panel, w.updatePanel]);

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
          data-panel={panel}
          aria-label="Close tools"
          onClick={() => w.updatePanel(null)}
        />
      ) : null}
      <aside
        ref={sheetRef}
        className="stims-shell__sheet"
        data-panel={panel}
        aria-label="Tools"
        tabIndex={-1}
      >
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
            onClick={() => w.updatePanel(null)}
          >
            <UiIcon
              name="close"
              className="stims-shell__button-icon stims-icon-slot stims-icon-slot--sm"
            />
            <span className="stims-shell__button-label">Close</span>
          </button>
        </div>

        {visibleTabs.length > 2 ? (
          <nav className="stims-shell__tool-tabs" aria-label="Tool sections">
            {visibleTabs.map((tool) => (
              <button
                key={tool}
                type="button"
                className="stims-shell__sheet-tab"
                data-active={String(panel === tool)}
                onClick={() => w.updatePanel(tool)}
              >
                {getToolLabel(tool)}
              </button>
            ))}
          </nav>
        ) : (
          <nav
            className="stims-shell__tool-jumplink"
            aria-label="Tool sections"
          >
            {visibleTabs
              .filter((tool) => tool !== panel)
              .map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className="stims-shell__text-button"
                  onClick={() => w.updatePanel(tool)}
                >
                  {panel === 'browse' && tool === 'settings'
                    ? 'Style \u2192'
                    : panel === 'settings' && tool === 'browse'
                      ? '\u2190 Browse presets'
                      : `Open ${getToolLabel(tool).toLowerCase()}`}
                </button>
              ))}
          </nav>
        )}

        <div className="stims-shell__sheet-body">
          {panel === 'editor' ? <EditorPanel /> : null}

          {panel === 'browse' ? (
            <BrowseSheetPanel
              onCollectionTagChange={(collectionTag) =>
                w.commitRoute({ ...w.routeState, collectionTag })
              }
              onImport={(files) => {
                void w.handleImport(files);
              }}
            />
          ) : null}

          {panel === 'settings' ? (
            <SettingsSheetPanel
              onCompatibilityModeChange={onCompatibilityModeChange}
              onMotionPreferenceChange={onMotionPreferenceChange}
            />
          ) : null}
        </div>
      </aside>
    </>
  );
}
