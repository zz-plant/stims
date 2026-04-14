import { useEffect, useState } from 'react';
import '../../css/app-shell.css';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  setCompatibilityMode,
  setRenderPreferences,
} from '../core/state/render-preference-store.ts';
import {
  getFullscreenElement,
  subscribeToFullscreenChange,
  toggleElementFullscreen,
} from './fullscreen.ts';
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { commitRoute, routeState, setRouteState } = useWorkspaceRouteState();
  const {
    activityCatalog,
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
    favoritePresets,
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
    recentPresets,
    readinessAlerts,
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
    activityCatalog,
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
  const liveMode = launchControlsHidden;
  const currentAudioSource =
    engineSnapshot?.audioSource ?? routeState.audioSource;
  const launchEyebrow =
    engineReady || routeState.invalidExperienceSlug
      ? 'MilkDrop-inspired visualizer'
      : 'Loading';
  const launchTitle =
    engineReady || routeState.invalidExperienceSlug
      ? 'Start music-reactive visuals in seconds.'
      : 'Loading the visualizer.';
  const launchSummary =
    engineReady || routeState.invalidExperienceSlug
      ? 'Start with demo audio now, then switch to your own music whenever you want the visuals to follow live sound.'
      : 'Getting everything ready.';
  const stageEyebrow = loadingRequestedPreset
    ? 'Loading preset'
    : liveMode
      ? currentAudioSource === 'demo'
        ? 'Demo is playing'
        : 'Now playing'
      : 'Ready when you are';
  const stageTitle = loadingRequestedPreset
    ? 'Loading preset'
    : selectedPreset
      ? selectedPreset.title
      : missingRequestedPreset
        ? 'Choose a new look'
        : (featuredPreset?.title ?? 'Featured visual');
  const stageSummary = loadingRequestedPreset
    ? `Loading ${routeState.presetId}.`
    : selectedPreset
      ? `${selectedPreset.author || 'Unknown author'} · ${formatPresetSupportLabel(selectedPreset)}`
      : missingRequestedPreset
        ? 'Start with the featured look or open the preset library.'
        : featuredPreset
          ? `${describePresetMood(featuredPreset)} · ${formatPresetSupportLabel(featuredPreset)}`
          : 'Press play with demo audio, or open the preset library first.';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    };

    handleFullscreenChange();
    return subscribeToFullscreenChange(handleFullscreenChange, document);
  }, []);

  const handleToggleFullscreen = () => {
    const stageElement = stageRef.current?.parentElement;
    if (!stageElement) {
      return;
    }

    void (async () => {
      try {
        const toggled = await toggleElementFullscreen(stageElement, document);
        if (!toggled) {
          setStatusMessage('Full screen is unavailable in this browser.');
        }
      } catch (_error) {
        setStatusMessage('Full screen is unavailable in this browser.');
      }
    })();
  };

  return (
    <div
      className="stims-shell"
      data-has-toast={toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
    >
      <WorkspaceStagePanel
        audioSource={currentAudioSource}
        backend={engineSnapshot?.backend}
        engineReady={engineReady}
        invalidExperienceSlug={routeState.invalidExperienceSlug}
        isFullscreen={isFullscreen}
        launchPanel={
          <WorkspaceLaunchPanel
            embedded
            engineReady={engineReady}
            favoritePresets={favoritePresets}
            featuredPreset={featuredPreset}
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
            onPresetSelection={handlePresetSelection}
            onToggleExtendedSources={toggleExtendedSources}
            onYoutubeUrlChange={setYoutubeUrl}
            readinessAlerts={readinessAlerts}
            requestedPresetId={routeState.presetId}
            recentPresets={recentPresets}
            showExtendedSources={showExtendedSources}
            youtubePreviewRef={youtubePreviewRef}
            youtubeReady={youtubeReady}
            youtubeUrl={youtubeUrl}
          />
        }
        liveMode={liveMode}
        missingRequestedPreset={missingRequestedPreset}
        onAudioStart={(source) => {
          void handleAudioStart(source);
        }}
        onLoadYouTube={() => {
          void loadYouTubePreview();
        }}
        onOpenBrowse={() =>
          updatePanel(routeState.panel === 'browse' ? null : 'browse')
        }
        onOpenSettings={() =>
          updatePanel(routeState.panel === 'settings' ? null : 'settings')
        }
        onShowCurrentLink={() => {
          void handleShowCurrentLink();
        }}
        onShufflePreset={handleShufflePreset}
        onToggleExtendedSources={toggleExtendedSources}
        onToggleFullscreen={handleToggleFullscreen}
        onYoutubeUrlChange={setYoutubeUrl}
        panel={routeState.panel}
        stageEyebrow={stageEyebrow}
        stageRef={stageRef}
        stageSummary={stageSummary}
        stageTitle={stageTitle}
        showExtendedSources={showExtendedSources}
        youtubePreviewRef={youtubePreviewRef}
        youtubeReady={youtubeReady}
        youtubeUrl={youtubeUrl}
      />

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
        favoritePresets={favoritePresets}
        recentPresets={recentPresets}
        starterPresets={starterPresets}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
