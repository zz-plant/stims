import type { ErrorInfo, ReactNode } from 'react';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import '../../css/app-shell.css';

class StimsErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Stims crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          className="stims-shell"
          id="stims-main"
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100vh',
            background: '#0a0f19',
            color: '#e9fbff',
            fontFamily: 'system-ui,sans-serif',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ opacity: 0.6, fontSize: '0.9rem', margin: 0 }}>
              Reload the page to try again.
            </p>
            <div style={{ marginTop: '24px' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Reload page
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch {}
                  try {
                    window.localStorage.setItem(
                      'stims:compatibility-mode',
                      'true',
                    );
                  } catch {}
                  window.location.reload();
                }}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Try WebGL mode
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    const keys: string[] = [];
                    for (let i = 0; i < window.localStorage.length; i++) {
                      const key = window.localStorage.key(i);
                      if (key?.startsWith('stims:')) {
                        keys.push(key);
                      }
                    }
                    keys.forEach((key) => window.localStorage.removeItem(key));
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch {}
                  window.location.href = '/';
                }}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Reset settings
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import { setMotionPreference } from '../core/motion-preferences.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  applyTheme,
  getActiveThemePreference,
  setThemePreference,
} from '../core/theme-preferences.ts';
import {
  getFullscreenElement,
  subscribeToFullscreenChange,
  toggleElementFullscreen,
} from './fullscreen.ts';
import { describePresetMood } from './workspace-helpers.ts';
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

function StimsWorkspaceAppInner() {
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
    handleYoutubeUrlKeyDown,
    importPresetFiles,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    motionPreference,
    pendingPresetIdRef,
    presetPreviews,
    qualityPreset,
    refreshPresetPreviews,
    readinessItems,
    recentYouTubeVideos,
    renderPreferences,
    requestPresetPreviews,
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
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
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
    handleAudioStop,
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
  const audioEnergy = engineSnapshot?.audioEnergy ?? 0;
  const currentAudioSource =
    engineSnapshot?.audioSource ?? routeState.audioSource;
  const quietAtRef = useRef<number | null>(null);
  const quietDemoSuggestedRef = useRef(false);

  const handleToggleFullscreen = useCallback(() => {
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
  }, [stageRef, setStatusMessage]);

  useEffect(() => {
    if (
      !liveMode ||
      !engineSnapshot?.audioActive ||
      currentAudioSource === 'demo'
    ) {
      quietAtRef.current = null;
      quietDemoSuggestedRef.current = false;
      return;
    }

    if (audioEnergy < 0.04) {
      if (quietAtRef.current === null) {
        quietAtRef.current = performance.now();
      } else if (
        performance.now() - quietAtRef.current >= 3000 &&
        !quietDemoSuggestedRef.current
      ) {
        quietDemoSuggestedRef.current = true;
        setStatusMessage(
          'Not hearing much? Switch to demo audio for guaranteed motion.',
        );
      }
    } else {
      quietAtRef.current = null;
      quietDemoSuggestedRef.current = false;
    }
  }, [
    audioEnergy,
    currentAudioSource,
    engineSnapshot?.audioActive,
    liveMode,
    setStatusMessage,
  ]);
  const launchEyebrow =
    engineReady || routeState.invalidExperienceSlug
      ? 'MilkDrop in the browser'
      : 'Loading';
  const launchTitle =
    engineReady || routeState.invalidExperienceSlug
      ? 'Start music-reactive color and motion in seconds.'
      : 'Loading the visualizer.';
  const launchSummary =
    engineReady || routeState.invalidExperienceSlug
      ? 'Start with demo audio now, then switch to your own music whenever you want the motion to track live sound.'
      : 'Getting everything ready.';
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
        ? 'Choose something new'
        : (featuredPreset?.title ?? 'Featured pick');
  const stageSummary = loadingRequestedPreset
    ? `Loading ${routeState.presetId}.`
    : selectedPreset
      ? selectedPreset.author || 'Unknown author'
      : missingRequestedPreset
        ? 'Start with the featured pick or open the full list.'
        : featuredPreset
          ? describePresetMood(featuredPreset)
          : 'Press play with demo audio, or open the full list first.';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    };

    handleFullscreenChange();
    return subscribeToFullscreenChange(handleFullscreenChange, document);
  }, []);

  useEffect(() => {
    let title = 'Stims';
    if (loadingRequestedPreset) {
      title = `Loading… · ${title}`;
    } else if (selectedPreset) {
      title = `${selectedPreset.title} · ${title}`;
    } else if (routeState.panel) {
      const panelLabel =
        routeState.panel === 'browse'
          ? 'Browse'
          : routeState.panel === 'settings'
            ? 'Settings'
            : routeState.panel === 'editor'
              ? 'Editor'
              : 'Inspector';
      title = `${panelLabel} · ${title}`;
    } else if (liveMode) {
      title = `Now Playing · ${title}`;
    } else if (!engineReady) {
      title = `Loading… · ${title}`;
    }
    document.title = title;
  }, [
    loadingRequestedPreset,
    selectedPreset,
    routeState.panel,
    liveMode,
    engineReady,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === ' ' && liveMode && engineReady) {
        event.preventDefault();
        handleAudioStart('demo');
      } else if (key === 'f') {
        event.preventDefault();
        handleToggleFullscreen();
      } else if (key === 'b') {
        event.preventDefault();
        updatePanel(routeState.panel === 'browse' ? null : 'browse');
      } else if (key === 's') {
        event.preventDefault();
        updatePanel(routeState.panel === 'settings' ? null : 'settings');
      } else if (key === 'e') {
        event.preventDefault();
        updatePanel(routeState.panel === 'editor' ? null : 'editor');
      } else if (key === 'i') {
        event.preventDefault();
        updatePanel(routeState.panel === 'inspector' ? null : 'inspector');
      }
    };

    document.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );
    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
    };
  }, [
    liveMode,
    engineReady,
    routeState.panel,
    updatePanel,
    handleAudioStart,
    handleToggleFullscreen,
  ]);

  useEffect(() => {
    const preference = getActiveThemePreference();
    applyTheme(preference.theme);
  }, []);

  useEffect(() => {
    const el = document.getElementById('stims-loading');
    if (el) el.hidden = true;
  }, []);

  const handleToggleTheme = () => {
    const current = getActiveThemePreference();
    const next = current.theme === 'dark' ? 'light' : 'dark';
    setThemePreference({ theme: next });
    applyTheme(next);
  };

  return (
    <div
      className="stims-shell"
      id="stims-main"
      data-has-toast={toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
    >
      <a href="#stims-main" className="skip-link">
        Skip to main content
      </a>
      <WorkspaceStagePanel
        audioEnergy={audioEnergy}
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
            onPresetSelection={handlePresetSelection}
            presetPreviews={presetPreviews}
            readinessAlerts={readinessAlerts}
            requestedPresetId={routeState.presetId}
            recentPresets={recentPresets}
          />
        }
        liveMode={liveMode}
        missingRequestedPreset={missingRequestedPreset}
        onAudioStart={(source) => {
          void handleAudioStart(source);
        }}
        onAudioStop={() => {
          handleAudioStop();
        }}
        onLoadYouTube={() => {
          void loadYouTubePreview();
        }}
        onLoadRecentYouTubeVideo={loadRecentYouTubeVideo}
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
        onYoutubeUrlKeyDown={handleYoutubeUrlKeyDown}
        panel={routeState.panel}
        stageEyebrow={stageEyebrow}
        stageRef={stageRef}
        stageSummary={stageSummary}
        stageTitle={stageTitle}
        showExtendedSources={showExtendedSources}
        recentYouTubeVideos={recentYouTubeVideos}
        youtubeCanLoad={youtubeCanLoad}
        youtubeFeedback={youtubeFeedback}
        youtubeInputInvalid={youtubeInputInvalid}
        youtubeLoading={youtubeLoading}
        youtubePreviewRef={youtubePreviewRef}
        youtubeReady={youtubeReady}
        youtubeUrl={youtubeUrl}
        onToggleTheme={handleToggleTheme}
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
        onRefreshPresetPreviews={(presetIds) => {
          void refreshPresetPreviews(presetIds);
        }}
        onQualityPresetChange={setQualityPreset}
        onSearchQueryChange={setSearchQuery}
        onShowCurrentLink={() => {
          void handleShowCurrentLink();
        }}
        onShufflePreset={handleShufflePreset}
        onTabChange={updatePanel}
        panel={routeState.panel}
        presetPreviews={presetPreviews}
        qualityPreset={qualityPreset}
        renderPreferences={renderPreferences}
        onVisiblePresetIdsChange={(presetIds) => {
          void requestPresetPreviews(presetIds);
        }}
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

export function StimsWorkspaceApp() {
  return (
    <StimsErrorBoundary>
      <StimsWorkspaceAppInner />
    </StimsErrorBoundary>
  );
}
