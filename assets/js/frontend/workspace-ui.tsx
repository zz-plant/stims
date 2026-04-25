import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { useEffect } from 'react';
import type { MotionPreference } from '../core/motion-preferences.ts';
import type { QualityPreset } from '../core/settings-panel.ts';
import type { RenderPreferences } from '../core/state/render-preference-store.ts';
import {
  type MilkdropPresetRenderPreview,
  PRESET_PREVIEW_REQUEST_LIMIT,
} from '../milkdrop/preset-preview.ts';
import { getIconNodes, type UiIconName } from '../ui/icon-library.ts';
import type {
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import {
  describePresetMood,
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

function PresetArtwork({
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

function PresetShelfSection({
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

function AudioSourcePanel({
  engineReady,
  onAudioStart,
  onLoadRecentYouTubeVideo,
  onLoadYouTube,
  onYoutubeUrlChange,
  onYoutubeUrlKeyDown,
  recentYouTubeVideos,
  youtubeCanLoad,
  youtubeFeedback,
  youtubeInputInvalid,
  youtubeLoading,
  youtubePreviewRef,
  youtubeReady,
  youtubeUrl,
}: {
  engineReady: boolean;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onLoadRecentYouTubeVideo: (videoId: string) => void;
  onLoadYouTube: () => void;
  onYoutubeUrlChange: (value: string) => void;
  onYoutubeUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  recentYouTubeVideos: Array<{ id: string; title: string }>;
  youtubeCanLoad: boolean;
  youtubeFeedback: string;
  youtubeInputInvalid: boolean;
  youtubeLoading: boolean;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;
}) {
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
            {youtubeLoading ? 'Loading…' : 'Load'}
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
  onLoadRecentYouTubeVideo,
  onLoadYouTube,
  onPresetSelection,
  onToggleExtendedSources,
  onYoutubeUrlChange,
  onYoutubeUrlKeyDown,
  presetPreviews,
  recentYouTubeVideos,
  recentPresets,
  readinessAlerts,
  requestedPresetId,
  showExtendedSources,
  youtubeCanLoad,
  youtubeFeedback,
  youtubeInputInvalid,
  youtubeLoading,
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
  onLoadRecentYouTubeVideo: (videoId: string) => void;
  onLoadYouTube: () => void;
  onPresetSelection: (presetId: string) => void;
  onToggleExtendedSources: () => void;
  onYoutubeUrlChange: (value: string) => void;
  onYoutubeUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  recentYouTubeVideos: Array<{ id: string; title: string }>;
  recentPresets: PresetCatalogEntry[];
  readinessAlerts: ReadinessItem[];
  requestedPresetId: string | null;
  showExtendedSources: boolean;
  youtubeCanLoad: boolean;
  youtubeFeedback: string;
  youtubeInputInvalid: boolean;
  youtubeLoading: boolean;
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
          <div className="stims-shell__launch-footnote">
            <span>Start with demo audio first.</span>
            <span>Bring in your own sound only when you want it.</span>
          </div>

          <div className="stims-shell__launch-more">
            {showExtendedSources ? (
              <AudioSourcePanel
                engineReady={engineReady}
                onAudioStart={onAudioStart}
                onLoadRecentYouTubeVideo={onLoadRecentYouTubeVideo}
                onLoadYouTube={onLoadYouTube}
                onYoutubeUrlChange={onYoutubeUrlChange}
                onYoutubeUrlKeyDown={onYoutubeUrlKeyDown}
                recentYouTubeVideos={recentYouTubeVideos}
                youtubeCanLoad={youtubeCanLoad}
                youtubeFeedback={youtubeFeedback}
                youtubeInputInvalid={youtubeInputInvalid}
                youtubeLoading={youtubeLoading}
                youtubePreviewRef={youtubePreviewRef}
                youtubeReady={youtubeReady}
                youtubeUrl={youtubeUrl}
              />
            ) : null}
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
  audioSource,
  backend,
  engineReady,
  invalidExperienceSlug,
  isFullscreen,
  launchPanel,
  liveMode,
  missingRequestedPreset,
  onAudioStart,
  onLoadRecentYouTubeVideo,
  onLoadYouTube,
  onOpenBrowse,
  onOpenSettings,
  onShowCurrentLink,
  onShufflePreset,
  onToggleExtendedSources,
  onToggleFullscreen,
  onYoutubeUrlChange,
  onYoutubeUrlKeyDown,
  panel,
  recentYouTubeVideos,
  stageEyebrow,
  stageRef,
  stageSummary,
  stageTitle,
  showExtendedSources,
  youtubeCanLoad,
  youtubeFeedback,
  youtubeInputInvalid,
  youtubeLoading,
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
  onLoadRecentYouTubeVideo: (videoId: string) => void;
  onLoadYouTube: () => void;
  onOpenBrowse: () => void;
  onOpenSettings: () => void;
  onShowCurrentLink: () => void;
  onShufflePreset: () => void;
  onToggleExtendedSources: () => void;
  onToggleFullscreen: () => void;
  onYoutubeUrlChange: (value: string) => void;
  onYoutubeUrlKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  panel: PanelState;
  recentYouTubeVideos: Array<{ id: string; title: string }>;
  stageEyebrow: string;
  stageRef: RefObject<HTMLDivElement | null>;
  stageSummary: string;
  stageTitle: string;
  showExtendedSources: boolean;
  youtubeCanLoad: boolean;
  youtubeFeedback: string;
  youtubeInputInvalid: boolean;
  youtubeLoading: boolean;
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
        <div
          className="stims-shell__stage-frame"
          data-mode={liveMode ? 'live' : 'home'}
        >
          <div className="stims-shell__stage-ambient" aria-hidden="true">
            <span className="stims-shell__stage-ambient-grid" />
            <span className="stims-shell__stage-ambient-beam" />
            <span className="stims-shell__stage-ambient-beam stims-shell__stage-ambient-beam--secondary" />
            <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--ember" />
            <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--sky" />
            <span className="stims-shell__stage-ambient-orb stims-shell__stage-ambient-orb--mint" />
            <span className="stims-shell__stage-ambient-ring" />
          </div>
          <div ref={stageRef} className="stims-shell__stage-root" />
          <div className="stims-shell__frame-chrome">
            <div className="stims-shell__corner-brand">
              <a href="/" className="stims-shell__logo">
                <span>Stims</span>
                <small>Sound into motion</small>
              </a>
              {liveMode ? (
                <div className="stims-shell__corner-status">
                  <span className="stims-shell__corner-pill">Live session</span>
                  <span className="stims-shell__corner-pill">
                    {backend === 'webgpu'
                      ? 'WebGPU active'
                      : backend === 'webgl'
                        ? 'WebGL active'
                        : 'Renderer loading'}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="stims-shell__rail-actions">
              {panel ? (
                <span className="stims-shell__corner-pill">
                  {getToolLabel(panel)} open
                </span>
              ) : null}
              {!missingRequestedPreset && !invalidExperienceSlug ? (
                <div
                  className="stims-shell__stage-dock"
                  role="toolbar"
                  aria-label={liveMode ? 'Live controls' : 'Launch controls'}
                >
                  <button
                    type="button"
                    className="stims-shell__stage-tool"
                    data-active={String(panel === 'browse')}
                    aria-label="Open browse panel"
                    title="Open browse panel"
                    onClick={onOpenBrowse}
                  >
                    <UiIcon
                      name="sparkles"
                      className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                    />
                    <span className="stims-shell__stage-tool-label">
                      Browse
                    </span>
                  </button>
                  <button
                    type="button"
                    className="stims-shell__stage-tool"
                    data-active={String(panel === 'settings')}
                    aria-label="Open look settings"
                    title="Open look settings"
                    onClick={onOpenSettings}
                  >
                    <UiIcon
                      name="sliders"
                      className="stims-shell__stage-tool-icon stims-icon-slot stims-icon-slot--sm"
                    />
                    <span className="stims-shell__stage-tool-label">Style</span>
                  </button>
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
                  <button
                    type="button"
                    className="stims-shell__stage-tool"
                    aria-label={
                      isFullscreen ? 'Exit full screen' : 'Enter full screen'
                    }
                    title={
                      isFullscreen ? 'Exit full screen' : 'Enter full screen'
                    }
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
              <a
                className="stims-shell__corner-link"
                href="https://github.com/zz-plant/stims"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>
          {liveMode ? (
            <div className="stims-shell__frame-header">
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
                    onClick={onToggleExtendedSources}
                  >
                    {showExtendedSources
                      ? 'Hide sources'
                      : 'Switch to your music →'}
                  </button>
                  {showExtendedSources ? (
                    <AudioSourcePanel
                      engineReady={engineReady}
                      onAudioStart={onAudioStart}
                      onLoadRecentYouTubeVideo={onLoadRecentYouTubeVideo}
                      onLoadYouTube={onLoadYouTube}
                      onYoutubeUrlChange={onYoutubeUrlChange}
                      onYoutubeUrlKeyDown={onYoutubeUrlKeyDown}
                      recentYouTubeVideos={recentYouTubeVideos}
                      youtubeCanLoad={youtubeCanLoad}
                      youtubeFeedback={youtubeFeedback}
                      youtubeInputInvalid={youtubeInputInvalid}
                      youtubeLoading={youtubeLoading}
                      youtubePreviewRef={youtubePreviewRef}
                      youtubeReady={youtubeReady}
                      youtubeUrl={youtubeUrl}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!liveMode ? (
            <div className="stims-shell__stage-hero">{launchPanel}</div>
          ) : null}
          {invalidExperienceSlug ? (
            <div className="active-toy-status is-error">
              <div className="active-toy-status__content">
                <h2>Link no longer works</h2>
                <p>
                  This Stims link points to a view that is no longer available:
                  "{invalidExperienceSlug}".
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
  onRefreshPresetPreviews,
  onSearchQueryChange,
  onShufflePreset,
  onVisiblePresetIdsChange,
  presetPreviews,
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
  onRefreshPresetPreviews: (presetIds: string[]) => void;
  onSearchQueryChange: (query: string) => void;
  onShufflePreset: () => void;
  onVisiblePresetIdsChange: (presetIds: string[]) => void;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
  recentPresets: PresetCatalogEntry[];
  routeState: SessionRouteState;
  searchQuery: string;
  starterPresets: StarterPreset[];
}) {
  const showStarterPresets =
    searchQuery.trim().length === 0 && routeState.collectionTag === null;
  const showActivitySections = showStarterPresets;
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
    onVisiblePresetIdsChange(visiblePreviewIds);
  }, [onVisiblePresetIdsChange, visiblePreviewIds]);

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
              onClick={onShufflePreset}
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
                  onClick={() => onRefreshPresetPreviews(visiblePreviewIds)}
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
                onClick={() => onPresetSelection(starter.preset.id)}
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
          onSelect={onPresetSelection}
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
          onSelect={onPresetSelection}
          presetPreviews={presetPreviews}
        />
      ) : null}

      <section className="stims-shell__sheet-surface">
        {!catalogReady && !catalogError ? (
          <p className="stims-shell__meta-copy">Loading the list…</p>
        ) : null}
        {catalogError ? (
          <p className="stims-shell__meta-copy">{catalogError}</p>
        ) : null}
        <div className="stims-shell__section-heading">
          <p className="stims-shell__section-label">Everything</p>
          <p className="stims-shell__meta-copy">
            {filteredCatalog.length} result
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
              </li>
            );
          })}
        </ul>
      </section>
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
                onClick={() => onQualityPresetChange(preset.id)}
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
          onChange={(event) => onQualityPresetChange(event.target.value)}
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
          ? 'The editor opens on the stage.'
          : 'The inspector opens on the stage.'}
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
  onRefreshPresetPreviews,
  onRenderPreferenceChange,
  onSearchQueryChange,
  onShowCurrentLink,
  onShufflePreset,
  onTabChange,
  onVisiblePresetIdsChange,
  onExportPreset,
  panel,
  presetPreviews,
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
  onRefreshPresetPreviews: (presetIds: string[]) => void;
  onRenderPreferenceChange: (update: Partial<RenderPreferences>) => void;
  onSearchQueryChange: (query: string) => void;
  onShowCurrentLink: () => void;
  onShufflePreset: () => void;
  onTabChange: (panel: PanelState) => void;
  onVisiblePresetIdsChange: (presetIds: string[]) => void;
  onExportPreset: () => void;
  panel: PanelState;
  presetPreviews: Record<string, MilkdropPresetRenderPreview>;
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
      <aside
        className="stims-shell__sheet"
        data-panel={panel}
        aria-label="Tools"
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
            onClick={onClose}
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
                onClick={() => onTabChange(tool)}
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
                  onClick={() => onTabChange(tool)}
                >
                  {panel === 'browse' && tool === 'settings'
                    ? 'Open settings →'
                    : panel === 'settings' && tool === 'browse'
                      ? '← Browse presets'
                      : `Open ${getToolLabel(tool).toLowerCase()}`}
                </button>
              ))}
          </nav>
        )}

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
              onRefreshPresetPreviews={onRefreshPresetPreviews}
              onSearchQueryChange={onSearchQueryChange}
              onShufflePreset={onShufflePreset}
              onVisiblePresetIdsChange={onVisiblePresetIdsChange}
              presetPreviews={presetPreviews}
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

        <details className="stims-shell__sheet-footer">
          <summary className="stims-shell__sheet-footer-summary">
            <span className="stims-shell__section-label">
              Share, save, or import
            </span>
            <span className="stims-shell__meta-copy">
              Copy a link, export what is playing, or bring in one of your own.
            </span>
          </summary>
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
        </details>
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
