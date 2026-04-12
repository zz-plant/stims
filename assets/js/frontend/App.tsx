import '../../css/app-shell.css';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  setCompatibilityMode,
  setRenderPreferences,
} from '../core/state/render-preference-store.ts';
import {
  describePresetMood,
  formatPresetSupportLabel,
} from './workspace-helpers.ts';
import {
  useWorkspaceRouteState,
  useWorkspaceSessionState,
} from './workspace-hooks.ts';
import { useWorkspaceShellOrchestration } from './workspace-shell-hooks.ts';
import {
  WorkspaceLaunchPanel,
  WorkspaceStagePanel,
  WorkspaceToast,
  WorkspaceToolSheet,
} from './workspace-ui.tsx';

export function StimsWorkspaceApp() {
  const { commitRoute, routeState, setRouteState } = useWorkspaceRouteState();
  const {
    deferredSearch,
    dismissToast,
    engineSnapshot,
    exportPreset,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    importPresetFiles,
    loadYouTubePreview,
    motionPreference,
    pendingPresetIdRef,
    qualityPreset,
    readinessItems,
    renderPreferences,
    searchQuery,
    setQualityPreset,
    setSearchQuery,
    setStatusMessage,
    setYoutubeUrl,
    showExtendedSources,
    stageRef,
    startAudioSource,
    toast,
    toggleExtendedSources,
    youtubePreviewRef,
    youtubeReady,
    youtubeUrl,
  } = useWorkspaceSessionState({
    routeState,
    setRouteState,
  });
  const {
    catalog,
    catalogError,
    catalogReady,
    collectionTags,
    engineReady,
    featuredPreset,
    filteredCatalog,
    handleAudioStart,
    handleBrowseRecovery,
    handleFeaturedPresetSelection,
    handleImport,
    handlePresetSelection,
    handleShowCurrentLink,
    handleShufflePreset,
    launchControlsHidden,
    loadingRequestedPreset,
    missingRequestedPreset,
    readinessAlerts,
    runtimeReady,
    selectedPreset,
    starterPresets,
    updatePanel,
  } = useWorkspaceShellOrchestration({
    commitRoute,
    deferredSearch,
    engineSnapshot,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    importPresetFiles,
    pendingPresetIdRef,
    readinessItems,
    routeState,
    setStatusMessage,
    startAudioSource,
    youtubePreviewRef,
  });

  const stageAnchoredToolOpen =
    routeState.panel === 'editor' || routeState.panel === 'inspector';
  const launchEyebrow =
    runtimeReady || routeState.invalidExperienceSlug ? 'Start' : 'Loading';
  const launchTitle =
    runtimeReady || routeState.invalidExperienceSlug
      ? 'Choose audio.'
      : 'Warming up visuals.';
  const launchSummary =
    runtimeReady || routeState.invalidExperienceSlug
      ? 'Start demo, use the mic, or capture a tab.'
      : 'Just a moment.';
  const stageEyebrow = loadingRequestedPreset
    ? 'Loading preset'
    : launchControlsHidden
      ? 'Now playing'
      : selectedPreset
        ? 'Preset'
        : 'Choose a preset';
  const stageTitle = loadingRequestedPreset
    ? 'Loading preset'
    : selectedPreset
      ? selectedPreset.title
      : missingRequestedPreset
        ? 'Pick a preset'
        : 'Pick a preset';
  const stageSummary = loadingRequestedPreset
    ? `Loading ${routeState.presetId}.`
    : selectedPreset
      ? `${selectedPreset.author || 'Unknown author'} · ${formatPresetSupportLabel(selectedPreset)}`
      : missingRequestedPreset
        ? 'Start with the featured pick or open Presets.'
        : featuredPreset
          ? `Try ${featuredPreset.title} · ${describePresetMood(featuredPreset)}.`
          : 'Open Presets or shuffle.';

  return (
    <div className="stims-shell" data-has-toast={toast ? 'true' : undefined}>
      <header className="top-nav stims-shell__nav">
        <div className="stims-shell__brand">
          <a href="/" className="stims-shell__logo">
            <span>Stims</span>
            <small>Audio-reactive visuals</small>
          </a>
        </div>
        <nav className="stims-shell__nav-actions" aria-label="Main">
          <button
            type="button"
            className="stims-shell__nav-pill"
            data-active={String(routeState.panel === 'browse')}
            onClick={() =>
              updatePanel(routeState.panel === 'browse' ? null : 'browse')
            }
          >
            Presets
          </button>
          <button
            type="button"
            className="stims-shell__nav-pill"
            data-active={String(routeState.panel === 'settings')}
            onClick={() =>
              updatePanel(routeState.panel === 'settings' ? null : 'settings')
            }
          >
            Settings
          </button>
          <a
            className="stims-shell__nav-link"
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="stims-shell__content">
        <WorkspaceLaunchPanel
          engineReady={engineReady}
          featuredPreset={featuredPreset}
          hidden={launchControlsHidden}
          launchEyebrow={launchEyebrow}
          launchSummary={launchSummary}
          launchTitle={launchTitle}
          missingRequestedPreset={missingRequestedPreset}
          onAudioStart={(source) => {
            void handleAudioStart(source);
          }}
          onBrowseRecovery={handleBrowseRecovery}
          onFeaturedPresetSelection={handleFeaturedPresetSelection}
          onLoadYouTube={() => {
            void loadYouTubePreview();
          }}
          onToggleExtendedSources={toggleExtendedSources}
          onYoutubeUrlChange={setYoutubeUrl}
          readinessAlerts={readinessAlerts}
          requestedPresetId={routeState.presetId}
          showExtendedSources={showExtendedSources}
          youtubePreviewRef={youtubePreviewRef}
          youtubeReady={youtubeReady}
          youtubeUrl={youtubeUrl}
        />

        <WorkspaceStagePanel
          audioSource={engineSnapshot?.audioSource}
          backend={engineSnapshot?.backend}
          invalidExperienceSlug={routeState.invalidExperienceSlug}
          missingRequestedPreset={missingRequestedPreset}
          onOpenBrowse={() => updatePanel('browse')}
          onOpenSettings={() => updatePanel('settings')}
          onShowCurrentLink={() => {
            void handleShowCurrentLink();
          }}
          onShufflePreset={handleShufflePreset}
          stageEyebrow={stageEyebrow}
          stageRef={stageRef}
          stageSummary={stageSummary}
          stageTitle={stageTitle}
        />
      </main>

      <WorkspaceToolSheet
        catalog={catalog}
        catalogError={catalogError}
        catalogReady={catalogReady}
        collectionTags={collectionTags}
        currentPresetId={engineSnapshot?.activePresetId ?? null}
        filteredCatalog={filteredCatalog}
        motionPreference={motionPreference}
        onClose={() => updatePanel(null)}
        onCollectionTagChange={(collectionTag) =>
          commitRoute({ ...routeState, collectionTag })
        }
        onCompatibilityModeChange={setCompatibilityMode}
        onExportPreset={exportPreset}
        onImport={(files) => {
          void handleImport(files);
        }}
        onMotionPreferenceChange={(enabled) => setMotionPreference({ enabled })}
        onPresetSelection={handlePresetSelection}
        onQualityPresetChange={setQualityPreset}
        onRenderPreferenceChange={setRenderPreferences}
        onSearchQueryChange={setSearchQuery}
        onShowCurrentLink={() => {
          void handleShowCurrentLink();
        }}
        onShufflePreset={handleShufflePreset}
        onTabChange={updatePanel}
        panel={routeState.panel}
        qualityPreset={qualityPreset}
        renderPreferences={renderPreferences}
        routeState={routeState}
        searchQuery={searchQuery}
        starterPresets={starterPresets}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
