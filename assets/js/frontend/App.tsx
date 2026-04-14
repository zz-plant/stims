import { useEffect, useState } from 'react';
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
  const launchEyebrow =
    engineReady || routeState.invalidExperienceSlug
      ? 'Instant browser music visualizer'
      : 'Loading';
  const launchTitle =
    engineReady || routeState.invalidExperienceSlug
      ? 'Play reactive visuals in one click.'
      : 'Warming up visuals.';
  const launchSummary =
    engineReady || routeState.invalidExperienceSlug
      ? 'Start with demo audio now. Bring in your own room, mic, or tab audio only when you want the visuals to follow live sound.'
      : 'Getting the visual engine ready.';
  const stageEyebrow = loadingRequestedPreset
    ? 'Loading preset'
    : liveMode
      ? 'Now playing'
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
        ? 'Start with the recommended look or open the preset library.'
        : featuredPreset
          ? `${describePresetMood(featuredPreset)} · ${formatPresetSupportLabel(featuredPreset)}`
          : 'Press play with demo audio, or open the preset library first.';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = () => {
    const stageElement = stageRef.current?.parentElement;
    if (!stageElement) {
      return;
    }

    void (async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return;
        }

        await stageElement.requestFullscreen();
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
            Library
          </button>
          <button
            type="button"
            className="stims-shell__nav-pill"
            data-active={String(routeState.panel === 'settings')}
            onClick={() =>
              updatePanel(routeState.panel === 'settings' ? null : 'settings')
            }
          >
            Look
          </button>
        </nav>
        <div className="stims-shell__nav-utility">
          {selectedPreset ? (
            <span className="stims-shell__nav-status">
              {selectedPreset.title}
            </span>
          ) : null}
          <a
            className="stims-shell__nav-link"
            href="https://github.com/zz-plant/stims"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="stims-shell__content">
        <WorkspaceStagePanel
          audioSource={engineSnapshot?.audioSource}
          backend={engineSnapshot?.backend}
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
              starterPresets={starterPresets}
              youtubePreviewRef={youtubePreviewRef}
              youtubeReady={youtubeReady}
              youtubeUrl={youtubeUrl}
            />
          }
          liveMode={liveMode}
          missingRequestedPreset={missingRequestedPreset}
          onOpenBrowse={() => updatePanel('browse')}
          onOpenSettings={() => updatePanel('settings')}
          onShowCurrentLink={() => {
            void handleShowCurrentLink();
          }}
          onShufflePreset={handleShufflePreset}
          onToggleFullscreen={handleToggleFullscreen}
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
        favoritePresets={favoritePresets}
        recentPresets={recentPresets}
        starterPresets={starterPresets}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      <WorkspaceToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
