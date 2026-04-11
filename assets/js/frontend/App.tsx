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
    showToast,
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
    currentPreset,
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
    readinessAlerts,
    runtimeReady,
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
    showToast,
    startAudioSource,
    youtubePreviewRef,
  });

  const selectedPreset =
    catalog.find((entry) => entry.id === routeState.presetId) ??
    currentPreset ??
    null;
  const missingRequestedPreset = Boolean(
    routeState.presetId &&
      catalogReady &&
      !selectedPreset &&
      !routeState.invalidExperienceSlug &&
      pendingPresetIdRef.current !== routeState.presetId,
  );
  const loadingRequestedPreset = Boolean(
    routeState.presetId &&
      !selectedPreset &&
      !routeState.invalidExperienceSlug &&
      !missingRequestedPreset,
  );
  const stageAnchoredToolOpen =
    routeState.panel === 'editor' || routeState.panel === 'inspector';
  const launchEyebrow = missingRequestedPreset
    ? 'Recover your session'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Start here'
      : 'Getting things ready';
  const launchTitle = missingRequestedPreset
    ? 'That saved link needs a new look.'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Pick an audio path.'
      : 'Loading the visualizer.';
  const launchSummary = missingRequestedPreset
    ? 'This preset is no longer bundled. Start demo to recover quickly, or open Looks before you play.'
    : runtimeReady || routeState.invalidExperienceSlug
      ? 'Start demo fastest. Use mic for room-reactive visuals or capture tab audio when music is already playing.'
      : 'One moment while visuals warm up.';
  const stageEyebrow = missingRequestedPreset
    ? 'Link needs a rescue'
    : loadingRequestedPreset
      ? 'Loading requested look'
      : launchControlsHidden
        ? 'Now playing'
        : selectedPreset
          ? 'Selected look'
          : 'Start with a look';
  const stageTitle = missingRequestedPreset
    ? 'Requested look unavailable'
    : loadingRequestedPreset
      ? 'Loading your look'
      : (selectedPreset?.title ?? 'Pick a look');
  const stageSummary = missingRequestedPreset
    ? `"${routeState.presetId}" is not in this build. Load a featured look or open Looks to recover.`
    : loadingRequestedPreset
      ? `One moment while we load ${routeState.presetId}.`
      : selectedPreset
        ? `${selectedPreset.author || 'Unknown author'} · ${formatPresetSupportLabel(selectedPreset)}`
        : featuredPreset
          ? `Featured first pick: ${featuredPreset.title} · ${describePresetMood(featuredPreset)}. Open Looks or shuffle for another vibe.`
          : 'Open Looks to pick a preset without losing the stage.';

  return (
    <div className="stims-shell">
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
            Looks
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
          onAudioStart={(source) => {
            void handleAudioStart(source);
          }}
          onLoadYouTube={() => {
            void loadYouTubePreview();
          }}
          onToggleExtendedSources={toggleExtendedSources}
          onYoutubeUrlChange={setYoutubeUrl}
          readinessAlerts={readinessAlerts}
          showExtendedSources={showExtendedSources}
          youtubePreviewRef={youtubePreviewRef}
          youtubeReady={youtubeReady}
          youtubeUrl={youtubeUrl}
        />

        <WorkspaceStagePanel
          audioSource={engineSnapshot?.audioSource}
          backend={engineSnapshot?.backend}
          featuredPreset={featuredPreset}
          invalidExperienceSlug={routeState.invalidExperienceSlug}
          missingRequestedPreset={missingRequestedPreset}
          onBrowseRecovery={handleBrowseRecovery}
          onFeaturedPresetSelection={handleFeaturedPresetSelection}
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
        onShowCurrentLink={handleShowCurrentLink}
        onShufflePreset={handleShufflePreset}
        onTabChange={updatePanel}
        panel={routeState.panel}
        qualityPreset={qualityPreset}
        renderPreferences={renderPreferences}
        routeState={routeState}
        searchQuery={searchQuery}
        showAgentControls={routeState.agentMode}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
