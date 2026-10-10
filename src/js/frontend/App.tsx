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
import { describeHiddenTabFreezeRisk } from '../core/live-performance-mode.ts';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  buildAudioProfile,
  pickAudioMatch,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { setCrashTelemetryPreset } from '../core/services/crash-telemetry.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { setTelemetryAudioSource } from '../core/services/telemetry-context.ts';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../core/services/webmidi-controller.ts';
import { saveLastSession } from '../core/state/last-session-store.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  getActiveThemePreference,
  startThemeSync,
  subscribeToThemePreference,
  type ThemeChoice,
} from '../core/theme-preferences.ts';
import { parseURLParams } from '../core/url-params.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import { scheduleIdleTask } from '../utils/browser/idle-task.ts';
import { AudioMatchToast } from './AudioMatchToast.tsx';
import { initAgentBridge, updateAgentTelemetry } from './agent-bridge.ts';
import { buildAgentBridgeCallbacks } from './agent-bridge-handlers.ts';
import { emitAgentCommit } from './agent-state.ts';
import {
  CollectionPageDetails,
  useCollectionPageContent,
} from './CollectionPageDetails.tsx';
import { CommandPalette, useCommandPaletteHotkey } from './CommandPalette.tsx';
import { ContextualHelp, useHelpHints } from './ContextualHelp.tsx';
import { CreditsDialog } from './CreditsDialog.tsx';
import type { CommandAction } from './command-palette-registry.ts';
import { StimsErrorBoundary } from './ErrorBoundary.tsx';
import {
  getAudioBands,
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { HudOverlay } from './HudOverlay.tsx';
import { useAgentStateInstall } from './hooks/use-agent-state-install.ts';
import { useMediaSession } from './hooks/use-media-session.ts';
import {
  useFileHandlerLaunch,
  useSharedLaunch,
} from './hooks/use-shared-launch.ts';
import { useAgentFrameRate } from './hooks/useAgentFrameRate';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { useFullscreen } from './hooks/useFullscreen';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStageGesture } from './hooks/useStageGesture';
import { LiveParameterHud } from './LiveParameterHud.tsx';
import { installLivePerformance } from './live-performance.ts';
import { reportLoadStatus } from './load-status.ts';
import { dismissLoadingScreen } from './loading-screen.ts';
import {
  PresetPageDetails,
  usePresetPageContent,
} from './PresetPageDetails.tsx';
import { TITLE_CARD_EXIT_MS, TITLE_CARD_HOLD_MS } from './PresetTitleCard.tsx';
import { buildPaletteActions } from './palette-actions.ts';
import { prefetchPanelChunk } from './panel-chunks.ts';
import { watchPerformanceHardware } from './performance-hardware-connect.ts';
import {
  SilentAudioNotice,
  useAudioAwaitingGesture,
} from './SilentAudioNotice.tsx';
import { SiteIndexFooter } from './SiteIndexFooter.tsx';

const NewHomePage = lazy(() =>
  import('./NewHomePage.tsx').then((m) => ({
    default: m.NewHomePage,
  })),
);

import { readStored, writeStored } from '../core/state/browser-storage.ts';
import {
  bindMidiToMilkdropControls,
  createHardwareCrossfader,
  createPerformanceControlApplier,
  learnRangeFor,
} from './performance-hardware-controls.ts';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { SyncSessionBridge } from './SyncSessionBridge.tsx';
import { getSyncSessionState, subscribeSyncSession } from './sync-session.ts';
import {
  buildRemixShareUrl,
  decodePresetCodeFromHash,
  REMIX_URL_FAILED,
} from './url-state.ts';
import { connectWakeLock } from './wake-lock.ts';
import { startQueuedCrossfade } from './workspace-actions.ts';
import {
  useEngineSnapshot,
  useWorkspace,
  WorkspaceProvider,
} from './workspace-context.tsx';
import { findActivePresetEntry, getToolLabel } from './workspace-helpers.ts';
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
const EditorSurface = lazy(() =>
  import('./EditorSurface.tsx').then((m) => ({ default: m.EditorSurface })),
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

// When a source starts, the stage introduces itself: the preset's title
// card, then the first-play hint. These are the earliest moments the next
// notice may take the screen, so nothing piles onto that introduction.
const FIRST_PLAY_HINT_DELAY_MS = TITLE_CARD_HOLD_MS + TITLE_CARD_EXIT_MS;
const AUDIO_MATCH_EARLIEST_MS = 12_000;

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
  // Same latest-value pattern for the engine handlers: the palette action
  // list below is memoized on the few inputs that change a row's label or
  // presence, so anything it calls must be read at run time. Capturing
  // `engine`/`ui` in the memo froze `handleShufflePreset` with an empty
  // catalog and `handleShowCurrentLink` with the boot-time route, so the
  // palette, the agent API and every shortcut bound to a palette id did
  // nothing (or shared the wrong URL) until an unrelated dep refreshed it.
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const { engineSnapshot } = useEngineSnapshot();
  const awaitingAudioGesture = useAudioAwaitingGesture();
  const growthLandingEventsRef = useRef<Set<string>>(new Set());
  const audioStartedReportedRef = useRef(false);

  useEffect(() => {
    const route = ui.routeState;
    // Once per page load, carrying the preset a deep link named: the
    // denominator for every later step, split by where visitors came from
    // (the `arrival` context field).
    if (!growthLandingEventsRef.current.has('landing')) {
      growthLandingEventsRef.current.add('landing');
      noteGrowthEvent('landing', route.presetId ?? undefined);
    }
    if (route.previewMode && !growthLandingEventsRef.current.has('embed')) {
      growthLandingEventsRef.current.add('embed');
      noteGrowthEvent('embed-landing');
    }
    if (route.discovery && !growthLandingEventsRef.current.has('discovery')) {
      growthLandingEventsRef.current.add('discovery');
      noteGrowthEvent('discovery-landing');
    }
  }, [ui.routeState]);

  // Declared before the audio-started beacon so that event carries its own
  // source.
  useEffect(() => {
    setTelemetryAudioSource(
      engineSnapshot?.audioActive
        ? (engineSnapshot.audioSource ?? ui.routeState.audioSource)
        : null,
    );
  }, [
    engineSnapshot?.audioActive,
    engineSnapshot?.audioSource,
    ui.routeState.audioSource,
  ]);

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
    score: number;
  } | null>(null);
  // The match usually lands while only the 20 KB starter catalog is loaded,
  // so the title is resolved at render time against whatever catalog is
  // current: the toast re-labels itself when the full catalog arrives
  // instead of freezing the raw id it was born with.
  // Split like every other title surface: a raw catalog title is the whole
  // credit chain ("suksma - fiShbRaiN - white sceam firefly - …"), and as a
  // one-line suggestion it ran to two lines on a desktop and nine on a phone.
  const audioMatchWithName = useMemo(() => {
    if (!audioMatch) return null;
    const preset = engine.catalog.find((e) => e.id === audioMatch.presetId);
    const display = preset
      ? splitPresetDisplay(preset.title, preset.author)
      : { title: audioMatch.presetId.replace(/-/g, ' '), byline: null };
    return {
      ...audioMatch,
      name: display.title,
      byline: display.byline,
    };
  }, [audioMatch, engine.catalog]);
  const catalogRef = useRef(engine.catalog);
  catalogRef.current = engine.catalog;
  const [thumbMode, setThumbMode] = useState(() => {
    const stored = readStored('stims:mobile-thumb-mode');
    return stored !== null ? stored === 'true' : prefersThumbModeByDefault();
  });
  const [hapticsEnabled, setHapticsEnabled] = useState(
    () => readStored('stims:mobile-haptics') !== 'false',
  );
  const [offline, setOffline] = useState(() =>
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [showRotateHint, setShowRotateHint] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<
    Array<{ presetId: string; title: string; at: number }>
  >([]);

  const liveMode = engine.audioActive;
  // The playing preset's page: its name is the document's h1 and the section
  // under the stage. Embeds are chromeless and get neither. Keyed on the
  // selection, which is what the URL names, rather than on what the engine
  // has on stage: a ?preset= arrival goes live while the attract preset is
  // still rendering, and keying on the engine named that preset in the h1 of
  // another preset's page until the requested one compiled. The two differ
  // only for that moment; autoplay moves the route with the engine
  // (engine-route-publish.ts).
  const presetPage = usePresetPageContent(
    engine.catalog,
    liveMode && !ui.routeState.previewMode
      ? (engine.selectedPreset?.id ?? null)
      : null,
  );
  // A hub page's list, until a preset page takes the space under the stage.
  const collectionPage = useCollectionPageContent(
    engine.catalog,
    presetPage || ui.routeState.previewMode
      ? null
      : (ui.routeState.discovery ?? null),
  );
  const currentAudioSource =
    engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  // What the OS is told is playing. Same three-source lookup the save-current
  // gesture uses, because autoplay moves the stage without moving the
  // selection and only the catalog knows what is actually up.
  const activePresetEntry = useMemo(
    () => findActivePresetEntry(engineSnapshot?.activePresetId, engine),
    [engineSnapshot?.activePresetId, engine],
  );
  const quietAtRef = useRef<number | null>(null);
  const quietDemoSuggestedRef = useRef(false);
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

  // Crash rows are attributed to the preset on screen; without this the
  // telemetry dataset could say a shader failed to compile but not on which
  // preset.
  useEffect(() => {
    setCrashTelemetryPreset(engineSnapshot?.activePresetId ?? null);
  }, [engineSnapshot?.activePresetId]);

  // Shared between the touch long-press gesture and the "L" keyboard
  // shortcut — one definition of "favorite whatever's currently playing"
  // rather than two copies that could drift.
  const toggleFavoriteCurrentPreset = () => {
    const activePresetId = engineSnapshot?.activePresetId;
    if (!activePresetId) {
      ui.setStatusMessage('Load a preset before saving it.');
      return;
    }
    const activePreset = findActivePresetEntry(activePresetId, engine);
    void engine.toggleFavoritePreset(activePresetId, !activePreset?.isFavorite);
    ui.setStatusMessage(
      activePreset?.isFavorite
        ? 'Removed from saved presets.'
        : 'Saved on this device.',
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
    updatePanel: ui.updatePanel,
    handlePresetSelection: engine.handlePresetSelection,
    handleShufflePreset: engine.handleShufflePreset,
    handlePreviousPreset: engine.handlePreviousPreset,
    handleTogglePlayback: engine.handleTogglePlayback,
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

  // Read here rather than at its use site further down, because the share
  // action's label depends on it: a link copied mid-edit carries the draft,
  // and the row is the only place that fact is ever stated.
  const editorDirty = engineSnapshot?.sessionState?.dirty ?? false;
  const playbackPaused = engineSnapshot?.playbackPaused ?? false;

  // Behavior bodies live in workspace-actions.ts, shared with the stage
  // dock menu — a verb must not do different things depending on which
  // surface invoked it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers are read through uiRef/engineRef when a row runs; the list only needs to rebuild when a label or the row set changes (live/fullscreen/hosting/theme/editor state)
  const paletteActions: CommandAction[] = useMemo(
    () =>
      buildPaletteActions({
        engineRef,
        engineBridgeRef,
        engineSnapshotRef,
        uiRef,
        paletteSurface,
        handleToggleFullscreen,
        setShowShortcuts,
        toggleFavoriteCurrentPreset,
        liveMode,
        isFullscreen,
        hostingWatchParty,
        themeChoice,
        editorDirty,
        playbackPaused,
      }),
    [
      liveMode,
      isFullscreen,
      hostingWatchParty,
      themeChoice,
      editorDirty,
      playbackPaused,
    ],
  );

  // Machine-readable state for automation: window.__stims_agent (snapshot,
  // status log, run-palette-action-by-id) plus a selector-waitable
  // data-engine-state attribute on <body>. Providers read refs, so this
  // installs exactly once.
  paletteActionsRef.current = paletteActions;
  const buildAgentCoreSnapshot = useAgentStateInstall({
    paletteActionsRef,
    engineSnapshotRef,
    engineBridgeRef,
    uiRef,
    liveMode,
    engineReady: engine.engineReady,
  });

  // A track or link shared into the installed app from another app. Runs
  // once on arrival; see the hook for why a shared link re-enters through
  // the app's own deep link rather than a second start path.
  useSharedLaunch({
    routeState: ui.routeState,
    commitRoute: ui.commitRoute,
    startAudioSource: engine.startAudioSource,
    setStatusMessage: ui.setStatusMessage,
  });

  // A `.milk` opened from the OS. Routed through the same import the panel's
  // own button uses, so it lands in the editor with the same error handling.
  useFileHandlerLaunch(
    (files) => ui.handleImport(files),
    (message) => ui.setStatusMessage(message),
  );

  // Tell the OS what is on the stage: lock-screen artwork and title, and
  // hardware media keys that move through presets. See the hook for why the
  // preset — not a track — is what next/previous move through here.
  useMediaSession({
    active: liveMode,
    paused: playbackPaused,
    presetId: engineSnapshot?.activePresetId ?? null,
    presetTitle: activePresetEntry?.title ?? null,
    presetAuthor: activePresetEntry?.author ?? null,
    onTogglePlayback: () => engine.handleTogglePlayback(),
    onNextPreset: () => void engine.handleShufflePreset(),
    onPreviousPreset: () => void engine.handlePreviousPreset(),
    onStop: () => engine.handleAudioStop(),
  });

  // Going live unmounts the launch page, and with it the button that was
  // pressed to get here. Whatever is focused inside a removed subtree falls
  // to `<body>`, which for a keyboard user means their place in the page is
  // gone: the next Tab starts over at the skip link instead of continuing
  // into the transport dock, and a screen reader is left on nothing while
  // the stage it just asked for comes up behind it.
  //
  // The stage is the honest landing spot — it is what was just launched, it
  // carries the stage's accessible name, and it sits immediately before the
  // dock in DOM order, so one more Tab reaches the controls.
  const wasLiveRef = useRef(liveMode);
  useEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = liveMode;
    if (!liveMode || wasLive) return;
    // Only rescue focus that was actually orphaned. Someone who has already
    // tabbed on (or opened a panel from a shortcut while audio started) is
    // interacting somewhere on purpose, and must not be yanked to the stage.
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== document.documentElement
    ) {
      return;
    }
    ui.stageRef.current?.focus();
  }, [liveMode, ui.stageRef]);

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
    // The drag itself is the moment to say what dragging does. Not stacked
    // on another hint: showing one marks it seen, so the loser would be
    // burned silently.
    onFirstDrag: () => {
      if (!visibleHintRef.current) showHint('interactive-preset');
    },
  });

  // Agent bridge is only needed for MCP/automation sessions; defer to idle
  // so it doesn't block the interactive shell on first paint. Installed once;
  // live values flow through refs.
  useEffect(() => {
    return deferToIdle(() => {
      return initAgentBridge(
        buildAgentBridgeCallbacks({
          engineRef: engineBridgeRef,
          engineSnapshotRef,
        }),
      );
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

      const crossfader = createHardwareCrossfader({
        getPosition: () => engine.getCrossfade(),
        setPosition: (position) => engine.setCrossfade(position),
        startQueued: () =>
          startQueuedCrossfade({
            queue: uiRef.current.presetQueue,
            startManualCrossfade: () => engine.startManualCrossfade(),
            setRouteState: uiRef.current.setRouteState,
            activePresetId: engineSnapshotRef.current?.activePresetId ?? null,
          }),
        announce: (message) => uiRef.current.setStatusMessage(message),
      });
      const controls = createPerformanceControlApplier({
        setFieldLive: (target, value) => engine.updateFieldLive(target, value),
        commitField: (target, value) =>
          engine.updateInspectorField(target, value),
        crossfade: (position) => crossfader.move(position),
      });
      webMidiService.setLearnRangeResolver(learnRangeFor);
      const unbindMidi = bindMidiToMilkdropControls(
        webMidiService,
        controls.apply,
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

      // Neither of the two lines above used to say anything, so the only way
      // to find out a controller was live was to move one and watch.
      const stopHardwareWatch = watchPerformanceHardware({
        midi: webMidiService,
        announce: (message) => uiRef.current.setStatusMessage(message),
      });

      return () => {
        uninstallLive();
        unbindMidi();
        controls.dispose();
        webMidiService.setLearnRangeResolver(null);
        stopGamepad?.();
        stopHardwareWatch();
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
    //
    // Waits for the catalog: only then is it known whether the link's preset
    // exists here. When it does not — a preset the sender made or imported —
    // the code is imported as a preset of its own. Applied to whatever loaded
    // instead (the featured preset, after the missing id healed to it), it
    // would have been saved as that preset's draft.
    if (!pendingCode || !engine.engineReady || !engine.catalogReady) return;
    if (engine.missingRequestedPreset) {
      const name = ui.routeState.presetId ?? 'shared-preset';
      setPendingCode(null);
      void engine.importPresetFiles([
        new File([pendingCode], `${name}.milk`, { type: 'text/plain' }),
      ]);
      return;
    }
    if (engineSnapshot?.currentSource === pendingCode) {
      setPendingCode(null);
      return;
    }
    engine.updateEditorSource(pendingCode);
  }, [
    pendingCode,
    engine.engineReady,
    engine.catalogReady,
    engine.missingRequestedPreset,
    engineSnapshot?.currentSource,
    engine,
    ui.routeState.presetId,
  ]);

  useEffect(() => {
    if (ui.toast && !ui.toast.quiet && visibleHint) {
      dismissHint();
    }
  }, [ui.toast, visibleHint, dismissHint]);

  // A hint that has been acted on has nothing left to say, so it goes as soon
  // as the action lands rather than sitting out its timer. "Tap a card to play
  // it" outliving the card you just tapped is the clearest case: the advice is
  // now describing something you have already done.
  //
  // Driven by the panel reporting a real choice, not by watching which preset
  // is playing. That weaker signal moves on its own: the engine's autoplay
  // can advance the preset while the browse panel is open and nothing has
  // been tapped. Since showing a hint also marks it seen for good, dismissing
  // on that would have burned the guidance permanently, for exactly the
  // visitors who most need it.
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

  const audioLiveSinceRef = useRef<number | null>(null);
  useEffect(() => {
    // Deferred, not skipped: re-running once showRotateHint or the "click
    // to turn the sound on" notice clears (both are dependencies) lets them
    // land one after another instead of stacking over the stage. The sound
    // notice goes first because nothing reacts until it is answered.
    //
    // Also deferred past the preset's title card: shown at once, the hint
    // and the card arrived in the same instant at opposite ends of the
    // screen, on top of a stage the visitor had pressed Play to watch. The
    // wait counts from when the audio started, which is when the card
    // appeared — counted from a later re-run (the rotate notice clearing on
    // a phone) it only added dead air after a card that was long gone.
    if (!liveMode || !engineSnapshot?.audioActive) {
      audioLiveSinceRef.current = null;
      return;
    }
    audioLiveSinceRef.current ??= performance.now();
    if (showRotateHint || awaitingAudioGesture) return;
    const timer = window.setTimeout(
      () => showHint('first-play'),
      Math.max(
        0,
        audioLiveSinceRef.current +
          FIRST_PLAY_HINT_DELAY_MS -
          performance.now(),
      ),
    );
    return () => window.clearTimeout(timer);
  }, [
    liveMode,
    engineSnapshot?.audioActive,
    showRotateHint,
    awaitingAudioGesture,
    showHint,
  ]);

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

  // Said at the first keystroke, because that is the moment the claim becomes
  // checkable: there is now a draft, and the URL already holds it. Guarded on
  // `visibleHint` like the interaction hint — showing one marks it seen, so
  // stacking would silently burn whichever lost.
  useEffect(() => {
    if (!editorDirty || visibleHint) return;
    if (ui.routeState.panel !== 'editor') return;
    showHint('editor-dirty-link');
  }, [editorDirty, visibleHint, ui.routeState.panel, showHint]);

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
    // Not for demo audio: "suggested for this audio" about the app's own
    // synth loop says nothing about the visitor's music, and on a first
    // visit it offered a different preset two seconds into the one they had
    // just been shown.
    if (!engineSnapshot?.audioActive || engineSnapshot.audioSource === 'demo') {
      setAudioMatch(null);
      return;
    }
    const controller = new AbortController();
    const startedAt = performance.now();
    let attempts = 0;
    let retryTimer: number | null = null;
    let revealTimer: number | null = null;

    const tryMatch = () => {
      if (controller.signal.aborted) return;
      const audioEnergy = engineSnapshotRef.current?.audioEnergy;
      // Real bands, not the fabricated 0.6/0.3/0.1 split of a lone scalar:
      // the store carries the engine's per-frame balance, and without it a
      // bassy track and a bright one at equal loudness matched identically.
      const bands = getAudioBands();
      const profile = buildAudioProfile({
        audioEnergy,
        fftBands: [bands.bass, bands.mid, bands.treble],
      });
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
        const match = pickAudioMatch(
          results,
          (presetId) =>
            catalogRef.current.find((entry) => entry.id === presetId)
              ?.curatedRank,
        );
        if (!match) return;
        // The search is eager so the answer is ready; the offer waits until
        // the opening title card and first hint have had the screen.
        revealTimer = window.setTimeout(
          () => setAudioMatch({ presetId: match.presetId, score: match.score }),
          Math.max(0, startedAt + AUDIO_MATCH_EARLIEST_MS - performance.now()),
        );
      });
    };

    tryMatch();

    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (revealTimer !== null) window.clearTimeout(revealTimer);
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

  // The address bar and the in-app Share button are the same surface (both
  // read window.location), so a copied URL reproduces a session only if the
  // URL carries what changed. Write the live-edited source into a #code=
  // hash while the editor session is dirty and drop it once a preset load
  // or the revert action marks the session clean. replaceState, never push:
  // history-entry ownership belongs to the route-sync effect (workspace-hooks),
  // and a keystroke must not add an entry.
  const sessionSource = engineSnapshot?.currentSource ?? '';
  const remixUrlFailure = useRef<string | null>(null);
  useEffect(() => {
    if (!engine.engineReady) return;
    try {
      const nextHref = buildRemixShareUrl(
        window.location.href,
        editorDirty ? sessionSource : null,
      );
      if (nextHref !== window.location.href) {
        window.history.replaceState(window.history.state, '', nextHref);
      }
      remixUrlFailure.current = null;
    } catch (error) {
      // A previous draft in the address bar must not masquerade as this edit.
      try {
        const cleanHref = buildRemixShareUrl(window.location.href, null);
        window.history.replaceState(window.history.state, '', cleanHref);
      } catch {
        // History can also be unavailable; keep the editor working.
      }
      const message = error instanceof Error ? error.message : REMIX_URL_FAILED;
      if (remixUrlFailure.current !== message) {
        uiRef.current.setStatusMessage(message);
        remixUrlFailure.current = message;
      }
    }
  }, [engine.engineReady, editorDirty, sessionSource]);

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
      data-has-toast={ui.toast && !ui.toast.quiet ? 'true' : undefined}
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
      {/* One h1 per state. The launch title is the heading until the
          visualizer goes live (NewHomePage demotes it then); live, the
          playing preset's name below the stage takes over. The screen-reader
          heading covers a live session with no catalog preset to name, and
          embeds. */}
      {liveMode && !presetPage ? (
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
      {presetPage ? (
        <PresetPageDetails
          content={presetPage}
          onSelectPreset={engine.handlePresetSelection}
        />
      ) : collectionPage && collectionPage.count > 0 ? (
        <CollectionPageDetails
          content={collectionPage}
          onSelectPreset={engine.handlePresetSelection}
        />
      ) : null}
      {/* On the dark ground the shell paints in every theme, as the details
          above are. Embeds are chromeless and get none. */}
      {ui.routeState.previewMode ? null : <SiteIndexFooter />}

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
        wide={ui.routeState.panel === 'browse'}
        onOpen={handleSidePanelOpen}
      >
        {/* Panel-anchored hints render inside the panel they describe, not in
            the stage's toast slot on the far side of the screen. */}
        <ContextualHelp hint={visibleHint} anchor="panel" />
        <Suspense
          fallback={<PanelLoadingFallback panel={ui.routeState.panel} />}
        >
          {ui.routeState.panel === 'editor' ? <EditorSurface /> : null}
          {ui.routeState.panel === 'capture' ? <CapturePanel /> : null}
          {ui.routeState.panel === 'browse' ? (
            <BrowseSheetPanel
              onPresetChosen={dismissBrowseHint}
              sessionHistory={sessionHistory}
              onCollectionTagChange={(collectionTag) =>
                ui.commitRoute((current) => ({ ...current, collectionTag }))
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
        {/* One notice at a time: the match waits while a stage hint is up
            (its dismiss clock waits with it). */}
        <AudioMatchToast
          match={visibleHint?.anchor === 'stage' ? null : audioMatchWithName}
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
