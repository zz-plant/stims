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
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
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
      void engine.handlePlayPreset(engine.featuredPreset.id);
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
              onCompatibilityModeChange={setCompatibilityMode}
              onMotionPreferenceChange={(enabled) =>
                setMotionPreference({ enabled })
              }
            />
          ) : null}
        </Suspense>
      </BottomSheet>

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
