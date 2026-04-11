import type { RefObject } from 'react';
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
  formatPresetSupportLabel,
  getQualityImpactSummary,
  getSettingsPresetOptions,
  getToolDescription,
  getToolLabel,
  prettifyCollectionTag,
  type ReadinessItem,
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

export function WorkspaceLaunchPanel({
  engineReady,
  featuredPreset,
  hidden,
  launchEyebrow,
  launchSummary,
  launchTitle,
  onAudioStart,
  onLoadYouTube,
  onToggleExtendedSources,
  onYoutubeUrlChange,
  readinessAlerts,
  showExtendedSources,
  youtubePreviewRef,
  youtubeReady,
  youtubeUrl,
}: {
  engineReady: boolean;
  featuredPreset: PresetCatalogEntry | null;
  hidden: boolean;
  launchEyebrow: string;
  launchSummary: string;
  launchTitle: string;
  onAudioStart: (source: 'demo' | 'microphone' | 'tab' | 'youtube') => void;
  onLoadYouTube: () => void;
  onToggleExtendedSources: () => void;
  onYoutubeUrlChange: (value: string) => void;
  readinessAlerts: ReadinessItem[];
  showExtendedSources: boolean;
  youtubePreviewRef: RefObject<HTMLDivElement | null>;
  youtubeReady: boolean;
  youtubeUrl: string;
}) {
  return (
    <section
      className="stims-shell__launch"
      data-audio-controls
      hidden={hidden}
    >
      <div className="stims-shell__launch-header">
        <div className="stims-shell__launch-copy">
          <p className="stims-shell__eyebrow">{launchEyebrow}</p>
          <h1>{launchTitle}</h1>
          <p>{launchSummary}</p>
        </div>
        {featuredPreset ? (
          <aside className="stims-shell__launch-spotlight">
            <p className="stims-shell__section-label">Try first</p>
            <strong>{featuredPreset.title}</strong>
            <span className="stims-shell__meta-copy">
              {describePresetMood(featuredPreset)} ·{' '}
              {formatPresetSupportLabel(featuredPreset)}
            </span>
          </aside>
        ) : null}
      </div>

      <div className="stims-shell__launch-action-groups">
        <div className="stims-shell__launch-actions stims-shell__launch-actions--primary">
          <button
            id="use-demo-audio"
            data-demo-audio-btn="true"
            className="cta-button primary stims-shell__action-button"
            type="button"
            disabled={!engineReady}
            onClick={() => onAudioStart('demo')}
          >
            <span className="stims-shell__action-label">Start demo</span>
            <span className="stims-shell__action-hint">Fastest way in</span>
          </button>
          <button
            id="start-audio-btn"
            data-mic-audio-btn="true"
            className="cta-button stims-shell__action-button"
            type="button"
            disabled={!engineReady}
            onClick={() => onAudioStart('microphone')}
          >
            <span className="stims-shell__action-label">Use mic</span>
            <span className="stims-shell__action-hint">React to the room</span>
          </button>
        </div>
        <div className="stims-shell__launch-actions stims-shell__launch-actions--secondary">
          <p className="stims-shell__meta-copy">
            More ways to start when audio is already playing elsewhere.
          </p>
          <button
            id="use-tab-audio"
            className="cta-button stims-shell__action-button stims-shell__action-button--secondary"
            type="button"
            disabled={!engineReady}
            onClick={() => onAudioStart('tab')}
          >
            <span className="stims-shell__action-label">Capture tab</span>
            <span className="stims-shell__action-hint">
              Best for music or video
            </span>
          </button>
        </div>
      </div>

      {featuredPreset ? (
        <p className="stims-shell__launch-note">
          Recommended first run: start demo, then open Looks and try{' '}
          <strong>{featuredPreset.title}</strong>.
        </p>
      ) : null}

      <div className="stims-shell__launch-more">
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={onToggleExtendedSources}
        >
          {showExtendedSources ? 'Hide YouTube capture' : 'Add YouTube capture'}
        </button>

        {showExtendedSources ? (
          <div className="stims-shell__youtube">
            <label className="stims-shell__field-label" htmlFor="youtube-url">
              YouTube capture
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
                Capture YouTube
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
        ) : null}
      </div>

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
    </section>
  );
}

export function WorkspaceStagePanel({
  audioSource,
  backend,
  featuredPreset,
  invalidExperienceSlug,
  missingRequestedPreset,
  onBrowseRecovery,
  onFeaturedPresetSelection,
  stageEyebrow,
  stageRef,
  stageSummary,
  stageTitle,
}: {
  audioSource: 'demo' | 'microphone' | 'tab' | 'youtube' | null | undefined;
  backend: 'webgl' | 'webgpu' | null | undefined;
  featuredPreset: PresetCatalogEntry | null;
  invalidExperienceSlug: string | null;
  missingRequestedPreset: boolean;
  onBrowseRecovery: () => void;
  onFeaturedPresetSelection: () => void;
  stageEyebrow: string;
  stageRef: RefObject<HTMLDivElement | null>;
  stageSummary: string;
  stageTitle: string;
}) {
  return (
    <section className="stims-shell__workspace">
      <section className="stims-shell__stage-section">
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
                  ? 'Lighter mode'
                  : 'Starting up'}
            </span>
            <span className="stims-shell__meta-pill">
              {formatAudioSourceLabel(audioSource)}
            </span>
          </div>
        </div>

        <div className="stims-shell__stage-frame">
          <div ref={stageRef} className="stims-shell__stage-root" />
          {missingRequestedPreset ? (
            <div className="stims-shell__stage-recovery">
              <p className="stims-shell__eyebrow">Missing preset</p>
              <h3>Load a nearby favorite instead</h3>
              <p className="stims-shell__meta-copy">
                This link points to a preset that is not bundled here anymore.
                Recover with a featured look or jump into the full library.
              </p>
              <div className="stims-shell__session-actions">
                {featuredPreset ? (
                  <button
                    type="button"
                    className="cta-button primary"
                    onClick={onFeaturedPresetSelection}
                  >
                    Load featured look
                  </button>
                ) : null}
                <button
                  type="button"
                  className="cta-button"
                  onClick={onBrowseRecovery}
                >
                  Browse looks
                </button>
              </div>
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
  filteredCatalog,
  onCollectionTagChange,
  onPresetSelection,
  onSearchQueryChange,
  onShufflePreset,
  routeState,
  searchQuery,
}: {
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  currentPresetId: string | null;
  filteredCatalog: PresetCatalogEntry[];
  onCollectionTagChange: (collectionTag: string | null) => void;
  onPresetSelection: (presetId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onShufflePreset: () => void;
  routeState: SessionRouteState;
  searchQuery: string;
}) {
  return (
    <div className="stims-shell__sheet-panel">
      <div className="stims-shell__browse-toolbar">
        <p className="stims-shell__meta-copy">
          Search the full library or shuffle a surprise.
        </p>
        <button
          type="button"
          className="stims-shell__text-button"
          onClick={onShufflePreset}
          disabled={catalog.length === 0}
        >
          Shuffle a look
        </button>
      </div>

      <label className="stims-shell__field-label" htmlFor="preset-search">
        Search
      </label>
      <input
        id="preset-search"
        className="stims-shell__input"
        type="search"
        placeholder="Search vibe, title, author, or tag"
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

      {!catalogReady && !catalogError ? (
        <p className="stims-shell__meta-copy">Loading catalog…</p>
      ) : null}
      {catalogError ? (
        <p className="stims-shell__meta-copy">{catalogError}</p>
      ) : null}
      <ul className="stims-shell__preset-list">
        {filteredCatalog.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="stims-shell__preset-card"
              data-active={String(entry.id === currentPresetId)}
              onClick={() => onPresetSelection(entry.id)}
            >
              <span className="stims-shell__preset-title">{entry.title}</span>
              <span className="stims-shell__preset-vibe">
                {describePresetMood(entry)}
              </span>
              <span className="stims-shell__preset-meta">
                {entry.author || 'Unknown author'}
              </span>
              <span className="stims-shell__preset-tech">
                {formatPresetSupportLabel(entry)}
              </span>
            </button>
          </li>
        ))}
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
      <div className="stims-shell__settings-callout">
        <p className="stims-shell__eyebrow">Recommended</p>
        <strong>Stay on Balanced unless the picture feels rough.</strong>
        <p className="stims-shell__meta-copy">
          Safer graphics mode helps older devices. The sliders below are only
          for fine tuning when you need a softer or steadier picture.
        </p>
      </div>

      <p className="stims-shell__section-label">Quick tune</p>
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
        Picture style details
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
        {getQualityImpactSummary(qualityPreset)}
      </p>

      <label className="stims-shell__toggle">
        <input
          type="checkbox"
          checked={renderPreferences.compatibilityMode}
          onChange={(event) => onCompatibilityModeChange(event.target.checked)}
        />
        <span>Safer graphics mode</span>
      </label>

      <label className="stims-shell__toggle">
        <input
          type="checkbox"
          checked={motionPreference.enabled}
          onChange={(event) => onMotionPreferenceChange(event.target.checked)}
        />
        <span>Allow motion controls</span>
      </label>

      <p className="stims-shell__section-label">Advanced tuning</p>
      <p className="stims-shell__meta-copy">
        Use these only when you want a sharper image or need to calm the frame
        rate on a busy preset.
      </p>

      <label className="stims-shell__field-label" htmlFor="render-scale">
        Sharpness
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
        Current sharpness: {(renderPreferences.renderScale ?? 1).toFixed(2)}x
      </p>

      <label className="stims-shell__field-label" htmlFor="max-pixel-ratio">
        Detail limit
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
        Current limit: {(renderPreferences.maxPixelRatio ?? 1.5).toFixed(2)}x
      </p>
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
      <p className="stims-shell__eyebrow">Advanced tool</p>
      <h3>
        {panel === 'editor'
          ? 'Editor is open on the stage.'
          : 'Inspector is open on the stage.'}
      </h3>
      <p className="stims-shell__meta-copy">
        Keep the visualizer in view while the tool stays anchored to the canvas.
        Use the tabs above to jump back to Looks or Settings.
      </p>
    </div>
  );
}

export function WorkspaceToolSheet({
  catalog,
  catalogError,
  catalogReady,
  collectionTags,
  currentPresetId,
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
  renderPreferences,
  routeState,
  searchQuery,
  showAgentControls,
  stageAnchoredToolOpen,
}: {
  catalog: PresetCatalogEntry[];
  catalogError: string | null;
  catalogReady: boolean;
  collectionTags: string[];
  currentPresetId: string | null;
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
  renderPreferences: RenderPreferences;
  routeState: SessionRouteState;
  searchQuery: string;
  showAgentControls: boolean;
  stageAnchoredToolOpen: boolean;
}) {
  if (!panel) {
    return null;
  }

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
          {TOOL_TABS.map((tool) => (
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
              filteredCatalog={filteredCatalog}
              onCollectionTagChange={onCollectionTagChange}
              onPresetSelection={onPresetSelection}
              onSearchQueryChange={onSearchQueryChange}
              onShufflePreset={onShufflePreset}
              routeState={routeState}
              searchQuery={searchQuery}
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
            {showAgentControls ? (
              <button
                type="button"
                className="cta-button"
                onClick={onShowCurrentLink}
              >
                Show current link
              </button>
            ) : null}
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
