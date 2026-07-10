import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import '../../css/shell-loader.css';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { useTemporalMemory } from '../core/services/temporal-memory.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  applyTheme,
  getActiveThemePreference,
  setThemePreference,
} from '../core/theme-preferences.ts';
import { AudioMatchToast } from './AudioMatchToast.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { ContextualHelp, useHelpHints } from './ContextualHelp.tsx';
import { StimsErrorBoundary } from './ErrorBoundary.tsx';
import { useAudioEnergy } from './hooks/useAudioEnergy';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useStageGesture } from './hooks/useStageGesture';
import { reportLoadStatus } from './load-status.ts';
import { MobileControlBar } from './MobileControlBar.tsx';
import { NewHomePage } from './NewHomePage.tsx';
import { RendererFallbackBadge } from './RendererFallbackBadge.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { connectWakeLock } from './wake-lock.ts';
import {
  useEngineSnapshot,
  useWorkspace,
  WorkspaceProvider,
} from './workspace-context.tsx';
import {
  describePresetMood,
  getToolDescription,
  getToolLabel,
  TOOL_TABS,
} from './workspace-helpers.ts';
import {
  BROWSE_PANEL_FOCUS_SELECTOR,
  WorkspaceStagePanel,
} from './workspace-ui.tsx';

const BrowseSheetPanel = lazy(() =>
  import('./BrowseSheetPanel.tsx').then((m) => ({
    default: m.BrowseSheetPanel,
  })),
);
const EditorPanel = lazy(() =>
  import('./EditorPanel.tsx').then((m) => ({ default: m.EditorPanel })),
);
const SettingsSheetPanel = lazy(() =>
  import('./SettingsSheetPanel.tsx').then((m) => ({
    default: m.SettingsSheetPanel,
  })),
);

function StimsWorkspaceAppShell() {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const isWideEnough = useMediaQuery('(min-width: 1024px)');
  const temporalMemory = useTemporalMemory();

  const audioEnergy = useAudioEnergy();
  const { isFullscreen, handleToggleFullscreen } = useFullscreen(
    ui.stageRef,
    ui.setStatusMessage,
  );

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [audioMatch, setAudioMatch] = useState<{
    presetId: string;
    name: string;
    score: number;
  } | null>(null);
  const [thumbMode, setThumbMode] = useState(() => {
    try {
      return localStorage.getItem('stims:mobile-thumb-mode') === 'true';
    } catch {
      return false;
    }
  });
  const [partyRemoteMode, setPartyRemoteMode] = useState(() => {
    try {
      return localStorage.getItem('stims:mobile-party-remote') === 'true';
    } catch {
      return false;
    }
  });
  const [hapticsEnabled, setHapticsEnabled] = useState(() => {
    try {
      return localStorage.getItem('stims:mobile-haptics') !== 'false';
    } catch {
      return true;
    }
  });
  const [offline, setOffline] = useState(() =>
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showRotateHint, setShowRotateHint] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<
    Array<{ presetId: string; title: string; at: number }>
  >([]);

  const liveMode = engine.audioActive;
  const currentAudioSource =
    engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  const quietAtRef = useRef<number | null>(null);
  const quietDemoSuggestedRef = useRef(false);
  const autoPlayedRef = useRef(false);
  // ShortcutsDialog owns the `e.key === 'Tab'` focus trap and initial
  // `focusable[0]?.focus()` call while this shell controls when it opens.
  const shortcutsRef = useRef<HTMLDivElement | null>(null);

  const { visibleHint, showHint, dismissHint } = useHelpHints();

  useDocumentTitle({
    loadingPreset: engine.loadingRequestedPreset,
    selectedPresetTitle: engine.selectedPreset?.title ?? null,
    panel: ui.routeState.panel,
    liveMode,
    engineReady: engine.engineReady,
  });

  useKeyboardShortcuts({
    liveMode,
    engineReady: engine.engineReady,
    panel: ui.routeState.panel,
    filteredCatalog: engine.filteredCatalog,
    updatePanel: ui.updatePanel,
    handlePresetSelection: engine.handlePresetSelection,
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
    handleAudioStart: engine.handleAudioStart,
    handleAudioStop: engine.handleAudioStop,
    handleToggleFullscreen,
    setShowShortcuts,
  });

  useStageGesture({
    enabled: liveMode,
    stageRef: ui.stageRef,
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
    openBrowse: () => ui.updatePanel('browse'),
    closePanel: () => ui.updatePanel(null),
    toggleFavoritePreset: () => {
      const activePresetId = engineSnapshot?.activePresetId;
      const activePreset = activePresetId
        ? engine.catalog.find((preset) => preset.id === activePresetId)
        : null;
      if (!activePresetId) {
        ui.setStatusMessage('Load a preset before saving it.');
        return;
      }
      void engine.toggleFavoritePreset(
        activePresetId,
        !activePreset?.isFavorite,
      );
      ui.setStatusMessage(
        activePreset?.isFavorite
          ? 'Removed from saved presets.'
          : 'Saved preset.',
      );
    },
    setStatusMessage: ui.setStatusMessage,
    hapticsEnabled,
  });

  useEffect(() => {
    if (
      !ui.routeState.agentMode &&
      !ui.routeState.previewMode &&
      engine.engineReady &&
      engine.catalogReady &&
      engine.featuredPreset &&
      !liveMode &&
      !autoPlayedRef.current
    ) {
      autoPlayedRef.current = true;
      const presetId = engine.featuredPreset.id;
      const request = () => void engine.handlePlayPreset(presetId);
      const handle =
        typeof requestIdleCallback === 'function'
          ? requestIdleCallback(request, { timeout: 2500 })
          : setTimeout(request, 1500);
      return () => {
        if (
          typeof cancelIdleCallback === 'function' &&
          typeof handle === 'number'
        ) {
          cancelIdleCallback(handle);
        } else {
          clearTimeout(handle);
        }
      };
    }
  }, [
    engine.engineReady,
    engine.catalogReady,
    engine.featuredPreset,
    engine.handlePlayPreset,
    liveMode,
    ui.routeState.agentMode,
    ui.routeState.previewMode,
  ]);

  useEffect(() => {
    if (ui.toast && visibleHint) {
      dismissHint();
    }
  }, [ui.toast, visibleHint, dismissHint]);

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
        ui.setStatusMessage(
          'Not seeing much movement? Try demo audio for a stronger signal.',
        );
      }
    } else {
      quietAtRef.current = null;
      quietDemoSuggestedRef.current = false;
    }
  }, [
    audioEnergy,
    currentAudioSource,
    liveMode,
    engineSnapshot?.audioActive,
    ui.setStatusMessage,
  ]);

  useEffect(() => {
    const syncOnlineState = () => setOffline(!navigator.onLine);
    window.addEventListener('online', syncOnlineState);
    window.addEventListener('offline', syncOnlineState);
    return () => {
      window.removeEventListener('online', syncOnlineState);
      window.removeEventListener('offline', syncOnlineState);
    };
  }, []);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    return () =>
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(
      '(orientation: portrait) and (pointer: coarse) and (max-width: 767px)',
    );
    const update = () => {
      if (!liveMode || !media.matches) {
        setShowRotateHint(false);
        return;
      }
      try {
        if (localStorage.getItem('stims:rotate-hint-dismissed') === 'true') {
          setShowRotateHint(false);
          return;
        }
      } catch {}
      setShowRotateHint(true);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [liveMode]);

  const updateThumbMode = useCallback((enabled: boolean) => {
    setThumbMode(enabled);
    try {
      localStorage.setItem('stims:mobile-thumb-mode', String(enabled));
    } catch {}
  }, []);

  const updatePartyRemoteMode = useCallback((enabled: boolean) => {
    setPartyRemoteMode(enabled);
    try {
      localStorage.setItem('stims:mobile-party-remote', String(enabled));
    } catch {}
  }, []);

  const updateHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsEnabled(enabled);
    try {
      localStorage.setItem('stims:mobile-haptics', String(enabled));
    } catch {}
  }, []);

  const handleInstallApp = useCallback(() => {
    const prompt = installPrompt as
      | (Event & { prompt?: () => Promise<void> })
      | null;
    if (!prompt?.prompt) return;
    void prompt.prompt();
    setInstallPrompt(null);
  }, [installPrompt]);

  const stageEyebrow = engine.loadingRequestedPreset
    ? 'Loading preset'
    : liveMode
      ? 'Now playing'
      : 'Ready to play';
  const stageTitle = engine.loadingRequestedPreset
    ? 'Loading preset'
    : engine.selectedPreset
      ? engine.selectedPreset.title
      : engine.missingRequestedPreset
        ? 'Choose another preset'
        : (engine.featuredPreset?.title ?? 'Recommended preset');
  const stageSummary = engine.loadingRequestedPreset
    ? `Loading ${ui.routeState.presetId}.`
    : engine.selectedPreset
      ? engine.selectedPreset.author || 'Unknown author'
      : engine.missingRequestedPreset
        ? 'Start with the recommended preset, or browse the full list.'
        : engine.featuredPreset
          ? describePresetMood(engine.featuredPreset)
          : 'Start demo audio, or browse presets first.';

  useEffect(() => {
    return connectWakeLock(() => {
      return (
        isFullscreen || (liveMode && (engineSnapshot?.audioActive ?? false))
      );
    });
  }, [isFullscreen, liveMode, engineSnapshot?.audioActive]);

  useEffect(() => {
    if (liveMode && engineSnapshot?.audioActive) {
      showHint('first-play');
    }
  }, [liveMode, engineSnapshot?.audioActive, showHint]);

  useEffect(() => {
    if (ui.routeState.panel === 'browse') {
      showHint('browse-open');
    }
  }, [ui.routeState.panel, showHint]);

  useEffect(() => {
    if (ui.routeState.panel === 'editor') {
      showHint('editor-open');
    }
  }, [ui.routeState.panel, showHint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: internal refs and service methods don't change
  useEffect(() => {
    const activePresetId = engineSnapshot?.activePresetId;
    if (!activePresetId) return;
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    temporalMemory.record(activePresetId, canvas);
  }, [engineSnapshot?.activePresetId]);

  useEffect(() => {
    const presetId = engineSnapshot?.activePresetId;
    const title = engine.selectedPreset?.title;
    if (!presetId || !title) return;
    setSessionHistory((current) => {
      if (current[0]?.presetId === presetId) return current;
      return [{ presetId, title, at: Date.now() }, ...current].slice(0, 50);
    });
  }, [engineSnapshot?.activePresetId, engine.selectedPreset?.title]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore snapshot sub-properties
  useEffect(() => {
    if (!engineSnapshot?.audioActive) {
      setAudioMatch(null);
      return;
    }
    const controller = new AbortController();
    const snap = engineSnapshot;
    const profile = buildAudioProfile({ audioEnergy: snap.audioEnergy });
    if (profile.rms < 0.02) return;

    void searchByAudioProfile(profile, controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      if (results.length === 0) return;
      const top = results[0];
      if (top.score < 0.75) return;
      const preset = engine.catalog.find((e) => e.id === top.presetId);
      setAudioMatch({
        presetId: top.presetId,
        name: preset?.title ?? top.presetId,
        score: top.score,
      });
    });

    return () => controller.abort();
  }, [engineSnapshot?.audioActive, engineSnapshot?.audioSource]);

  useEffect(() => {
    const handleOpenShortcuts = () => setShowShortcuts(true);
    window.addEventListener('stims:shortcuts:open', handleOpenShortcuts);
    return () =>
      window.removeEventListener('stims:shortcuts:open', handleOpenShortcuts);
  }, []);

  useEffect(() => {
    const preference = getActiveThemePreference();
    applyTheme(preference.theme);
  }, []);

  useEffect(() => {
    reportLoadStatus('shell-rendered');
    const el = document.getElementById('stims-loading');
    if (el) el.hidden = true;
  }, []);

  const handleToggleTheme = useCallback(() => {
    const current = getActiveThemePreference();
    const next = current.theme === 'dark' ? 'light' : 'dark';
    setThemePreference({ theme: next });
    applyTheme(next);
  }, []);

  const stageAnchoredToolOpen = ui.routeState.panel === 'editor';

  return (
    <main
      className="stims-shell"
      id="stims-main"
      data-has-toast={ui.toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
      data-preview={ui.routeState.previewMode ? 'true' : undefined}
      data-sheet-open={
        ui.routeState.panel && !stageAnchoredToolOpen ? 'true' : undefined
      }
      data-thumb-mode={thumbMode ? 'true' : undefined}
      data-offline={offline ? 'true' : undefined}
    >
      <a href="#stims-visualizer" className="skip-link">
        Skip to visualizer
      </a>
      <WorkspaceStagePanel
        isFullscreen={isFullscreen}
        launchPanel={<NewHomePage />}
        liveMode={liveMode}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleTheme={handleToggleTheme}
        stageEyebrow={stageEyebrow}
        stageSummary={stageSummary}
        stageTitle={stageTitle}
      />

      <RendererFallbackBadge />

      <BottomSheet
        open={ui.routeState.panel !== null}
        onClose={() => ui.updatePanel(null)}
        title={getToolLabel(ui.routeState.panel ?? 'browse')}
        description={getToolDescription(ui.routeState.panel ?? 'browse')}
        position={
          isWideEnough && ui.routeState.panel !== 'browse' ? 'right' : 'bottom'
        }
        withBackdrop={!stageAnchoredToolOpen}
        snapPoints={
          ui.routeState.panel === 'browse'
            ? ['half', 'full']
            : ['compact', 'half', 'full']
        }
        defaultSnapPoint={ui.routeState.panel === 'browse' ? 'half' : 'compact'}
        tabs={
          ui.routeState.panel
            ? TOOL_TABS.filter(
                (t) =>
                  t !== 'inspector' &&
                  (ui.routeState.panel === 'editor' || t !== 'editor'),
              ).map((tool) => ({
                id: tool,
                label: getToolLabel(tool),
                active: ui.routeState.panel === tool,
                onSelect: () => ui.updatePanel(tool),
              }))
            : undefined
        }
        onOpen={() => {
          if (ui.routeState.panel === 'browse') {
            const el = document.querySelector<HTMLElement>(
              BROWSE_PANEL_FOCUS_SELECTOR,
            );
            el?.focus();
          }
        }}
      >
        <Suspense fallback={null}>
          {ui.routeState.panel === 'editor' ? <EditorPanel /> : null}
          {ui.routeState.panel === 'browse' ? (
            <BrowseSheetPanel
              offline={offline}
              sessionHistory={sessionHistory}
              onCollectionTagChange={(collectionTag) =>
                ui.commitRoute({ ...ui.routeState, collectionTag })
              }
              onImport={(files) => {
                void ui.handleImport(files);
              }}
            />
          ) : null}
          {ui.routeState.panel === 'settings' ? (
            <SettingsSheetPanel
              thumbMode={thumbMode}
              onThumbModeChange={updateThumbMode}
              partyRemoteMode={partyRemoteMode}
              onPartyRemoteModeChange={updatePartyRemoteMode}
              hapticsEnabled={hapticsEnabled}
              onHapticsEnabledChange={updateHapticsEnabled}
              offline={offline}
              installAvailable={installPrompt !== null}
              onInstallApp={handleInstallApp}
              onCompatibilityModeChange={setCompatibilityMode}
              onMotionPreferenceChange={(enabled) =>
                setMotionPreference({ enabled })
              }
            />
          ) : null}
        </Suspense>
      </BottomSheet>

      {offline ? (
        <div className="stims-shell__mobile-notice" role="status">
          Offline party mode: saved presets and cached previews still work.
        </div>
      ) : installPrompt ? (
        <div className="stims-shell__mobile-notice" role="status">
          <span>Install Stims for faster mobile launch.</span>
          <button type="button" onClick={handleInstallApp}>
            Install
          </button>
          <button type="button" onClick={() => setInstallPrompt(null)}>
            Not now
          </button>
        </div>
      ) : null}

      {showRotateHint ? (
        <div className="stims-shell__rotate-hint" role="status">
          <span>Rotate your phone for theater mode.</span>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem('stims:rotate-hint-dismissed', 'true');
              } catch {}
              setShowRotateHint(false);
            }}
          >
            Got it
          </button>
        </div>
      ) : null}

      <ContextualHelp hint={visibleHint} onDismiss={dismissHint} />

      {liveMode ? (
        <MobileControlBar
          audioEnergy={audioEnergy}
          presetTitle={
            engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? ''
          }
          presetAuthor={
            engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? ''
          }
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onToggleTheme={handleToggleTheme}
          thumbMode={thumbMode}
          partyRemoteMode={partyRemoteMode}
          hapticsEnabled={hapticsEnabled}
        />
      ) : null}
      <AudioMatchToast
        match={audioMatch}
        onSelect={engine.handlePresetSelection}
        onDismiss={() => setAudioMatch(null)}
      />
      <ShortcutsDialog
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        shortcutsRef={shortcutsRef}
      />
    </main>
  );
}

export function StimsWorkspaceApp() {
  return (
    <StimsErrorBoundary>
      <WorkspaceProvider>
        <StimsWorkspaceAppShell />
      </WorkspaceProvider>
    </StimsErrorBoundary>
  );
}
