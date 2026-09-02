/**
 * Composes the workspace: which surfaces exist and when each is shown.
 *
 * The top-level React component for the product. It assembles the stage,
 * browse, editor, settings and capture surfaces, wires them to URL state, and
 * decides layout across breakpoints and modes.
 *
 * It is long because it is a composition root — the density is wiring, not
 * algorithm, and the individual panels own their own logic. Rendering work
 * belongs behind the engine adapter, not here; this file should stay
 * declarative enough to read top to bottom.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import '../../css/app-shell.css';
import '../../css/shell-theme.css';
import '../../css/shell-launch.css';
import '../../css/chrome.css';
import {
  applyAccessibility,
  getActiveAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import {
  describeHiddenTabFreezeRisk,
  toggleLivePerformanceMode,
} from '../core/live-performance-mode.ts';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import { saveLastSession } from '../core/state/last-session-store.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  getActiveThemePreference,
  setThemePreference,
  startThemeSync,
  subscribeToThemePreference,
  type ThemeChoice,
} from '../core/theme-preferences.ts';
import { parseURLParams } from '../core/url-params.ts';
import { presetReadsInteractionSignals } from '../milkdrop/runtime/interaction-response.ts';
import { scheduleIdleTask } from '../utils/browser/idle-task.ts';
import { AudioMatchToast } from './AudioMatchToast.tsx';
import {
  getAgentTelemetry,
  initAgentBridge,
  toAgentEditorState,
  updateAgentTelemetry,
} from './agent-bridge.ts';
import {
  type AgentCoreSnapshot,
  emitAgentCommit,
  installAgentStateGlobal,
} from './agent-state.ts';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
import { ContextualHelp, useHelpHints } from './ContextualHelp.tsx';
import { CreditsDialog } from './CreditsDialog.tsx';
import type { CommandAction } from './command-palette-registry.ts';
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
import { LiveParameterHud } from './LiveParameterHud.tsx';
import { installLivePerformance } from './live-performance.ts';
import { reportLoadStatus } from './load-status.ts';
import { dismissLoadingScreen } from './loading-screen.ts';
import { prefetchPanelChunk } from './panel-chunks.ts';
import { openPerformPicker, pinTarget, unpinTarget } from './perform-pins.ts';
import {
  SilentAudioNotice,
  useAudioAwaitingGesture,
} from './SilentAudioNotice.tsx';

const NewHomePage = lazy(() =>
  import('./NewHomePage.tsx').then((m) => ({
    default: m.NewHomePage,
  })),
);

import { bindMidiToMilkdropControls } from './performance-hardware-controls.ts';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { SyncSessionBridge } from './SyncSessionBridge.tsx';
import { readStored, writeStored } from './safe-storage.ts';
import { getSyncSessionState, subscribeSyncSession } from './sync-session.ts';
import { decodePresetCodeFromHash } from './url-state.ts';
import { connectWakeLock } from './wake-lock.ts';
import {
  endWatchParty,
  openRecordPanel,
  presentToExternalDisplayAction,
  setTransition,
  startAudioSource,
  startOrCopyWatchPartyAction,
  toggleAutoplay,
  toggleCameraAction,
  togglePanel,
} from './workspace-actions.ts';
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

/**
 * Start the routed panel's chunk downloading immediately.
 *
 * Every panel is a lazy chunk, and the idle prewarms below cover the panels a
 * user is *likely* to open next. Neither covered the one the URL explicitly
 * asked for: the route is known the moment the URL parses, but the import
 * only fired once React had mounted and rendered the panel, so a deep link
 * sat on the Suspense skeleton for a round trip it never needed to pay.
 *
 * This runs at module scope — before the first render — and is deliberately
 * not deferred to idle: unlike a speculative prewarm, this chunk is on the
 * critical path of the page the user actually requested.
 */
try {
  prefetchPanelChunk(parseURLParams().routing.panel);
} catch (error) {
  // A malformed URL must never keep the shell from booting.
  console.debug('Routed panel prefetch skipped', error);
}

// The one "is there real audio" cutoff for getAudioEnergy()/rms readings,
// shared by the audio-match search below and the quiet-audio coaching nudge.
// These used to disagree (0.02 vs 0.04) despite reading the same signal —
// 0.04 is the value audio-matcher.ts already uses internally for its own
// beatIntensity gate, so it's the canonical threshold, not an arbitrary pick.
const QUIET_AUDIO_RMS_THRESHOLD = 0.04;

/** Stable keys for the browse skeleton's placeholder tiles. */
const BROWSE_SKELETON_TILES = [
  't1',
  't2',
  't3',
  't4',
  't5',
  't6',
  't7',
  't8',
  't9',
];

/**
 * Rendered while a lazy panel chunk downloads. On a cold cache that can take
 * seconds, and an empty sheet reads as broken — announce and show progress.
 *
 * Shaped per panel rather than four identical bars. A skeleton earns its place
 * by predicting the layout that replaces it, so the panel appears to resolve
 * into focus; four grey rows that then get swapped for a search field and a
 * grid of tiles is just a different loading state, and reads as one more thing
 * to wait through. `browse` is the panel this matters most for — it is the
 * most-opened surface in the app, and the only one whose shape is nothing like
 * a stack of rows.
 */
function PanelLoadingFallback({ panel }: { panel?: string | null }) {
  if (panel === 'browse') {
    return (
      <div
        className="stims-shell__panel-loading"
        data-shape="browse"
        role="status"
        aria-label="Loading panel"
      >
        <div className="stims-shell__skeleton stims-shell__skeleton--search" />
        <div className="stims-shell__skeleton-chips">
          <div className="stims-shell__skeleton stims-shell__skeleton--chip" />
          <div className="stims-shell__skeleton stims-shell__skeleton--chip" />
          <div className="stims-shell__skeleton stims-shell__skeleton--chip" />
        </div>
        <div className="stims-shell__skeleton-grid">
          {BROWSE_SKELETON_TILES.map((id) => (
            <div
              key={id}
              className="stims-shell__skeleton stims-shell__skeleton--tile"
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div
      className="stims-shell__panel-loading"
      role="status"
      aria-label="Loading panel"
    >
      <div className="stims-shell__skeleton" />
      <div className="stims-shell__skeleton" />
      <div className="stims-shell__skeleton" />
      <div className="stims-shell__skeleton" />
    </div>
  );
}

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
function deferToIdle(
  fn: () => undefined | (() => void),
  options?: { idleTimeout?: number; fallbackDelay?: number },
): () => void {
  let cancelled = false;
  let dispose: (() => void) | undefined;
  const run = () => {
    if (cancelled) return;
    dispose = fn();
  };
  const cancel = scheduleIdleTask(run, {
    idleTimeout: options?.idleTimeout ?? 2000,
    fallbackDelay: options?.fallbackDelay ?? 80,
  });
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
  const awaitingAudioGesture = useAudioAwaitingGesture();
  const growthLandingEventsRef = useRef<Set<string>>(new Set());
  const audioStartedReportedRef = useRef(false);

  useEffect(() => {
    const route = ui.routeState;
    if (route.previewMode && !growthLandingEventsRef.current.has('embed')) {
      growthLandingEventsRef.current.add('embed');
      noteGrowthEvent('embed-landing');
    }
    if (route.discovery && !growthLandingEventsRef.current.has('discovery')) {
      growthLandingEventsRef.current.add('discovery');
      noteGrowthEvent('discovery-landing');
    }
  }, [ui.routeState]);

  useEffect(() => {
    if (
      !audioStartedReportedRef.current &&
      engineSnapshot?.audioActive &&
      !awaitingAudioGesture
    ) {
      audioStartedReportedRef.current = true;
      noteGrowthEvent('audio-started');
    }
    if (!engineSnapshot?.audioActive) {
      audioStartedReportedRef.current = false;
    }
  }, [awaitingAudioGesture, engineSnapshot?.audioActive]);
  // Latest-value refs for the agent bridge: the bridge must be installed
  // exactly once. Depending on `engine`/`engineSnapshot` re-ran the install
  // effect on every snapshot emit, and each re-run tore the window `message`
  // listener down for seconds (deferToIdle) — agent/automation messages
  // (preview capture, MCP) landing in the gap were silently dropped.
  const engineBridgeRef = useRef(engine);
  engineBridgeRef.current = engine;
  const engineSnapshotRef = useRef(engineSnapshot);
  engineSnapshotRef.current = engineSnapshot;

  const { isFullscreen, handleToggleFullscreen } = useFullscreen(
    ui.stageRef,
    ui.setStatusMessage,
  );

  const [showShortcuts, setShowShortcuts] = useState(false);
  // Drives the palette's theme row label, so it names the current choice.
  const themeChoice = useSyncExternalStore(
    subscribeToThemePreference,
    () => getActiveThemePreference().theme,
    () => 'dark' as ThemeChoice,
  );
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
  // Read inside dismissBrowseHint below, which must keep a stable identity:
  // it is handed to a lazy panel, and a new function each time a hint changes
  // would re-render that panel for no reason.
  const visibleHintRef = useRef(visibleHint);
  visibleHintRef.current = visibleHint;

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
    // Autoplay moves the stage on without moving `selectedPreset`, so the two
    // ids drift apart routinely. Falling back to null there made every press
    // in that state read "not a favorite": the gesture could only ever add,
    // and un-saving whatever was playing was impossible until you re-selected
    // it. The catalog knows the real state — ask it before assuming.
    const activePreset =
      engine.selectedPreset?.id === activePresetId
        ? engine.selectedPreset
        : (engine.catalog.find((entry) => entry.id === activePresetId) ??
          engine.favoritePresets.find((entry) => entry.id === activePresetId) ??
          null);
    void engine.toggleFavoritePreset(activePresetId, !activePreset?.isFavorite);
    ui.setStatusMessage(
      activePreset?.isFavorite
        ? 'Removed from saved presets.'
        : 'Saved preset.',
    );
  };

  // Declared ahead of useKeyboardShortcuts so keyboard bindings can dispatch
  // palette actions by id; the list itself is built further down and assigned
  // into this ref there.
  const paletteActionsRef = useRef<CommandAction[]>([]);

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
    runPaletteAction: (actionId) => {
      paletteActionsRef.current.find((a) => a.id === actionId)?.run();
    },
  });

  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteHotkey(() => setPaletteOpen(true));

  // Stable panel surface for the shared action bodies: reads through the
  // ref so the memoized action list never goes stale on route changes.
  const paletteSurface = useMemo(
    () => ({
      updatePanel: (panel: Parameters<typeof ui.updatePanel>[0]) =>
        uiRef.current.updatePanel(panel),
      routePanel: () => uiRef.current.routeState.panel ?? null,
    }),
    [],
  );

  const syncSession = useSyncExternalStore(
    subscribeSyncSession,
    getSyncSessionState,
  );
  const hostingWatchParty =
    syncSession.role === 'host' && syncSession.status !== 'idle';

  // Behavior bodies live in workspace-actions.ts, shared with the stage
  // dock menu — a verb must not do different things depending on which
  // surface invoked it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers are stable context methods; the list only needs to refresh with live/fullscreen/hosting state
  const paletteActions: CommandAction[] = useMemo(
    () => [
      {
        id: 'open-browse',
        group: 'Presets',
        label: 'Browse presets',
        run: () => togglePanel(paletteSurface, 'browse'),
      },
      {
        id: 'next-preset',
        group: 'Presets',
        label: 'Next preset (random)',
        keywords: ['shuffle', 'surprise'],
        run: () => void engine.handleShufflePreset(),
      },
      {
        id: 'previous-preset',
        group: 'Presets',
        label: 'Previous preset',
        keywords: ['back'],
        run: () => void engine.handlePreviousPreset(),
      },
      {
        id: 'save-preset',
        group: 'Presets',
        label: 'Save preset',
        keywords: ['favorite', 'star'],
        run: toggleFavoriteCurrentPreset,
      },
      {
        id: 'find-similar',
        group: 'Presets',
        label: 'Find similar presets',
        keywords: ['match', 'sound', 'look'],
        run: () => void engine.handleVisualSearch(),
      },
      {
        id: 'open-editor',
        group: 'Create',
        label: 'Edit preset code',
        run: () => togglePanel(paletteSurface, 'editor'),
      },
      {
        id: 'open-refine',
        group: 'Create',
        label: 'Refine with AI',
        run: () => togglePanel(paletteSurface, 'refine'),
      },
      {
        id: 'open-generate',
        group: 'Create',
        label: 'Generate with AI',
        keywords: ['synthesize', 'create', 'make'],
        run: () => togglePanel(paletteSurface, 'synthesize'),
      },
      {
        id: 'open-record',
        group: 'Share',
        label: 'Record video',
        keywords: ['capture', 'export'],
        run: () => openRecordPanel(paletteSurface),
      },
      {
        id: 'open-settings',
        group: 'View',
        label: 'Settings',
        run: () => togglePanel(paletteSurface, 'settings'),
      },
      {
        id: 'open-shortcuts',
        group: 'View',
        label: 'Shortcuts & gestures',
        keywords: ['help', 'keys', 'bindings', 'gestures', 'swipe', 'touch'],
        run: () => setShowShortcuts(true),
      },
      {
        // Cycles rather than offering three entries: the palette is a list you
        // scan, and three near-identical theme rows cost more attention than
        // the one extra press cycling costs.
        id: 'cycle-theme',
        group: 'View',
        label: `Theme: ${themeChoice === 'system' ? 'match system' : themeChoice}`,
        keywords: ['dark', 'light', 'appearance', 'contrast'],
        run: () => {
          const order: ThemeChoice[] = ['dark', 'light', 'system'];
          const next = order[(order.indexOf(themeChoice) + 1) % order.length];
          setThemePreference({ theme: next });
          ui.setStatusMessage(
            `Theme: ${next === 'system' ? 'match system' : next}`,
          );
        },
      },
      {
        // The reason this is worth a palette slot when the other graphics
        // settings are not: it is the one people reach for mid-playback, when
        // a preset is chugging and Settings is three interactions away.
        id: 'use-webgl',
        group: 'View',
        label: 'Switch renderer to WebGL',
        keywords: ['backend', 'webgpu', 'compatibility', 'slow', 'performance'],
        run: () => {
          setCompatibilityMode(true);
          ui.setStatusMessage('Renderer set to WebGL. Reload to apply.');
        },
      },
      {
        id: 'toggle-fullscreen',
        group: 'View',
        label: isFullscreen ? 'Exit full screen' : 'Full screen',
        run: handleToggleFullscreen,
      },
      {
        id: 'toggle-camera',
        group: 'View',
        label: 'Camera as video input',
        keywords: ['webcam', 'video', 'input', 'source'],
        run: () => toggleCameraAction(ui.setStatusMessage),
      },
      {
        id: 'external-display',
        group: 'Share',
        label: 'Show on second screen or cast',
        keywords: ['projector', 'monitor', 'chromecast', 'present', 'tv'],
        run: () => presentToExternalDisplayAction(ui.setStatusMessage),
      },
      {
        id: 'share-link',
        group: 'Share',
        label: 'Share link',
        keywords: ['copy', 'url'],
        run: () => void ui.handleShowCurrentLink(),
      },
      {
        id: 'watch-party',
        group: 'Share',
        label: hostingWatchParty
          ? 'Copy watch party link'
          : 'Start watch party (copy link)',
        keywords: ['sync', 'room', 'host', 'together'],
        run: () => startOrCopyWatchPartyAction(ui.setStatusMessage),
      },
      ...(hostingWatchParty
        ? [
            {
              id: 'end-watch-party',
              group: 'Share',
              label: 'End watch party',
              keywords: ['sync', 'room', 'leave', 'stop'],
              run: () => endWatchParty(ui.setStatusMessage),
            } satisfies CommandAction,
          ]
        : []),
      {
        id: 'perform-pin',
        group: 'Perform',
        label: 'Pin a parameter to the stage',
        keywords: ['perform', 'fader', 'control', 'surface'],
        run: () => openPerformPicker(),
      },
      {
        id: 'queue-add',
        group: 'Queue',
        label: 'Add this preset to the queue',
        keywords: ['cue', 'crate', 'next', 'setlist'],
        run: () => {
          const presetId = engineSnapshotRef.current?.activePresetId ?? null;
          if (!presetId) {
            uiRef.current.setStatusMessage('No preset to queue yet.');
            return;
          }
          uiRef.current.presetQueue.add(presetId);
          uiRef.current.setStatusMessage(
            'Queued. It shows in the cue monitor.',
          );
        },
      },
      {
        id: 'queue-take',
        group: 'Queue',
        label: 'Take the cued preset',
        keywords: ['cue', 'next', 'play'],
        run: () => {
          const presetId = uiRef.current.presetQueue.popNext();
          if (!presetId) {
            uiRef.current.setStatusMessage('Nothing is cued.');
            return;
          }
          uiRef.current.setRouteState((current) => ({ ...current, presetId }));
        },
      },
      {
        id: 'queue-skip',
        group: 'Queue',
        label: 'Skip the cued preset',
        keywords: ['cue', 'drop', 'pass'],
        run: () => {
          const next = uiRef.current.presetQueue.presetIds[0];
          if (!next) {
            uiRef.current.setStatusMessage('Nothing is cued.');
            return;
          }
          uiRef.current.presetQueue.remove(next);
        },
      },
      {
        id: 'queue-fade',
        group: 'Queue',
        label: 'Crossfade to the cued preset by hand',
        keywords: ['cue', 'fader', 'blend', 'mix'],
        run: () => {
          const next = uiRef.current.presetQueue.presetIds[0];
          if (!next) {
            uiRef.current.setStatusMessage('Nothing is cued.');
            return;
          }
          if (next === engineSnapshotRef.current?.activePresetId) {
            uiRef.current.setStatusMessage(
              'That preset is already on the stage.',
            );
            return;
          }
          uiRef.current.presetQueue.remove(next);
          engineBridgeRef.current.startManualCrossfade();
          uiRef.current.setRouteState((current) => ({
            ...current,
            presetId: next,
          }));
        },
      },
      {
        id: 'queue-clear',
        group: 'Queue',
        label: 'Clear the queue',
        keywords: ['cue', 'crate', 'empty'],
        run: () => {
          uiRef.current.presetQueue.clear();
          uiRef.current.setStatusMessage('Queue cleared.');
        },
      },
      {
        id: 'toggle-live-performance',
        group: 'Playback',
        label: 'Toggle live performance mode',
        keywords: ['vj', 'show', 'projector', 'gig', 'stage', 'perform'],
        run: () => {
          const live = toggleLivePerformanceMode();
          ui.setStatusMessage(
            live
              ? 'Live performance mode on — quality held steady, no battery frame cap, keeps drawing in an unfocused window.'
              : 'Live performance mode off — quality adapts again and background tabs pause.',
          );
        },
      },
      {
        id: 'toggle-autoplay',
        group: 'Playback',
        label: 'Toggle autoplay',
        keywords: ['shuffle', 'automatic'],
        run: () =>
          toggleAutoplay(
            engine,
            ui.setStatusMessage,
            engineSnapshotRef.current?.autoplay ?? false,
          ),
      },
      {
        id: 'transition-cut',
        group: 'Playback',
        label: 'Transition: instant cut',
        run: () => setTransition(engine, ui.setStatusMessage, 'cut', 0),
      },
      {
        id: 'transition-1s',
        group: 'Playback',
        label: 'Transition: 1s blend',
        run: () => setTransition(engine, ui.setStatusMessage, 'blend', 1),
      },
      {
        id: 'transition-2s',
        group: 'Playback',
        label: 'Transition: 2s blend',
        run: () => setTransition(engine, ui.setStatusMessage, 'blend', 2),
      },
      {
        id: 'transition-5s',
        group: 'Playback',
        label: 'Transition: 5s blend',
        run: () => setTransition(engine, ui.setStatusMessage, 'blend', 5),
      },
      {
        id: 'audio-demo',
        group: 'Audio',
        label: 'Play demo audio',
        keywords: ['source', 'sample'],
        run: () => startAudioSource(engine, 'demo'),
      },
      {
        id: 'audio-microphone',
        group: 'Audio',
        label: 'Use microphone audio',
        keywords: ['source', 'mic'],
        run: () => startAudioSource(engine, 'microphone'),
      },
      {
        id: 'audio-tab',
        group: 'Audio',
        label: "Use this tab's audio",
        keywords: ['source', 'capture'],
        run: () => startAudioSource(engine, 'tab'),
      },
      ...(liveMode
        ? [
            {
              id: 'stop-audio',
              group: 'Audio',
              label: 'Stop audio',
              run: () => engine.handleAudioStop(),
            } satisfies CommandAction,
          ]
        : []),
    ],
    [liveMode, isFullscreen, hostingWatchParty, themeChoice],
  );

  // Machine-readable state for automation: window.__stims_agent (snapshot,
  // status log, run-palette-action-by-id) plus a selector-waitable
  // data-engine-state attribute on <body>. Providers read refs, so this
  // installs exactly once.
  paletteActionsRef.current = paletteActions;
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;
  const engineReadyRef = useRef(engine.engineReady);
  engineReadyRef.current = engine.engineReady;
  const buildAgentCoreSnapshot = useCallback((): AgentCoreSnapshot => {
    const snap = engineSnapshotRef.current;
    const live = liveModeRef.current;
    const ready = engineReadyRef.current;
    return {
      engineState: live ? 'live' : ready ? 'ready' : 'booting',
      engineReady: ready,
      liveMode: live,
      backend: snap?.backend ?? null,
      panel: uiRef.current.routeState.panel ?? null,
      presetId: snap?.activePresetId ?? null,
      presetTitle: engineBridgeRef.current.selectedPreset?.title ?? null,
      audioSource: snap?.audioSource ?? null,
      audioEnergy: getAudioEnergy(),
      autoplay: snap?.autoplay ?? null,
      transition: {
        mode: snap?.transitionMode ?? null,
        blendDuration: snap?.blendDuration ?? null,
      },
      shaderExecution: snap?.shaderExecution ?? null,
    };
  }, []);

  useEffect(() => {
    return installAgentStateGlobal({
      getActions: () => paletteActionsRef.current,
      getSnapshot: buildAgentCoreSnapshot,
      getTelemetry: getAgentTelemetry,
      selectPreset: (presetId) =>
        engineBridgeRef.current.handlePresetSelection(presetId),
      setField: (key, value) =>
        engineBridgeRef.current.updateFieldLive(key, value),
      setCrossfade: (position) =>
        engineBridgeRef.current.setCrossfade(position),
      pinParameter: (field) => pinTarget(field),
      unpinParameter: (field) => unpinTarget(field),
      getStageCanvas: () =>
        uiRef.current.stageRef.current?.querySelector('canvas') ?? null,
    });
  }, [buildAgentCoreSnapshot]);

  useEffect(() => {
    document.body.dataset.engineState = liveMode
      ? 'live'
      : engine.engineReady
        ? 'ready'
        : 'booting';
  }, [liveMode, engine.engineReady]);

  // A hidden tab gets zero requestAnimationFrame callbacks — the browser
  // stops scheduling them, so nothing in the render path can report the
  // freeze from inside it. Catch the visibility edge here instead and leave
  // the explanation where the performer will read it the moment they switch
  // back to a stage that went black.
  useEffect(() => {
    const handleVisibility = () => {
      const risk = describeHiddenTabFreezeRisk();
      if (risk) {
        uiRef.current.setStatusMessage(risk);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Post-commit notification for run()/waitFor(): fires after React commits
  // any snapshot-relevant change, so a resolved waiter observes real state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listed deps are re-run triggers, not reads — the snapshot is read through refs
  useEffect(() => {
    emitAgentCommit(buildAgentCoreSnapshot());
  }, [
    buildAgentCoreSnapshot,
    engineSnapshot,
    liveMode,
    engine.engineReady,
    ui.routeState.panel,
  ]);

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
  // so it doesn't block the interactive shell on first paint. Installed once;
  // live values flow through refs.
  useEffect(() => {
    return deferToIdle(() => {
      return initAgentBridge({
        onLoadPreset: (payload) => {
          // milkSource is how an agent hands over preset *code* rather than a
          // catalog id (MCP's session_apply_source). The bridge has always
          // forwarded it and this handler always dropped it, so that tool
          // silently did nothing.
          if (payload.milkSource) {
            engineBridgeRef.current.updateEditorSource(payload.milkSource);
            return;
          }
          if (payload.presetId) {
            void engineBridgeRef.current.handlePlayPreset(payload.presetId);
          }
        },
        onApplyTweak: (_tweak) => {
          const activePresetId = engineSnapshotRef.current?.activePresetId;
          if (activePresetId) {
            void engineBridgeRef.current.handlePlayPreset(activePresetId);
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
          const state = engineBridgeRef.current.getEditorSessionState();
          return state ? toAgentEditorState(state) : null;
        },
        getEditorFields: () => {
          // The editor session's own latest compile, not the renderer's active
          // one. They diverge whenever rendering is paused (a hidden or headless
          // tab) or the newest source failed — and an agent reading values to
          // compute a delta needs the buffer it is actually editing.
          const compiled =
            engineBridgeRef.current.getEditorSessionState()?.latestCompiled ??
            engineBridgeRef.current.getActiveCompiledPreset();
          return compiled ? { ...compiled.ir.numericFields } : null;
        },
        applyEditorSource: async (source) => {
          const state =
            await engineBridgeRef.current.applyEditorSourceAwaited(source);
          return state ? toAgentEditorState(state) : null;
        },
        applyEditorFields: async (updates) => {
          const state =
            await engineBridgeRef.current.applyEditorFieldsAwaited(updates);
          return state ? toAgentEditorState(state) : null;
        },
      });
    });
  }, []);

  // The editor and refine panels are code-split, and the editor's first open
  // pays for the whole codemirror/compiler graph (the largest lazy dependency
  // chain in the app). Warm those chunks during idle after first paint so the
  // first E/G press doesn't stall on the download. Browse joins them for the
  // same reason: it's the single-letter 'B' shortcut and the app's primary
  // navigation surface (2000+ presets), so its first open is one of the most
  // likely early interactions — worth prefetching alongside the others
  // rather than paying its Suspense fallback cold.
  useEffect(() => {
    // Browse earns its prewarm everywhere and early: it's the app's primary
    // navigation surface, a likely first interaction on any device, and
    // small (~5KB gzipped) — cheap enough not to contend for bandwidth.
    return deferToIdle(() => {
      prefetchPanelChunk('browse');
    });
  }, []);

  // The editor chain is the heaviest prefetch in the app (CodeMirror alone is
  // ~125KB gzipped). Held back on two axes rather than one:
  //   - device: a desktop workflow, so coarse-pointer and data-saver sessions
  //     skip it entirely and pay the Suspense fallback on first E press.
  //   - time: waits for the runtime to actually be up, then for real idle.
  //     Measured on a production build, this chunk previously started ~88ms
  //     in — while the engine was still mounting — competing for bandwidth
  //     with the visuals the user is actually waiting on.
  const runtimeReadyForPrewarm = Boolean(engineSnapshot?.runtimeReady);
  useEffect(() => {
    if (!runtimeReadyForPrewarm) return;
    const saveData =
      (
        navigator as Navigator & {
          connection?: { saveData?: boolean };
        }
      ).connection?.saveData === true;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (!finePointer || saveData) return;
    return deferToIdle(
      () => {
        prefetchPanelChunk('editor');
        prefetchPanelChunk('refine');
      },
      { idleTimeout: 6000, fallbackDelay: 2000 },
    );
  }, [runtimeReadyForPrewarm]);

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

      // A gamepad drives parameters through the same binding/learn machinery
      // as a MIDI controller — it arrives as the `virtual:gamepad` device, so
      // the line above already handles it once it starts injecting.
      let stopGamepad: (() => void) | null = null;
      void import('../core/services/gamepad-performance-source.ts').then(
        (mod) => {
          if (!mod.isGamepadPerformanceSupported()) return;
          stopGamepad = mod.startGamepadPerformanceSource(webMidiService);
        },
      );

      return () => {
        uninstallLive();
        unbindMidi();
        stopGamepad?.();
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

  // A hint that has been acted on has nothing left to say, so it goes as soon
  // as the action lands rather than sitting out its timer. "Tap a card to play
  // it" outliving the card you just tapped is the clearest case: the advice is
  // now describing something you have already done.
  //
  // Driven by the panel reporting a real choice, not by watching which preset
  // is playing. That weaker signal moves on its own — the idle autoplay above
  // starts the featured preset on arrival, and on a mobile or low-power
  // `/discover/…` visit (no attract mode) it lands while the browse panel is
  // open and nothing has been tapped. Since showing a hint also marks it seen
  // for good, dismissing on that would have burned the guidance permanently,
  // for exactly the visitors who most need it.
  const dismissBrowseHint = useCallback(() => {
    if (visibleHintRef.current?.id === 'browse-open') dismissHint();
  }, [dismissHint]);

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
      if (getAudioEnergy() < QUIET_AUDIO_RMS_THRESHOLD) {
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
      if (readStored('stims:rotate-hint-dismissed') === 'true') {
        setShowRotateHint(false);
        return;
      }
      writeStored('stims:rotate-hint-dismissed', 'true');
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
    writeStored('stims:mobile-thumb-mode', String(enabled));
  }, []);

  const updateHapticsEnabled = useCallback((enabled: boolean) => {
    setHapticsEnabled(enabled);
    writeStored('stims:mobile-haptics', String(enabled));
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

  // Gated on the grid actually having cards in it, not merely on the panel
  // being routed to. "Tap a card to play it" fired the moment the route said
  // browse — which on a cold load, and on the /discover entry points, is
  // several seconds before the catalog lands. The hint marks itself seen the
  // first time it shows, so it was spent pointing at an empty sheet and never
  // appeared again once there was something to point at.
  useEffect(() => {
    if (ui.routeState.panel !== 'browse') return;
    if (!engine.catalogReady || engine.catalog.length === 0) return;
    showHint('browse-open');
  }, [
    ui.routeState.panel,
    engine.catalogReady,
    engine.catalog.length,
    showHint,
  ]);

  useEffect(() => {
    if (ui.routeState.panel === 'editor') {
      showHint('editor-open');
    }
  }, [ui.routeState.panel, showHint]);

  // Presets that read the interaction signals are the minority, and nothing
  // marked them: the stage keys and drag gestures did nothing on most of the
  // catalog, which reads as broken rather than as "this one doesn't listen".
  // So the layer is taught once, on the first preset that actually rewards
  // it — and never on top of another hint, since showing one marks it seen.
  useEffect(() => {
    if (!liveMode || visibleHint) return;
    if (!presetReadsInteractionSignals(engineSnapshot?.currentSource ?? '')) {
      return;
    }
    showHint('interactive-preset');
  }, [liveMode, visibleHint, engineSnapshot?.currentSource, showHint]);

  // NOTE: temporal-memory frame recording was removed here deliberately.
  // It sampled the live stage canvas (2D drawImage + getImageData) on every
  // preset switch; reading back a WebGPU canvas that way stalled the main
  // thread 8-10 seconds per switch on mobile (measured on a Galaxy S22),
  // and nothing consumed the recorded stats. If a consumer ever needs frame
  // stats, capture them on demand, never on the switch path.

  useEffect(() => {
    // Same pairing rule as the last-session save below: id and title must
    // come off one compiled preset, or history entries name the wrong thing.
    const activeCompiled = engineSnapshot?.sessionState?.activeCompiled;
    const presetId = activeCompiled?.source.id;
    const title = activeCompiled?.title;
    if (!presetId || !title) return;
    setSessionHistory((current) => {
      if (current[0]?.presetId === presetId) return current;
      return [{ presetId, title, at: Date.now() }, ...current].slice(0, 50);
    });
  }, [engineSnapshot?.sessionState?.activeCompiled]);

  useEffect(() => {
    // Both fields come off the SAME compiled preset — the one actually on
    // screen — so the stored pair can never mix one preset's id with
    // another's name. Reading the id from the engine snapshot and the title
    // from `engine.selectedPreset` (which is route-derived) used to persist
    // exactly that mismatch whenever the route and the engine were briefly
    // out of step, and the "Welcome back" card then named the wrong preset.
    const activeCompiled = engineSnapshot?.sessionState?.activeCompiled;
    const presetId = activeCompiled?.source.id;
    const presetTitle = activeCompiled?.title;
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
    engineSnapshot?.sessionState?.activeCompiled,
    engineSnapshot?.audioActive,
    currentAudioSource,
  ]);

  // Eager match on source start: sampling once at t=0 almost always reads
  // silence (the stream hasn't produced audio yet), so poll until the signal
  // is audible, then run one vector search and offer the top match. One
  // search per source start keeps the Vectorize endpoint cold-path cheap.
  //
  // Front-loaded schedule, not a flat interval: most sources go audible
  // within a second or two (silence past that point means something's
  // actually wrong, not "still warming up"), so polling fast early catches
  // the common case quickly while a flat 2000ms×8 schedule made every
  // listener wait up to 16s even when the signal was ready in 1s. Total
  // worst case is ~8.4s, matching AUDIO_MATCH_QUIET_RMS below (the same
  // "is there real audio" cutoff the quiet-audio coaching nudge uses, so
  // the two features agree on what counts as silence).
  const AUDIO_MATCH_RETRY_SCHEDULE_MS = [400, 400, 800, 800, 1200, 1600, 2000];
  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore snapshot sub-properties
  useEffect(() => {
    if (!engineSnapshot?.audioActive) {
      setAudioMatch(null);
      return;
    }
    const controller = new AbortController();
    let attempts = 0;
    let retryTimer: number | null = null;

    const tryMatch = () => {
      if (controller.signal.aborted) return;
      const audioEnergy = engineSnapshotRef.current?.audioEnergy;
      const profile = buildAudioProfile({ audioEnergy });
      if (profile.rms < QUIET_AUDIO_RMS_THRESHOLD) {
        if (attempts < AUDIO_MATCH_RETRY_SCHEDULE_MS.length) {
          retryTimer = window.setTimeout(
            tryMatch,
            AUDIO_MATCH_RETRY_SCHEDULE_MS[attempts],
          );
        }
        attempts += 1;
        return;
      }
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
    };

    tryMatch();

    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [engineSnapshot?.audioActive, engineSnapshot?.audioSource]);

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

  // Paints the stored choice and keeps painting it: preference changes from
  // Settings or the palette, and — when the choice is "system" — OS theme
  // flips, without a reload.
  useEffect(() => startThemeSync(), []);

  useEffect(() => {
    applyAccessibility(getActiveAccessibilityPreference());
  }, []);

  // Uncommitted editor edits live only in the session — there is no draft
  // persistence — so a reload or a closed tab loses them outright. The
  // session has tracked a `dirty` flag all along and nothing read it; this
  // is the one place where losing work is silent and irreversible.
  // Deliberately scoped to the editor being dirty: a beforeunload prompt on
  // an idle visualizer would be pure nuisance.
  const editorDirty = engineSnapshot?.sessionState?.dirty ?? false;
  useEffect(() => {
    if (!editorDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers show their own copy and ignore any string we return; the
      // assignment is only here because older engines still gate on it.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editorDirty]);

  useEffect(() => {
    reportLoadStatus('shell-rendered');
    dismissLoadingScreen();
  }, []);

  const stageAnchoredToolOpen = ui.routeState.panel === 'editor';
  // Browse virtualizes its preset list (BrowseSheetPanel), which needs a
  // dedicated, bounded-height scroll container rather than the sheet's
  // normal whole-body scroll — the same "manages its own scrolling" shape
  // the editor already opts into via fillBody, just without editor's
  // additional stage-anchored placement.
  const sidePanelFillBody =
    stageAnchoredToolOpen || ui.routeState.panel === 'browse';

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
      {/* The launch screen's visible h1 unmounts once the visualizer goes
          live; keep a screen-reader heading so the document always has one. */}
      {liveMode ? (
        <h1 className="stims-shell__sr-only">Stims visualizer</h1>
      ) : null}
      <WorkspaceStagePanel
        isFullscreen={isFullscreen}
        launchPanel={
          <Suspense fallback={<PanelLoadingFallback />}>
            <NewHomePage />
          </Suspense>
        }
        liveMode={liveMode}
        onToggleFullscreen={handleToggleFullscreen}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {ui.routeState.previewMode ? (
        <a
          className="stims-shell__embed-brand"
          data-embed-brand-link
          href="https://toil.fyi/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Stims in a new tab"
        >
          Stims ↗
        </a>
      ) : null}

      <SidePanel
        open={ui.routeState.panel !== null}
        onClose={() => ui.updatePanel(null)}
        title={getToolLabel(ui.routeState.panel ?? 'browse')}
        stageAnchored={stageAnchoredToolOpen}
        fillBody={sidePanelFillBody}
        onOpen={handleSidePanelOpen}
      >
        {/* Panel-anchored hints render inside the panel they describe, not in
            the stage's toast slot on the far side of the screen. */}
        <ContextualHelp hint={visibleHint} anchor="panel" />
        <Suspense
          fallback={<PanelLoadingFallback panel={ui.routeState.panel} />}
        >
          {ui.routeState.panel === 'editor' ? <EditorPanel /> : null}
          {ui.routeState.panel === 'capture' ? <CapturePanel /> : null}
          {ui.routeState.panel === 'browse' ? (
            <BrowseSheetPanel
              offline={offline}
              onPresetChosen={dismissBrowseHint}
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
          {/* One panel, one route state. The seed it opens on is derived from
              whether there is audio to profile — the panel itself still has
              the last word (a remembered mode wins, and 'sound' falls back to
              'look' when nothing is audible). */}
          {ui.routeState.panel === 'finder' ? (
            <PresetFinderPanel
              initialMode={engineSnapshot?.audioActive ? 'sound' : 'look'}
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

      {/* Both bottom-centre notifications share one anchor so they stack
          instead of overlapping. The stack is column-reverse, so the
          actionable audio match sits below the passive hint — nearest the
          controls, and never covered by it.
          Rendered regardless of open panels: the browse/editor hints fire
          exactly when those panels open, so unmounting on panel-open made
          them unreachable. */}
      <div className="stims-shell__toast-stack">
        <SilentAudioNotice active={liveMode} />
        <ContextualHelp hint={visibleHint} anchor="stage" />
        <AudioMatchToast
          match={audioMatch}
          onSelect={engine.handlePresetSelection}
          onDismiss={() => setAudioMatch(null)}
        />
      </div>

      <SyncSessionBridge />
      <LiveParameterHud />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        presets={engine.filteredCatalog.map((entry) => ({
          id: entry.id,
          title: entry.title,
          author: entry.author,
        }))}
        onSelectPreset={engine.handlePresetSelection}
      />
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
