import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import '../../css/app-shell.css';
import '../../css/shell-theme.css';
import '../../css/shell-launch.css';
import '../../css/chrome.css';
import '../../css/editor-panel.css';
import {
  applyAccessibility,
  getActiveAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import { setMotionPreference } from '../core/motion-preferences.ts';
import { scheduleIdleTask } from '../utils/browser/idle-task.ts';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { useTemporalMemory } from '../core/services/temporal-memory.ts';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import { saveLastSession } from '../core/state/last-session-store.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  applyTheme,
  getActiveThemePreference,
} from '../core/theme-preferences.ts';
import { AudioMatchToast } from './AudioMatchToast.tsx';
import {
  initAgentBridge,
  toAgentEditorState,
  updateAgentTelemetry,
} from './agent-bridge.ts';
import { ContextualHelp, useHelpHints } from './ContextualHelp.tsx';
import { CreditsDialog } from './CreditsDialog.tsx';
import { StimsErrorBoundary } from './ErrorBoundary.tsx';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { HudOverlay } from './HudOverlay.tsx';
import { useAgentFrameRate } from './hooks/useAgentFrameRate';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStageGesture } from './hooks/useStageGesture';
import { installLivePerformance } from './live-performance.ts';
import { reportLoadStatus } from './load-status.ts';
import { MidiPerformanceHud } from './MidiPerformanceHud.tsx';

const NewHomePage = lazy(() =>
  import('./NewHomePage.tsx').then((m) => ({
    default: m.NewHomePage,
  })),
);

import { bindMidiToMilkdropControls } from './performance-hardware-controls.ts';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { SyncSessionBridge } from './SyncSessionBridge.tsx';
import { decodePresetCodeFromHash } from './url-state.ts';
import { connectWakeLock } from './wake-lock.ts';
import {
  useEngineSnapshot,
  useWorkspace,
  WorkspaceProvider,
} from './workspace-context.tsx';
import { getToolLabel } from './workspace-helpers.ts';
import {
  BROWSE_PANEL_FOCUS_SELECTOR,
  WorkspaceStagePanel,
} from './workspace-ui.tsx';

const PresetFinderPanel = lazy(() =>
  import('./PresetFinderPanel.tsx').then((m) => ({
    default: m.PresetFinderPanel,
  })),
);
const BrowseSheetPanel = lazy(() =>
  import('./BrowseSheetPanel.tsx').then((m) => ({
    default: m.BrowseSheetPanel,
  })),
);
const CapturePanel = lazy(() =>
  import('./CapturePanel.tsx').then((m) => ({ default: m.CapturePanel })),
);
const EditorPanel = lazy(() =>
  import('./EditorPanel.tsx').then((m) => ({ default: m.EditorPanel })),
);
const RefinePanel = lazy(() =>
  import('./RefinePanel.tsx').then((m) => ({ default: m.RefinePanel })),
);
const SettingsSheetPanel = lazy(() =>
  import('./SettingsSheetPanel.tsx').then((m) => ({
    default: m.SettingsSheetPanel,
  })),
);
const SynthesizePanel = lazy(() =>
  import('./SynthesizePanel.tsx').then((m) => ({ default: m.SynthesizePanel })),
);
const SidePanel = lazy(() =>
  import('./SidePanel.tsx').then((m) => ({ default: m.SidePanel })),
);

function prefersThumbModeByDefault() {
  try {
    return window.matchMedia('(pointer: coarse) and (max-width: 767px)')
      .matches;
  } catch {
    return false;
  }
}

/**
 * Schedule a non-critical effect to run during browser idle time.
 * Falls back to a short setTimeout when requestIdleCallback is unavailable.
 * Returns a cleanup function that cancels the pending task.
 */
function deferToIdle(fn: () => undefined | (() => void)): () => void {
  let cancelled = false;
  let dispose: (() => void) | undefined;
  const run = () => {
    if (cancelled) return;
    dispose = fn();
  };
  const cancel = scheduleIdleTask(run, { idleTimeout: 2000, fallbackDelay: 80 });
  return () => {
    cancelled = true;
    cancel();
    dispose?.();
  };
}

function StimsWorkspaceAppShell() {
  const { ui, engine } = useWorkspace();
  // Latest-value ref: the live-performance runtime is installed once per
  // engine, but needs the current route when it starts Strudel audio. Reading
  // `ui` directly would rebuild the runtime on every route change.
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const { engineSnapshot } = useEngineSnapshot();
  const temporalMemory = useTemporalMemory();

  const { isFullscreen, handleToggleFullscreen } = useFullscreen(
    ui.stageRef,
    ui.setStatusMessage,
  );

  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [audioMatch, setAudioMatch] = useState<{
    presetId: string;
    name: string;
    score: number;
  } | null>(null);
  const [thumbMode, setThumbMode] = useState(() => {
    try {
      const stored = localStorage.getItem('stims:mobile-thumb-mode');
      if (stored !== null) return stored === 'true';
      return prefersThumbModeByDefault();
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
  // ShortcutsDialog owns the focus trap and initial focus placement via
  // `useFocusTrap` while this shell controls when it opens.
  const shortcutsRef = useRef<HTMLDivElement | null>(null);
  const creditsRef = useRef<HTMLDivElement | null>(null);

  const { visibleHint, showHint, dismissHint } = useHelpHints();

  // Stable identity matters here: SidePanel's open-effect keys off this
  // callback's reference (`[open, onOpen]`), so an inline arrow function
  // would re-fire on every App re-render — including the frequent ones
  // driven by engine snapshot churn while audio is playing — and yank focus
  // back into the search field out from under whatever the user just
  // focused (Tab-navigating the preset list, for instance).
  const handleSidePanelOpen = useCallback(() => {
    if (ui.routeState.panel === 'browse') {
      const el = document.querySelector<HTMLElement>(
        BROWSE_PANEL_FOCUS_SELECTOR,
      );
      el?.focus();
    }
  }, [ui.routeState.panel]);

  useAgentFrameRate(ui.routeState.agentMode);

  useDocumentTitle({
    loadingPreset: engine.loadingRequestedPreset,
    selectedPresetTitle: engine.selectedPreset?.title ?? null,
    panel: ui.routeState.panel,
    liveMode,
    engineReady: engine.engineReady,
  });

  // Shared between the touch long-press gesture and the "L" keyboard
  // shortcut — one definition of "favorite whatever's currently playing"
  // rather than two copies that could drift.
  const toggleFavoriteCurrentPreset = () => {
    const activePresetId = engineSnapshot?.activePresetId;
    if (!activePresetId) {
      ui.setStatusMessage('Load a preset before saving it.');
      return;
    }
    const activePreset =
      engine.selectedPreset?.id === activePresetId
        ? engine.selectedPreset
        : null;
    void engine.toggleFavoritePreset(activePresetId, !activePreset?.isFavorite);
    ui.setStatusMessage(
      activePreset?.isFavorite
        ? 'Removed from saved presets.'
        : 'Saved preset.',
    );
  };

  useKeyboardShortcuts({
    liveMode,
    engineReady: engine.engineReady,
    panel: ui.routeState.panel,
    filteredCatalog: engine.filteredCatalog,
    updatePanel: ui.updatePanel,
    handlePresetSelection: engine.handlePresetSelection,
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
    handleAudioStop: engine.handleAudioStop,
    handleVisualSearch: engine.handleVisualSearch,
    handleToggleFullscreen,
    toggleFavoritePreset: toggleFavoriteCurrentPreset,
    setStatusMessage: ui.setStatusMessage,
    setShowShortcuts,
  });

  useStageGesture({
    enabled: liveMode,
    stageRef: ui.stageRef,
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
    openBrowse: () => ui.updatePanel('browse'),
    closePanel: () => ui.updatePanel(null),
    toggleFavoritePreset: toggleFavoriteCurrentPreset,
    handleToggleFullscreen,
    setStatusMessage: ui.setStatusMessage,
    hapticsEnabled,
  });

  // Agent bridge is only needed for MCP/automation sessions; defer to idle
  // so it doesn't block the interactive shell on first paint.
  useEffect(() => {
    return deferToIdle(() => {
      return initAgentBridge({
        onLoadPreset: (payload) => {
          // milkSource is how an agent hands over preset *code* rather than a
          // catalog id (MCP's session_apply_source). The bridge has always
          // forwarded it and this handler always dropped it, so that tool
          // silently did nothing.
          if (payload.milkSource) {
            engine.updateEditorSource(payload.milkSource);
            return;
          }
          if (payload.presetId) {
            void engine.handlePlayPreset(payload.presetId);
          }
        },
        onApplyTweak: (_tweak) => {
          if (engineSnapshot?.activePresetId) {
            void engine.handlePlayPreset(engineSnapshot.activePresetId);
          }
        },
        // Lets an MCP session_midi_set/session_midi_cc call "perform" on the
        // live stage through the exact same virtual-device pipeline a
        // physical controller uses — see webmidi-controller.ts.
        onMidiSet: (target, value) => {
          webMidiService.injectTargetValue(
            VIRTUAL_CLAUDE_DEVICE_ID,
            target,
            value,
          );
        },
        onMidiCc: (cc, value) => {
          webMidiService.injectControlChange(
            VIRTUAL_CLAUDE_DEVICE_ID,
            cc,
            value,
          );
        },
        getMidiBindings: () => webMidiService.getAllBindings(),
        getMidiDevices: () => webMidiService.getDevices(),
        // Read/await surface for live code editing. Without these an agent
        // could send preset source but never learn whether it compiled.
        getEditorState: () => {
          const state = engine.getEditorSessionState();
          return state ? toAgentEditorState(state) : null;
        },
        getEditorFields: () => {
          // The editor session's own latest compile, not the renderer's active
          // one. They diverge whenever rendering is paused (a hidden or headless
          // tab) or the newest source failed — and an agent reading values to
          // compute a delta needs the buffer it is actually editing.
          const compiled =
            engine.getEditorSessionState()?.latestCompiled ??
            engine.getActiveCompiledPreset();
          return compiled ? { ...compiled.ir.numericFields } : null;
        },
        applyEditorSource: async (source) => {
          const state = await engine.applyEditorSourceAwaited(source);
          return state ? toAgentEditorState(state) : null;
        },
        applyEditorFields: async (updates) => {
          const state = await engine.applyEditorFieldsAwaited(updates);
          return state ? toAgentEditorState(state) : null;
        },
      });
    });
  }, [engine, engineSnapshot?.activePresetId]);

  // The editor and refine panels are code-split, and the editor's first open
  // pays for the whole codemirror/compiler graph (the largest lazy dependency
  // chain in the app). Warm those chunks during idle after first paint so the
  // first E/G press doesn't stall on the download.
  useEffect(() => {
    return deferToIdle(() => {
      void import('./EditorPanel.tsx');
      void import('./RefinePanel.tsx');
      void import('../milkdrop/overlay/editor-panel.ts');
    });
  }, []);

  // Physical and virtual (MCP) MIDI both drive the engine through this one
  // binding. It used to live inside PerformanceHardwareSection, which only
  // stayed mounted while Settings was open — closing Settings silently cut
  // the live wire between a controller and the visuals.
  // Deferred to idle: MIDI init and live performance setup are not needed for
  // first paint and can safely wait until the browser is idle.
  useEffect(() => {
    return deferToIdle(() => {
      webMidiService.initialize();

      // The live-performance runtime owns `window.__stims_live` (ramps, Strudel
      // patterns, signal measurement) on top of the four controls this effect
      // used to publish inline.
      const uninstallLive =
        typeof window === 'undefined'
          ? () => {}
          : installLivePerformance({
              setTarget: (target, value) => {
                engine.updateInspectorField(target, value);
              },
              injectMidiCC: (cc, value) => {
                webMidiService.injectControlChange(
                  VIRTUAL_CLAUDE_DEVICE_ID,
                  cc,
                  value,
                );
              },
              nextPreset: () => {
                engine.handleShufflePreset();
              },
              previousPreset: () => {
                engine.handlePreviousPreset();
              },
              startStreamAudio: async (stream) => {
                const nextRoute = {
                  ...uiRef.current.routeState,
                  audioSource: 'file' as const,
                };
                uiRef.current.commitRoute(nextRoute);
                await engine.startAudioSource({
                  source: 'file',
                  stream,
                  launchState: nextRoute,
                });
              },
            });

      const unbindMidi = bindMidiToMilkdropControls(
        webMidiService,
        (target, value) => {
          engine.updateInspectorField(target, value);
        },
      );

      return () => {
        uninstallLive();
        unbindMidi();
      };
    });
  }, [engine]);

  useEffect(() => {
    // `fps` is deliberately omitted: useAgentFrameRate owns that field and
    // publishes a measured value. updateAgentTelemetry merges patches, so
    // leaving it out preserves the sampled reading instead of overwriting it.
    const aq = engineSnapshot?.adaptiveQuality ?? null;

    updateAgentTelemetry({
      backend: engineSnapshot?.backend ?? 'webgl',
      quality: aq
        ? {
            step: aq.qualityStep,
            stepCount: aq.qualityStepCount,
            adaptation: aq.adaptation,
            averageFrameMs: aq.averageFrameMs,
            averageCadenceMs: aq.averageCadenceMs,
            frameBudgetMs: aq.frameBudgetMs,
            renderScaleMultiplier: aq.renderScaleMultiplier,
            maxPixelRatioMultiplier: aq.maxPixelRatioMultiplier,
          }
        : null,
      audioEnergy: engineSnapshot?.audioEnergy ?? getAudioEnergy(),
      currentPresetId:
        engineSnapshot?.activePresetId ?? ui.routeState.presetId ?? null,
      agentMode: ui.routeState.agentMode,
    });
  }, [engineSnapshot, ui.routeState.presetId, ui.routeState.agentMode]);

  // A #code= hash carries a full .milk source (see buildPresetCodeHash).
  // Opening the editor happens immediately so the visitor sees where the
  // code will land; applying the source has to wait until the session is
  // live and its initial preset has landed, otherwise the boot-time
  // fallback/featured preset would overwrite the deep-linked draft.
  const [pendingCode, setPendingCode] = useState<string | null>(() =>
    decodePresetCodeFromHash(),
  );
  const openedEditorForCodeRef = useRef(false);

  useEffect(() => {
    if (!pendingCode || openedEditorForCodeRef.current) return;
    openedEditorForCodeRef.current = true;
    ui.updatePanel('editor');
  }, [pendingCode, ui]);

  useEffect(() => {
    // Boot-time preset loads (fallback, featured, ?preset=) land as async
    // editor-session commits, so a single apply can be overwritten by a
    // load that was already in flight. Re-assert the deep-linked source
    // every time the session settles on something else, and stop once the
    // snapshot reflects it — later loads are then real user actions and
    // must win.
    if (!pendingCode || !engine.engineReady) return;
    if (engineSnapshot?.currentSource === pendingCode) {
      setPendingCode(null);
      return;
    }
    engine.updateEditorSource(pendingCode);
  }, [pendingCode, engine.engineReady, engineSnapshot?.currentSource, engine]);

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
      return scheduleIdleTask(request, { fallbackDelay: 1500 });
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

    const inspectAudioEnergy = () => {
      if (getAudioEnergy() < 0.04) {
        if (quietAtRef.current === null) {
          quietAtRef.current = performance.now();
        } else if (
          performance.now() - quietAtRef.current >= 3000 &&
          !quietDemoSuggestedRef.current
        ) {
          quietDemoSuggestedRef.current = true;
          ui.setStatusMessage(
            'Not seeing much movement? Check that the captured tab is sharing audio.',
          );
        }
      } else if (quietAtRef.current !== null || quietDemoSuggestedRef.current) {
        quietAtRef.current = null;
        quietDemoSuggestedRef.current = false;
      }
    };

    inspectAudioEnergy();
    return subscribeAudioEnergy(inspectAudioEnergy);
  }, [
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
    let hideTimer: number | null = null;

    const update = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
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
      try {
        localStorage.setItem('stims:rotate-hint-dismissed', 'true');
      } catch {}
      setShowRotateHint(true);
      hideTimer = window.setTimeout(() => setShowRotateHint(false), 4200);
    };
    update();
    media.addEventListener('change', update);
    return () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
      media.removeEventListener('change', update);
    };
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

  useEffect(() => {
    return connectWakeLock(() => {
      return (
        isFullscreen || (liveMode && (engineSnapshot?.audioActive ?? false))
      );
    });
  }, [isFullscreen, liveMode, engineSnapshot?.audioActive]);

  useEffect(() => {
    // Deferred, not skipped: re-running once showRotateHint clears (it's a
    // dependency) lets the two toasts land one after another instead of
    // overlapping in the same bottom-of-screen slot on first mobile launch.
    if (liveMode && engineSnapshot?.audioActive && !showRotateHint) {
      showHint('first-play');
    }
  }, [liveMode, engineSnapshot?.audioActive, showRotateHint, showHint]);

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

  useEffect(() => {
    const presetId = engineSnapshot?.activePresetId;
    const presetTitle = engine.selectedPreset?.title;
    const source = currentAudioSource;
    if (!presetId || !presetTitle || !engineSnapshot?.audioActive) return;
    // 'file' sources can't be resumed — there's no persisted handle to reopen.
    if (
      source !== 'demo' &&
      source !== 'microphone' &&
      source !== 'tab' &&
      source !== 'youtube'
    ) {
      return;
    }
    saveLastSession({ presetId, presetTitle, source });
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.audioActive,
    engine.selectedPreset?.title,
    currentAudioSource,
  ]);

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
    if (!audioMatch) return;
    const timeoutId = window.setTimeout(() => setAudioMatch(null), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [audioMatch]);

  useEffect(() => {
    const handleOpenShortcuts = () => setShowShortcuts(true);
    window.addEventListener('stims:shortcuts:open', handleOpenShortcuts);
    return () =>
      window.removeEventListener('stims:shortcuts:open', handleOpenShortcuts);
  }, []);

  useEffect(() => {
    const handleOpenCredits = () => setShowCredits(true);
    window.addEventListener('stims:credits:open', handleOpenCredits);
    return () =>
      window.removeEventListener('stims:credits:open', handleOpenCredits);
  }, []);

  useEffect(() => {
    const preference = getActiveThemePreference();
    applyTheme(preference.theme);
  }, []);

  useEffect(() => {
    applyAccessibility(getActiveAccessibilityPreference());
  }, []);

  useEffect(() => {
    reportLoadStatus('shell-rendered');
    const el = document.getElementById('stims-loading');
    if (el) el.hidden = true;
  }, []);

  const stageAnchoredToolOpen = ui.routeState.panel === 'editor';

  return (
    <main
      className="stims-shell"
      id="stims-main"
      data-has-toast={ui.toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
      data-active-preset-id={engineSnapshot?.activePresetId ?? undefined}
      data-preview={ui.routeState.previewMode ? 'true' : undefined}
      data-sheet-open={
        ui.routeState.panel && !stageAnchoredToolOpen ? 'true' : undefined
      }
      data-stage-tool-open={stageAnchoredToolOpen ? 'true' : undefined}
      data-thumb-mode={thumbMode ? 'true' : undefined}
      data-offline={offline ? 'true' : undefined}
    >
      <a href="#stims-visualizer" className="skip-link">
        Skip to visualizer
      </a>
      <WorkspaceStagePanel
        isFullscreen={isFullscreen}
        launchPanel={
          <Suspense fallback={null}>
            <NewHomePage />
          </Suspense>
        }
        liveMode={liveMode}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <SidePanel
        open={ui.routeState.panel !== null}
        onClose={() => ui.updatePanel(null)}
        title={getToolLabel(ui.routeState.panel ?? 'browse')}
        stageAnchored={stageAnchoredToolOpen}
        fillBody={stageAnchoredToolOpen}
        onOpen={handleSidePanelOpen}
      >
        <Suspense fallback={null}>
          {ui.routeState.panel === 'editor' ? <EditorPanel /> : null}
          {ui.routeState.panel === 'capture' ? <CapturePanel /> : null}
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
              onOpenShortcuts={() => setShowShortcuts(true)}
              onOpenCredits={() => setShowCredits(true)}
            />
          ) : null}
          {ui.routeState.panel === 'refine' ? <RefinePanel /> : null}
          {/* One panel, two seeds. Both ids stay routable so existing deep
              links and the user's saved shortcuts keep working; they just
              open the same panel on a different tab. */}
          {ui.routeState.panel === 'audiomatch' ||
          ui.routeState.panel === 'visualsearch' ? (
            <PresetFinderPanel
              initialMode={
                ui.routeState.panel === 'visualsearch' ? 'look' : 'sound'
              }
              onClose={() => ui.updatePanel(null)}
            />
          ) : null}
          {ui.routeState.panel === 'synthesize' ? (
            <SynthesizePanel offline={offline} />
          ) : null}
        </Suspense>
      </SidePanel>

      {offline ? (
        <div className="stims-shell__mobile-notice" role="status">
          Offline party mode: saved presets and cached previews still work.
        </div>
      ) : null}

      {showRotateHint ? (
        <div className="stims-shell__rotate-hint" role="status">
          <span>Rotate your phone for theater mode.</span>
        </div>
      ) : null}

      {ui.routeState.panel ? null : <ContextualHelp hint={visibleHint} />}

      <SyncSessionBridge />

      <AudioMatchToast
        match={audioMatch}
        onSelect={engine.handlePresetSelection}
      />
      <MidiPerformanceHud />
      <ShortcutsDialog
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        shortcutsRef={shortcutsRef}
      />
      <CreditsDialog
        open={showCredits}
        onClose={() => setShowCredits(false)}
        creditsRef={creditsRef}
      />
      <HudOverlay />
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
