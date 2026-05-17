import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { QualityPreset } from '../core/settings-panel.ts';
import {
  type MilkdropPresetRenderPreview,
  PRESET_PREVIEW_REQUEST_LIMIT,
} from '../milkdrop/preset-preview.ts';
import { getIconNodes, type UiIconName } from '../ui/icon-library.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { StimsControlDock } from './StimsControlDock.tsx';
import {
  StimsCornerBrand,
  StimsFrameChrome,
  StimsFrameHeader,
  StimsRailActions,
  StimsStageFrame,
} from './StimsStageFrame.tsx';
import { useWorkspace } from './workspace-context.tsx';
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
  type ReadinessItem,
  TOOL_TABS,
} from './workspace-helpers.ts';

function describeQuickLook(preset: QualityPreset): string {
  return getQualityImpactSummary(preset).replace(/^What changes:\s*/u, '');
}

type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

export function UiIcon({
  name,
  className,
}: {
  name: UiIconName;
  className: string;
}) {
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

function getPresetArtworkTone(entry: PresetCatalogEntry): PresetArtworkTone {
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

export function PresetArtwork({
  entry,
  compact = false,
  preview = null,
}: {
  entry: PresetCatalogEntry;
  compact?: boolean;
  preview?: MilkdropPresetRenderPreview | null;
}) {
  const mood = describePresetMood(entry);

  return (
    <div
      className="stims-shell__preset-art"
      data-tone={getPresetArtworkTone(entry)}
      data-compact={String(compact)}
      data-preview-status={preview?.status ?? 'queued'}
      aria-hidden="true"
    >
      {preview?.imageUrl ? (
        <img
          className="stims-shell__preset-preview-image"
          src={preview.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : null}
      <span className="stims-shell__preset-art-grid" />
      <span className="stims-shell__preset-art-orbit" />
      <span className="stims-shell__preset-art-core" />
      <span className="stims-shell__preset-art-caption">{mood}</span>
      <span className="stims-shell__preset-art-status">
        {preview?.status === 'ready'
          ? preview.actualBackend === 'webgpu'
            ? 'WebGPU preview'
            : preview.actualBackend === 'webgl'
              ? 'WebGL preview'
              : 'Runtime preview'
          : preview?.status === 'capturing'
            ? 'Capturing'
            : preview?.status === 'failed'
              ? 'Preview failed'
              : 'Preview queued'}
      </span>
    </div>
  );
}

function SkeletonPresetCard() {
  return (
    <div className="stims-shell__starter-card stims-shell__skeleton--card stims-shell__skeleton">
      <div
        className="stims-shell__preset-art stims-shell__skeleton"
        style={{ minHeight: 164 }}
      />
      <span
        className="stims-shell__starter-label stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-sm"
        style={{ height: 14, width: '40%' }}
      />
      <strong
        className="stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-md"
        style={{ height: 18 }}
      />
      <span
        className="stims-shell__meta-copy stims-shell__skeleton stims-shell__skeleton--text stims-shell__skeleton--text-sm"
        style={{ height: 14, width: '70%' }}
      />
    </div>
  );
}

export function PresetShelfSection({
  entries,
  summary,
  title,
  onSelect,
  presetPreviews,
}: {
  entries: Array<{
    entry: PresetCatalogEntry;
    label: string;
    summary: string;
  }>;
  summary: string;
  title: string;
  onSelect: (presetId: string) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
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
            <PresetArtwork
              entry={entry}
              preview={presetPreviews[entry.id] ?? null}
            />
            <span className="stims-shell__starter-label">{label}</span>
            <strong>{entry.title}</strong>
            <span className="stims-shell__meta-copy">{cardSummary}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AudioSourcePanel() {
  const w = useWorkspace();
  const engineReady = w.engineReady;
  const onAudioStart = (source: 'demo' | 'microphone' | 'tab' | 'youtube') =>
    w.handleAudioStart(source);
  const onLoadRecentYouTubeVideo = w.loadRecentYouTubeVideo;
  const onLoadYouTube = () => w.loadYouTubePreview();
  const onYoutubeUrlChange = w.setYoutubeUrl;
  const onYoutubeUrlKeyDown = w.handleYoutubeUrlKeyDown;
  const recentYouTubeVideos = w.recentYouTubeVideos;
  const youtubeCanLoad = w.youtubeCanLoad;
  const youtubeFeedback = w.youtubeFeedback;
  const youtubeInputInvalid = w.youtubeInputInvalid;
  const youtubeLoading = w.youtubeLoading;
  const youtubePreviewRef = w.youtubePreviewRef;
  const youtubeReady = w.youtubeReady;
  const youtubeUrl = w.youtubeUrl;

  return (
    <div className="stims-shell__source-panel">
      <div className="stims-shell__source-heading">
        <p className="stims-shell__section-label">Use my music</p>
        <p className="stims-shell__meta-copy">
          Pick a live source only when you want the motion to follow your own
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
            autoComplete="off"
            inputMode="url"
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
    </div>
  );
}

export const STIMS_FIRST_VISIT_KEY = 'stims:visited_before';

function useFirstVisitDismissed() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [true, () => {}] as const;
  }
  const stored = localStorage.getItem(STIMS_FIRST_VISIT_KEY);
  const dismissed = stored === 'true';
  const dismiss = () => {
    localStorage.setItem(STIMS_FIRST_VISIT_KEY, 'true');
  };
  return [dismissed, dismiss] as const;
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
  onPresetSelection,
  presetPreviews,
  readinessAlerts,
  recentPresets,
  requestedPresetId,
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
  onPresetSelection: (presetId: string) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  recentPresets: PresetCatalogEntry[];
  readinessAlerts: ReadinessItem[];
  requestedPresetId: string | null;
}) {
  const rootClassName = embedded
    ? 'stims-shell__launch-panel'
    : 'stims-shell__launch';
  const [firstVisitDismissed, dismissFirstVisit] = useFirstVisitDismissed();
  const jumpBackInEntries = [
    ...favoritePresets.map((entry) => ({
      entry,
      label: 'Saved pick',
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
        label: 'Recent',
        summary: 'Something you opened recently and can jump back into.',
      })),
  ].slice(0, 3);

  return (
    <div className={rootClassName} data-audio-controls>
      <div className="stims-shell__launch-hero">
        <div className="stims-shell__launch-header">
          <div className="stims-shell__launch-copy">
            <p className="stims-shell__eyebrow">{launchEyebrow}</p>
            <h1>{launchTitle}</h1>
            <p className="stims-shell__launch-summary">{launchSummary}</p>
          </div>
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

      {!firstVisitDismissed ? (
        <section className="stims-shell__confidence-note">
          <strong>Browser-native MilkDrop visualizer</strong>
          <span>
            Runs authentic .milk presets via WebGPU or WebGL. Press play with
            demo audio, then switch to your own music.
          </span>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={dismissFirstVisit}
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

      <PresetShelfSection
        entries={jumpBackInEntries}
        summary="Saved picks and recent stops stay close so you can start faster next time."
        title="Jump back in"
        onSelect={onPresetSelection}
        presetPreviews={presetPreviews}
      />
    </div>
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
  const w = useWorkspace();
  const backend = w.engineSnapshot?.backend;
  const panel = w.routeState.panel;
  const missingRequestedPreset = w.missingRequestedPreset;
  const invalidExperienceSlug = w.routeState.invalidExperienceSlug;
  const audioSource = w.engineSnapshot?.audioSource ?? w.routeState.audioSource;

  return (
    <section
      className="stims-shell__workspace"
      data-mode={liveMode ? 'live' : 'home'}
    >
      <StimsStageFrame stageRef={w.stageRef} liveMode={liveMode}>
        <StimsFrameChrome>
          <StimsCornerBrand>
            <h1 className="stims-shell__logo">
              <a href="/">
                <span>Stims</span>
                <small>Sound into motion</small>
              </a>
            </h1>
            {liveMode ? (
              <div className="stims-shell__corner-status">
                <span
                  className="stims-shell__corner-pill"
                  title="Visualizer is running with live audio"
                >
                  Live session
                </span>
                <span className="stims-shell__corner-pill">
                  {backend === 'webgpu'
                    ? 'WebGPU active'
                    : backend === 'webgl'
                      ? 'WebGL active'
                      : 'Renderer loading'}
                </span>
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
              </div>
            ) : null}
          </StimsCornerBrand>
          <StimsRailActions>
            {panel ? (
              <span className="stims-shell__corner-pill">
                {getToolLabel(panel)} open
              </span>
            ) : null}
            {!missingRequestedPreset && !invalidExperienceSlug ? (
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
                  onClick={w.toggleExtendedSources}
                >
                  {w.showExtendedSources
                    ? 'Hide sources'
                    : 'Switch to your music \u2192'}
                </button>
                {w.showExtendedSources ? <AudioSourcePanel /> : null}
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
  const w = useWorkspace();
  const catalog = w.catalog;
  const catalogError = w.catalogError;
  const catalogReady = w.catalogReady;
  const collectionTags = w.collectionTags;
  const currentPresetId = w.engineSnapshot?.activePresetId ?? null;
  const favoritePresets = w.favoritePresets;
  const filteredCatalog = w.filteredCatalog;
  const presetPreviews = w.presetPreviews;
  const recentPresets = w.recentPresets;
  const routeState = w.routeState;
  const searchQuery = w.searchQuery;
  const starterPresets = w.starterPresets;

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
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
  const previewTargetIds = [
    ...starterPresets.map((starter) => starter.preset.id),
    ...recentPresets.map((entry) => entry.id),
    ...favoritePresets.map((entry) => entry.id),
    ...filteredCatalog.map((entry) => entry.id),
  ].filter((presetId, index, ids) => ids.indexOf(presetId) === index);
  const visiblePreviewIds = previewTargetIds.slice(
    0,
    PRESET_PREVIEW_REQUEST_LIMIT,
  );
  const previewCounts = visiblePreviewIds.reduce(
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
  );
  const previewSummary = [
    previewCounts.ready ? `${previewCounts.ready} ready` : '',
    previewCounts.capturing ? `${previewCounts.capturing} capturing` : '',
    previewCounts.queued ? `${previewCounts.queued} queued` : '',
    previewCounts.failed ? `${previewCounts.failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    w.requestPresetPreviews(visiblePreviewIds);
  }, [visiblePreviewIds, w.requestPresetPreviews]);

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
            <strong>Pick something and press play.</strong>
            <p className="stims-shell__meta-copy">
              Tap any card to play it. Previews update as they finish loading.
            </p>
          </div>
          <div className="stims-shell__browse-toolbar-actions">
            <button
              type="button"
              className="stims-shell__text-button"
              onClick={w.handleShufflePreset}
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
                  onClick={() => w.refreshPresetPreviews(visiblePreviewIds)}
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
          value={searchQuery}
          onChange={(event) => w.setSearchQuery(event.target.value)}
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

      {showStarterPresets && starterPresets.length > 0 ? (
        <section className="stims-shell__starter-section">
          <div className="stims-shell__section-heading">
            <p className="stims-shell__section-label">Start here</p>
            <p className="stims-shell__meta-copy">
              Four easy ways to get started.
            </p>
          </div>
          <div className="stims-shell__starter-grid">
            {starterPresets.map((starter) => (
              <button
                key={starter.key}
                type="button"
                className="stims-shell__starter-card"
                onClick={() => w.handlePresetSelection(starter.preset.id)}
              >
                <PresetArtwork
                  entry={starter.preset}
                  preview={presetPreviews[starter.preset.id] ?? null}
                />
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
            summary: 'Open something you used earlier.',
          }))}
          summary="Recent picks help you resume without hunting."
          title="Recent"
          onSelect={w.handlePresetSelection}
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
          onSelect={w.handlePresetSelection}
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
        <div className="stims-shell__section-heading">
          <p className="stims-shell__section-label">Everything</p>
          <p className="stims-shell__meta-copy">
            {filteredCatalog.length} result
            {filteredCatalog.length === 1 ? '' : 's'}
            ready to explore.
          </p>
        </div>
        <ul className="stims-shell__preset-list">
          {filteredCatalog.map((entry) => {
            const supportLabel = getPresetCardSupportLabel(entry);

            return (
              <li key={entry.id}>
                <div className="stims-shell__preset-card-wrap">
                  <button
                    type="button"
                    className="stims-shell__preset-card"
                    data-active={String(entry.id === currentPresetId)}
                    onClick={() => w.handlePresetSelection(entry.id)}
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
                      void w.toggleFavoritePreset(entry.id, !entry.isFavorite);
                    }}
                  >
                    {entry.isFavorite ? '\u2665' : '\u2661'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="stims-shell__session-actions">
          <button type="button" className="cta-button" onClick={w.exportPreset}>
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
            onClick={() => void w.handleShowCurrentLink()}
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
  const w = useWorkspace();
  const motionPreference = w.motionPreference;
  const qualityPreset = w.qualityPreset;
  const renderPreferences = w.renderPreferences;
  const guidedPresets = getSettingsPresetOptions().slice(0, 3);

  return (
    <div className="stims-shell__sheet-panel stims-shell__sheet-panel--settings">
      <section className="stims-shell__sheet-surface">
        <p className="stims-shell__section-label">Quick looks</p>
        <ul className="stims-shell__preset-guides">
          {guidedPresets.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="stims-shell__preset-guide"
                data-active={String(preset.id === qualityPreset.id)}
                onClick={() => w.setQualityPreset(preset.id)}
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
          onChange={(event) => w.setQualityPreset(event.target.value)}
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
  const w = useWorkspace();
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
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
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
