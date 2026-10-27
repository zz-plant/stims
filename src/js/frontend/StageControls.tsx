/**
 * Stage Controls Overlay Component — renders the floating on-stage navigation bar, playback toggles,
 * PiP controls, audio volume meters, preset transition progress, and overlay dialog triggers.
 */

import { describeShaderApproximation } from 'milkdrop-toolchain/src/shader-execution-mode.ts';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from '../../css/StageControls.module.css';
import {
  getActiveAccessibilityPreference,
  subscribeToAccessibilityPreference,
} from '../core/accessibility-preferences.ts';
import {
  isPresetLocked,
  subscribePresetLock,
  togglePresetLock,
} from '../core/preset-lock.ts';
import { noteActionUse } from '../core/services/action-telemetry.ts';
import {
  getExternalDisplayState,
  hasMultipleScreens,
  subscribeExternalDisplay,
} from '../core/services/external-display-service.ts';
import {
  getProjectorState,
  subscribeProjector,
} from '../core/services/projector-window-service.ts';
import {
  isRecordingActive,
  subscribeRecordingActive,
} from '../core/services/recording-state.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import { DEFAULT_BLEND_DURATION_SECONDS } from '../milkdrop/runtime/first-run-preset.ts';
import type { UiIconName } from '../ui/icon-library.ts';
import { AudioStatusControl } from './AudioStatusControl.tsx';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { pulseHaptic } from './haptics.ts';
import {
  useBottomOverlaySignal,
  useEscapeHandler,
} from './hooks/use-escape-handler.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { useAutoHideActivity } from './hooks/useAutoHideActivity.ts';
import { usePictureInPicture } from './hooks/usePictureInPicture.ts';
import { usePresetTransition } from './hooks/usePresetTransition.ts';
import { prefetchMenuPanelChunks } from './panel-chunks.ts';
import { getPanelTitle } from './panel-registry.ts';
import { openPerformPicker } from './perform-pins.ts';
import {
  ariaKeyShortcutsFor,
  readShortcutOverrides,
  type ShortcutOverrides,
  shortcutHintFor,
  subscribeShortcutOverrides,
} from './shortcut-registry.ts';
import { getSyncSessionState, subscribeSyncSession } from './sync-session.ts';
import { UiIcon } from './UiIcon.tsx';
import {
  cameraMenuLabel,
  castMenuLabel,
  endWatchParty,
  isCameraInputOn,
  nearbyPresetRequest,
  openRecordPanel,
  panelToggleLabel,
  playbackToggleLabel,
  playNearbyPreset,
  presentToExternalDisplayAction,
  projectorMenuLabel,
  recordMenuLabel,
  refreshCameraInput,
  SOUND_KEEPS_PLAYING,
  setTransition,
  soundStopsOnPause,
  startAudioSource,
  startOrCopyWatchPartyAction,
  subscribeCameraInput,
  toggleCameraAction,
  togglePanel,
  toggleProjectorAction,
  toggleReduceFlashingAction,
} from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type MenuItem = {
  icon: UiIconName;
  label: string;
  // The bare action. The menu wraps it in `run` (close, then refocus the
  // trigger) at the button, so these lists hold no function that reads a
  // ref: React Compiler skips a component that passes one through a call
  // during render, and these lists go through `.map` there.
  action: () => void;
  active?: boolean;
  // Short group header rendered above the item. Separators between groups
  // are placed by the column layout, not by the items.
  sectionLabel?: string;
  // Stable automation id, matching the command-palette action id where one
  // exists — labels are copy and may change; data-action must not.
  actionId?: string;
};

const VideoShareDialog = lazy(() =>
  import('./VideoShareDialog.tsx').then((module) => ({
    default: module.VideoShareDialog,
  })),
);

/**
 * The transition ladder the stage menu offers as directly pickable options.
 * A subset of the durations Settings offers, chosen so every rung is
 * meaningfully different mid-set rather than eight near-identical values.
 * Settings keeps the full list for when precision matters.
 *
 * The product default (DEFAULT_BLEND_DURATION_SECONDS, 2.5s) is a rung. It
 * was not, and the same state was then reported three ways at once: the
 * trigger printed "2.5s", this ladder marked nothing (exact match), and the
 * overflow menu's copy of it marked "2s" (nearest match) — for every visitor
 * who had never touched the setting.
 */
const TRANSITION_STEPS = [
  { mode: 'cut' as const, seconds: 0 },
  { mode: 'blend' as const, seconds: 1 },
  { mode: 'blend' as const, seconds: DEFAULT_BLEND_DURATION_SECONDS },
  { mode: 'blend' as const, seconds: 5 },
];

function describeTransitionStep(step: (typeof TRANSITION_STEPS)[number]) {
  return step.mode === 'cut'
    ? 'Instant cut'
    : `Blend ${formatSeconds(step.seconds)}s`;
}

/** 2 -> "2", 2.5 -> "2.5", 0.3 -> "0.3": trailing zeros dropped. */
function formatSeconds(seconds: number): string {
  return Number(seconds.toFixed(2)).toString();
}

/**
 * Whether a rung is the engine's current transition. Exact, not nearest, in
 * both ladders: an off-ladder value from Settings (3s, 8s) marks nothing,
 * and the ladder's group label prints the real value instead.
 */
function isTransitionStep(
  step: (typeof TRANSITION_STEPS)[number],
  mode: 'blend' | 'cut',
  seconds: number,
): boolean {
  return (
    mode === step.mode && (step.mode === 'cut' || step.seconds === seconds)
  );
}

/** The palette id a rung dispatches: transition-cut, transition-2.5s, … */
function transitionActionId(step: (typeof TRANSITION_STEPS)[number]) {
  return step.mode === 'cut'
    ? 'transition-cut'
    : `transition-${formatSeconds(step.seconds)}s`;
}

/**
 * The sources worth one-click access mid-set. YouTube and file playback need
 * a URL or a picker, so they stay in the audio setup panel; these three start
 * (or fail with a useful message) straight from the menu.
 */
/**
 * The dock menu lists the same actions the command palette does, so it
 * teaches the same keys. Resolved per render through the registry rather
 * than baked in, so a rebind is reflected here too. Module-level so React
 * does not remount it (and lose its subtree) on every parent render.
 */
const MenuHint = ({
  actionId,
  overrides,
}: {
  actionId: string;
  overrides: ShortcutOverrides;
}) => {
  const hint = shortcutHintFor(actionId, overrides);
  if (!hint) return null;
  return <kbd className={styles.menuHint}>{hint}</kbd>;
};

/**
 * "Tab" alone named nothing a first-time visitor could act on, and both Mic
 * and Tab open a browser prompt; the accessible names say so, and the group
 * hint says it for everyone.
 */
const AUDIO_SOURCE_OPTIONS = [
  { source: 'demo' as const, shortLabel: 'Demo', name: 'Demo audio' },
  {
    source: 'microphone' as const,
    shortLabel: 'Mic',
    name: 'Microphone (asks for microphone access)',
  },
  {
    source: 'tab' as const,
    shortLabel: 'Tab audio',
    name: 'Tab or system audio (asks what to share)',
  },
];

/**
 * The stage element as it is now, for a handler to read when it runs.
 *
 * A function rather than `ui.stageRef.current` inline in a callback: React
 * Compiler infers that `.current` read as a dependency the callback's list
 * cannot name (a `.current` in a dependency list is the bug, not the fix),
 * and skips the whole component. Named as a ref instead, the read makes every
 * menu list that reaches the handler a ref read during render. Read here, the
 * dependency is `ui`, which is what the list already says.
 */
function currentStageElement(ui: {
  stageRef: { readonly current: HTMLElement | null };
}): HTMLElement | null {
  return ui.stageRef.current;
}

export function StageControls({
  isFullscreen,
  onToggleFullscreen,
  onOpenPalette,
  onOpenShortcuts,
  onOpenSets,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenPalette?: () => void;
  /** The ? dialog: every key and every stage gesture. */
  onOpenShortcuts?: () => void;
  /** Saved preset sets: save the queue under a name, load or share one. */
  onOpenSets?: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const [videoShareOpen, setVideoShareOpen] = useState(false);
  const panel = ui.routeState.panel;
  const transitionMode = engineSnapshot?.transitionMode ?? 'blend';
  const blendDuration =
    engineSnapshot?.blendDuration ?? DEFAULT_BLEND_DURATION_SECONDS;
  // What the engine actually holds, not the nearest rung: Settings can set
  // 3s or 8s, and the bar must not claim "2.5s" for either.
  const transitionShortLabel =
    transitionMode === 'cut' ? 'Cut' : `${formatSeconds(blendDuration)}s`;
  const transitionOnLadder = TRANSITION_STEPS.some((step) =>
    isTransitionStep(step, transitionMode, blendDuration),
  );
  const transitionLabel =
    transitionMode === 'cut'
      ? 'Instant cut'
      : `Blend ${formatSeconds(blendDuration)}s`;

  // MilkDrop titles carry the author chain inline ("Krash & Rovastar -
  // Cerebral Demons"), so 93% of the catalog would print the credit twice in
  // the one always-visible strip of chrome — once in full, once truncated.
  // splitPresetDisplay peels the chain off for the byline slot.
  const { title: presetTitle, byline: presetAuthor } = splitPresetDisplay(
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '',
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? undefined,
  );
  const currentPresetId =
    engine.selectedPreset?.id ?? engine.featuredPreset?.id ?? null;

  // When the active backend cannot run a preset's shader text, the renderer
  // substitutes a uniform-only approximation — a plausible frame that is not
  // the preset. That used to be invisible: 19 of the 1201 bundled presets
  // carrying shader text are approximated on WebGPU and nothing said so. This
  // marker is deliberately small and sits with the title rather than shouting
  // from a banner: it should be findable by someone wondering why a preset
  // looks wrong, not a warning aimed at everyone watching.
  const shaderApproximation = describeShaderApproximation(
    engineSnapshot?.shaderExecution,
    engineSnapshot?.backend,
  );

  // Shared by the dock item and the palette's `queue-add`: the verb must not
  // mean different things depending on which surface invoked it.
  const queueCurrentPreset = () => {
    const presetId = engineSnapshot?.activePresetId ?? currentPresetId;
    if (!presetId) {
      ui.setStatusMessage('No preset to queue yet.');
      return;
    }
    ui.presetQueue.add(presetId);
    ui.setStatusMessage('Queued. It shows in the cue monitor.');
  };
  // favoritePresets is the store-derived list, so it stays fresh across
  // toggles even if the selectedPreset entry object is a stale snapshot.
  const presetSaved =
    currentPresetId !== null &&
    engine.favoritePresets.some((preset) => preset.id === currentPresetId);

  const syncSession = useSyncExternalStore(
    subscribeSyncSession,
    getSyncSessionState,
  );

  // Read through the store rather than local state: `L` on the MilkDrop
  // keybinding layer toggles the same flag, and a control that only tracked
  // its own clicks would sit there showing the wrong thing.
  const presetLocked = useSyncExternalStore(
    subscribePresetLock,
    isPresetLocked,
    () => false,
  );
  // Read as state rather than through the registry's defaulted argument, so
  // a rebind re-renders the hints: compiled, a call with constant arguments
  // runs once.
  const shortcutOverrides = useSyncExternalStore(
    subscribeShortcutOverrides,
    readShortcutOverrides,
    readShortcutOverrides,
  );
  const reduceFlashing = useSyncExternalStore(
    subscribeToAccessibilityPreference,
    () => getActiveAccessibilityPreference().reduceFlashing,
    () => false,
  );
  // The projector can be closed from its own window, so the row follows the
  // service rather than its own clicks.
  const projector = useSyncExternalStore(
    subscribeProjector,
    getProjectorState,
    getProjectorState,
  );
  const hostingRoom =
    syncSession.role === 'host' && syncSession.status !== 'idle'
      ? syncSession.room
      : null;
  // The menu rows for these say which way a click goes, so they follow the
  // services rather than their own clicks: a cast can end from the receiver,
  // a recording from its panel, a camera from its device.
  const casting = useSyncExternalStore(
    subscribeExternalDisplay,
    () => getExternalDisplayState().mode !== null,
    () => false,
  );
  const recording = useSyncExternalStore(
    subscribeRecordingActive,
    isRecordingActive,
    () => false,
  );
  const cameraOn = useSyncExternalStore(
    subscribeCameraInput,
    isCameraInputOn,
    () => false,
  );

  const [showMenu, setShowMenu] = useState(false);
  // A pointer resting on the bar, or focus inside it. Measured before this
  // existed: hover the pill, hold still for the 3s timer, and the bar faded
  // out from under the cursor (`:hover` true, `data-visible` false) — the
  // first click after a pause to read the title landed on the stage. Focus
  // had a CSS `:focus-within` reprieve, but that kept the bar painted while
  // the JS flag said hidden, so the reveal handle rendered on top of the
  // title at the same time. Holding through the timer makes the flag and
  // the picture agree; the CSS rule stays as the hard a11y guarantee.
  const [pointerOnBar, setPointerOnBar] = useState(false);
  const [focusOnBar, setFocusOnBar] = useState(false);
  // An open menu holds the bar up. The menus render as siblings of the bar,
  // so the bar's own `:focus-within` reprieve cannot see focus inside them.
  //
  // So does a pause. Three seconds after Space the bar faded and a paused
  // stage was a frozen frame under a "Controls" handle — the same picture as
  // a hung renderer, with the only "Paused" anywhere in a toast that had
  // already gone. Every video player keeps its transport up while paused;
  // the bar's status slot is where this one says "Paused".
  const playbackPaused = engineSnapshot?.playbackPaused ?? false;
  const { visible, signalActivity } = useAutoHideActivity(
    3000,
    true,
    showMenu || pointerOnBar || focusOnBar || playbackPaused,
  );
  const transition = usePresetTransition();
  // Handed the transport so the popout can carry real controls where the
  // browser supports a document-based one; see usePictureInPicture.
  const pip = usePictureInPicture(ui.stageRef, {
    paused: playbackPaused,
    previousPreset: () => void engine.handlePreviousPreset(),
    nextPreset: () => void engine.handleShufflePreset(),
    togglePlayback: () => engine.handleTogglePlayback(),
    playbackLabel: (paused) =>
      playbackToggleLabel(engineSnapshot?.audioSource ?? null, paused),
  });
  const energyRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Toasts render above every overlay, so they have to know when something
  // occupies the bottom of the screen and move out of its way. Sheets publish
  // that from the shell as data-sheet-open; this menu is bottom-anchored too.
  useBottomOverlaySignal(showMenu);

  // A stable registration: the menu must keep Escape while it is open, even
  // as the shell re-renders around it.
  useEscapeHandler(showMenu, () => {
    setShowMenu(false);
    menuBtnRef.current?.focus();
  });

  // ARIA already promises menu semantics (role="menu"/"menuitem"); this
  // backs that up with the arrow-key traversal a screen reader user would
  // reasonably expect from it, instead of leaving Tab as the only path.
  useListKeyboardNav(menuRef, {
    // Prefix match covers menuitem, menuitemcheckbox, and menuitemradio, so
    // the transition/audio radio options are on the same roving-tabindex
    // path as the plain items.
    itemSelector: '[role^="menuitem"]',
    orientation: 'vertical',
    deps: [showMenu],
  });

  useEffect(() => {
    if (!showMenu) return;
    const firstItem =
      menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]');
    firstItem?.focus();
  }, [showMenu]);

  // Opening this menu is the strongest signal of intent the UI gets before a
  // click: nearly every item in it opens a code-split panel, and the download
  // could not start until one was picked. Start them here instead, while the
  // menu is being read. Idempotent, so reopening the menu costs nothing.
  useEffect(() => {
    if (!showMenu) return;
    prefetchMenuPanelChunks();
    refreshCameraInput();
  }, [showMenu]);

  useEffect(() => {
    const updateEnergy = () => {
      const e = Math.min(1, Math.max(0, getAudioEnergy()));
      energyRef.current?.style.setProperty('--energy', String(e));
    };
    updateEnergy();
    return subscribeAudioEnergy(updateEnergy);
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        menuRef.current?.contains(event.target)
      )
        return;
      if (
        event.target instanceof Element &&
        menuBtnRef.current?.contains(event.target)
      )
        return;
      setShowMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // The menu pattern closes on Tab: focus is meant to leave the menu and
      // continue through the page. Without this, Tab walked focus into the
      // content the menu is covering while the menu stayed open on top of it.
      // Focus is left where Tab sends it rather than pulled back to the
      // button, which is the point of pressing Tab.
      if (event.key === 'Tab') {
        setShowMenu(false);
      }
    };
    const handleResize = () => setShowMenu(false);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, {
      passive: true,
    });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [showMenu]);

  // A transition is exactly the moment the user is wondering what's
  // happening, so surface the dock even if it had auto-hidden — the pill is
  // where the loading/blending state is narrated.
  useEffect(() => {
    if (transition.phase !== 'idle') {
      signalActivity();
    }
  }, [transition.phase, signalActivity]);

  useEffect(() => {
    let activityFrame: number | null = null;
    const handlePointerMove = () => {
      if (activityFrame !== null) return;
      activityFrame = requestAnimationFrame(() => {
        activityFrame = null;
        signalActivity();
      });
    };
    const handleActivity = () => signalActivity();
    document.addEventListener('pointermove', handlePointerMove, {
      passive: true,
    });
    document.addEventListener('pointerdown', handleActivity, { passive: true });
    document.addEventListener('wheel', handleActivity, { passive: true });
    document.addEventListener('keydown', handleActivity);
    // Tabbing into the dock counts as activity too, so the hide timer resets
    // while a keyboard user is reading it (the CSS :focus-within rule is the
    // hard guarantee that focus is never left on a hidden control).
    document.addEventListener('focusin', handleActivity);
    return () => {
      if (activityFrame !== null) cancelAnimationFrame(activityFrame);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerdown', handleActivity);
      document.removeEventListener('wheel', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('focusin', handleActivity);
    };
  }, [signalActivity]);

  const handleShuffle = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    void engine.handleShufflePreset();
  }, [engine, signalActivity]);

  const handlePrevious = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    void engine.handlePreviousPreset();
  }, [engine, signalActivity]);

  // Nearby is the small step in the wandering trio: Back, Nearby, Surprise
  // me. It reuses the visual-embedding index behind the finder's "by look"
  // tab, so "similar" means one thing across the app.
  const handleNearby = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    void playNearbyPreset(
      nearbyPresetRequest({
        stage: currentStageElement(ui),
        catalog: engine.catalog,
        currentPresetId,
        play: (presetId) => engine.handlePresetSelection(presetId),
        announce: ui.setStatusMessage,
      }),
    );
  }, [engine, ui, currentPresetId, signalActivity]);

  const handleToggleLock = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    ui.setStatusMessage(
      togglePresetLock()
        ? 'Keeping this preset. Autoplay won’t change it.'
        : 'Autoplay can move on again.',
    );
  }, [ui, signalActivity]);

  const handleBrowse = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    ui.updatePanel(panel === 'browse' ? null : 'browse');
  }, [ui, panel, signalActivity]);

  const handleToggleSave = useCallback(() => {
    if (!currentPresetId) return;
    signalActivity();
    pulseHaptic(10);
    void engine.toggleFavoritePreset(currentPresetId, !presetSaved);
  }, [engine, currentPresetId, presetSaved, signalActivity]);

  // Start hosting and copy the room link in one action; when already
  // hosting, just copy. Shared body with the command palette.
  const handleWatchParty = useCallback(() => {
    startOrCopyWatchPartyAction(ui.setStatusMessage);
  }, [ui]);

  // Panel surface for the shared action bodies; reads live route state.
  const menuSurface = {
    updatePanel: ui.updatePanel,
    routePanel: () => ui.routeState.panel ?? null,
  };

  const run = useCallback(
    (fn: () => void) => {
      signalActivity();
      pulseHaptic(10);
      setShowMenu(false);
      fn();
      // Activating an item unmounts the menu, which would drop focus to
      // <body>; hand it back to the trigger, mirroring the Escape path.
      // Actions that open a panel place their own focus in a later effect,
      // so this synchronous restore never fights them.
      menuBtnRef.current?.focus();
    },
    [signalActivity],
  );

  const presetItems: MenuItem[] = [
    {
      icon: 'grid' as const,
      label: panelToggleLabel('browse', panel === 'browse'),
      action: () => togglePanel(menuSurface, 'browse'),
      actionId: 'open-browse',
      active: panel === 'browse',
      sectionLabel: 'Presets and setlist',
    },
    {
      icon: 'eye' as const,
      label: panelToggleLabel('finder', panel === 'finder'),
      actionId: 'find-similar',
      action: () => togglePanel(menuSurface, 'finder'),
      active: panel === 'finder',
    },
    {
      icon: 'nearby' as const,
      label: 'Play a similar-looking preset',
      actionId: 'nearby-preset',
      action: () => handleNearby(),
    },
    {
      icon: 'pin' as const,
      label: presetLocked ? 'Let autoplay move on' : 'Keep this preset',
      actionId: 'toggle-preset-lock',
      action: () => handleToggleLock(),
      active: presetLocked,
    },
    {
      icon: 'bookmark' as const,
      label: 'Queue this preset to play next',
      actionId: 'queue-add',
      action: () => queueCurrentPreset(),
    },
    // The setlist this section is named for. Saving and loading sets was a
    // palette-only command, so nothing on screen said they existed.
    ...(onOpenSets
      ? [
          {
            icon: 'music' as const,
            label: 'Preset sets…',
            actionId: 'queue-manage-sets',
            action: onOpenSets,
          } satisfies MenuItem,
        ]
      : []),
    // Listed here as well as on the bar: on phones the bar drops the star to
    // give the title room to be read, and press-and-hold on the stage is a
    // gesture nobody can see. This row is the one place it is always named.
    ...(currentPresetId
      ? [
          {
            icon: 'star' as const,
            label: presetSaved ? 'Remove from saved' : 'Save preset',
            actionId: 'save-preset',
            action: () => handleToggleSave(),
            active: presetSaved,
          } satisfies MenuItem,
        ]
      : []),
  ];

  const studioItems: MenuItem[] = [
    {
      icon: 'sparkles' as const,
      label: panelToggleLabel('synthesize', panel === 'synthesize'),
      actionId: 'open-generate',
      action: () => togglePanel(menuSurface, 'synthesize'),
      active: panel === 'synthesize',
      sectionLabel: 'Create and edit',
    },
    {
      icon: 'wand' as const,
      label: panelToggleLabel('refine', panel === 'refine'),
      actionId: 'open-refine',
      action: () => togglePanel(menuSurface, 'refine'),
      active: panel === 'refine',
    },
    {
      icon: 'pencil' as const,
      label: panelToggleLabel('editor', panel === 'editor'),
      actionId: 'open-editor',
      action: () => togglePanel(menuSurface, 'editor'),
      active: panel === 'editor',
    },
    {
      icon: 'video' as const,
      label: recordMenuLabel({ panelOpen: panel === 'capture', recording }),
      actionId: 'open-record',
      action: () => openRecordPanel(menuSurface),
      active: panel === 'capture',
    },
  ];

  const vjItems: MenuItem[] = [
    {
      icon: 'gauge' as const,
      label: 'Add live sliders…',
      actionId: 'perform-pin',
      action: () => openPerformPicker(),
    },
    ...(engineSnapshot?.audioSource
      ? [
          {
            icon: playbackPaused ? ('play' as const) : ('pause' as const),
            label: playbackToggleLabel(
              engineSnapshot.audioSource,
              playbackPaused,
            ),
            actionId: 'toggle-playback',
            action: () => engine.handleTogglePlayback(),
          } satisfies MenuItem,
          {
            icon: 'volume-off' as const,
            // Says where it goes. This unmounts the engine and shows the
            // start page; as "Stop audio" it sat behind a mute glyph and
            // read as pause — the thing above it is pause.
            label: 'Stop audio and go back to start',
            actionId: 'stop-audio',
            action: () => engine.handleAudioStop(),
          } satisfies MenuItem,
        ]
      : []),
  ];

  const displayItems: MenuItem[] = [
    {
      icon: 'expand' as const,
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
      actionId: 'toggle-fullscreen',
      action: () => onToggleFullscreen(),
      sectionLabel: 'Display and streaming',
    },
    // A safety setting, so a tap from the stage rather than the last switch
    // on the fourth Settings tab.
    {
      icon: 'sun' as const,
      label: 'Reduce flashing',
      actionId: 'toggle-reduce-flashing',
      action: () => toggleReduceFlashingAction(ui.setStatusMessage),
      active: reduceFlashing,
    },
    ...(pip.supported
      ? [
          {
            icon: 'picture-in-picture' as const,
            label: pip.active
              ? 'Exit picture in picture'
              : 'Picture in picture',
            actionId: 'toggle-pip',
            action: () => pip.toggle(),
            active: pip.active,
          } satisfies MenuItem,
        ]
      : []),
    {
      icon: 'external-link' as const,
      label: projectorMenuLabel(projector.open, hasMultipleScreens()),
      actionId: 'toggle-projector',
      action: () =>
        toggleProjectorAction({
          stage: () => ui.stageRef.current,
          announce: ui.setStatusMessage,
        }),
      active: projector.open,
    },
    {
      icon: 'arrow-right' as const,
      label: castMenuLabel(casting),
      actionId: 'external-display',
      action: () => presentToExternalDisplayAction(ui.setStatusMessage),
      active: casting,
    },
    {
      icon: 'image' as const,
      label: cameraMenuLabel(cameraOn),
      actionId: 'toggle-camera',
      action: () => toggleCameraAction(ui.setStatusMessage),
      active: cameraOn,
    },
  ];

  // Settings and the palette lead this group. They are the two routes to
  // everything the menu does not list, and as the last two of 26 items they
  // sat below the fold of a menu that scrolled at every common height.
  const workspaceItems: MenuItem[] = [
    {
      icon: 'sliders' as const,
      label: panelToggleLabel('settings', panel === 'settings'),
      actionId: 'open-settings',
      action: () => togglePanel(menuSurface, 'settings'),
      active: panel === 'settings',
      sectionLabel: 'Workspace and system',
    },
    ...(onOpenPalette
      ? [
          {
            icon: 'menu' as const,
            label: 'Command palette',
            actionId: 'open-palette',
            action: onOpenPalette,
          } satisfies MenuItem,
        ]
      : []),
    // The swipe-up, hold-to-save and Shift+scroll gestures are listed only
    // in this dialog. On a phone, with no ? key, it sat three levels down
    // (Settings, its fourth tab, a button).
    ...(onOpenShortcuts
      ? [
          {
            icon: 'info' as const,
            label: 'Shortcuts and gestures',
            actionId: 'open-shortcuts',
            action: onOpenShortcuts,
          } satisfies MenuItem,
        ]
      : []),
    {
      icon: 'link' as const,
      label: engineSnapshot?.sessionState?.dirty
        ? 'Share link (carries your edits)'
        : 'Share link',
      actionId: 'share-link',
      action: () => void ui.handleShowCurrentLink(),
    },
    {
      // Not the link icon: Share link above copies a link, this publishes a
      // clip and the preset's code where anyone with the address can see it.
      icon: 'upload' as const,
      label: 'Publish a public video link…',
      // No data-action: there is no palette row for it to match, so the
      // click is noted here instead of by the delegated listener.
      action: () => {
        noteActionUse('publish-video-link', 'menu');
        setVideoShareOpen(true);
      },
    },
    {
      icon: 'pulse' as const,
      label: hostingRoom
        ? 'Copy watch party link'
        : 'Start watch party (copies link)',
      actionId: 'watch-party',
      action: handleWatchParty,
    },
    ...(hostingRoom
      ? [
          {
            icon: 'close' as const,
            label: 'End watch party',
            actionId: 'end-watch-party',
            action: () => endWatchParty(ui.setStatusMessage),
          } satisfies MenuItem,
        ]
      : []),
  ];

  /** "Previous" -> "Previous (P)", and just "Previous" when unbound. */
  const withHint = (label: string, actionId: string) => {
    const hint = shortcutHintFor(actionId, shortcutOverrides);
    return hint ? `${label} (${hint})` : label;
  };
  const playbackLabel = playbackToggleLabel(
    engineSnapshot?.audioSource ?? null,
    playbackPaused,
  );
  const playbackHint =
    !playbackPaused && !soundStopsOnPause(engineSnapshot?.audioSource ?? null)
      ? `${withHint(playbackLabel, 'toggle-playback')}. ${SOUND_KEEPS_PLAYING}`
      : withHint(playbackLabel, 'toggle-playback');

  const renderMenuItem = (item: MenuItem) => (
    <div key={item.label}>
      {item.sectionLabel ? (
        <div className={styles.menuLabel} aria-hidden="true">
          {item.sectionLabel}
        </div>
      ) : null}
      <button
        type="button"
        data-action={item.actionId}
        {...(item.active === undefined
          ? { role: 'menuitem' as const }
          : {
              role: 'menuitemcheckbox' as const,
              'aria-checked': item.active,
            })}
        className={styles.menuItem}
        data-active={String(item.active ?? false)}
        // Naming the item explicitly keeps the visible key out of the
        // accessible name ("Browse presets", not "Browse presets B"), and
        // aria-keyshortcuts is what announces the key instead.
        aria-label={item.label}
        aria-keyshortcuts={
          item.actionId
            ? ariaKeyShortcutsFor(item.actionId, shortcutOverrides)
            : undefined
        }
        onClick={() => run(item.action)}
      >
        <UiIcon
          name={item.icon}
          className="stims-icon-slot stims-icon-slot--sm"
        />
        <span>{item.label}</span>
        {item.actionId ? (
          <MenuHint actionId={item.actionId} overrides={shortcutOverrides} />
        ) : null}
      </button>
    </div>
  );

  return (
    <>
      <div
        className={styles.bar}
        data-visible={String(visible)}
        data-telemetry-surface="dock"
      >
        {/* Hover and focus are tracked on the pill, the element the pointer
            can actually hit — the bar around it is pointer-events: none. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: these handlers only note that a pointer or focus is inside the container of buttons, to keep it from auto-hiding; the buttons themselves are the interactions */}
        <div
          className={styles.pill}
          data-transition={
            transition.phase !== 'idle' ? transition.phase : undefined
          }
          data-paused={playbackPaused ? 'true' : undefined}
          onPointerEnter={() => {
            setPointerOnBar(true);
            signalActivity();
          }}
          onPointerLeave={() => setPointerOnBar(false)}
          onFocus={() => setFocusOnBar(true)}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setFocusOnBar(false);
            }
          }}
        >
          <span ref={energyRef} className={styles.glow} aria-hidden="true" />
          {transition.phase === 'blending' ? (
            <span
              key={transition.blendNonce}
              className={styles.blendSweep}
              aria-hidden="true"
              style={
                {
                  '--blend-ms': `${transition.blendDurationMs}ms`,
                } as React.CSSProperties
              }
            />
          ) : null}
          <AudioStatusControl onActivity={signalActivity} />
          <button
            type="button"
            className={styles.navBtn}
            data-primary="true"
            data-action="previous-preset"
            aria-label="Back to the last preset"
            data-hint={withHint('Back to the last preset', 'previous-preset')}
            aria-keyshortcuts={ariaKeyShortcutsFor(
              'previous-preset',
              shortcutOverrides,
            )}
            onClick={handlePrevious}
          >
            <UiIcon
              name="arrow-left"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          {/* The wandering trio reads left to right as Back, Nearby,
              Surprise me — one step back, a small step sideways, a big step
              anywhere. Nearby is not primary: it is the considered move, and
              giving all three the same weight would leave the bar with no
              answer to "what do I press?" again. */}
          <button
            type="button"
            className={styles.navBtn}
            data-action="nearby-preset"
            aria-label="Play a similar-looking preset"
            data-hint={withHint(
              'Play a similar-looking preset',
              'nearby-preset',
            )}
            aria-keyshortcuts={ariaKeyShortcutsFor(
              'nearby-preset',
              shortcutOverrides,
            )}
            onClick={handleNearby}
          >
            <UiIcon
              name="nearby"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          <button
            type="button"
            className={styles.navBtn}
            data-primary="true"
            data-action="next-preset"
            aria-label="Play a random preset"
            data-hint={withHint('Play a random preset', 'next-preset')}
            aria-keyshortcuts={ariaKeyShortcutsFor(
              'next-preset',
              shortcutOverrides,
            )}
            onClick={handleShuffle}
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>

          {/* In the bar, not floating above it. As a separate pill over the
              bar's right end it read as a notification rather than a control,
              and it took the slot where the transition length used to sit —
              a setting first-time visitors could not decode as "2.5s", which
              lives in the menu's Transition row now. The label stays: an
              icon alone would not say that the visual is code you can edit,
              which is the claim the landing page makes. */}
          {panel !== 'editor' ? (
            <button
              type="button"
              className={styles.editEntry}
              data-action="open-editor"
              aria-label="Edit this visual"
              title={withHint('Edit this visual', 'open-editor')}
              aria-keyshortcuts={ariaKeyShortcutsFor(
                'open-editor',
                shortcutOverrides,
              )}
              onClick={() => {
                signalActivity();
                ui.updatePanel('editor');
              }}
            >
              <UiIcon
                name="pencil"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              Edit
            </button>
          ) : null}

          <button
            type="button"
            className={styles.titleBtn}
            data-action="open-browse"
            data-active={String(panel === 'browse')}
            // The visible text is the preset title, so the name has to
            // start with it: a name that replaces the visible label outright
            // leaves voice-control users unable to activate the button by the
            // words they can see (WCAG 2.5.3 Label in Name).
            aria-label={
              shaderApproximation
                ? `${presetTitle}. ${getPanelTitle('browse')}. ${shaderApproximation.detail}`
                : `${presetTitle}. ${getPanelTitle('browse')}`
            }
            title={
              shaderApproximation
                ? `${withHint(getPanelTitle('browse'), 'open-browse')}\n\n${shaderApproximation.detail}`
                : withHint(getPanelTitle('browse'), 'open-browse')
            }
            aria-keyshortcuts={ariaKeyShortcutsFor(
              'open-browse',
              shortcutOverrides,
            )}
            onClick={handleBrowse}
          >
            <span className={styles.titleText}>{presetTitle}</span>
            {playbackPaused ? (
              <span className={styles.statusText} data-static="true">
                Paused
              </span>
            ) : transition.phase === 'loading' ? (
              <span className={styles.statusText}>Loading…</span>
            ) : presetAuthor ? (
              <span className={styles.authorText}>{presetAuthor}</span>
            ) : null}
            {/* Last in the pill, after the byline: this annotates the whole
                title, and wedging it between the name and its author reads as
                part of the credit. */}
            {shaderApproximation ? (
              <span
                className={styles.fidelityMark}
                data-shader-execution={engineSnapshot?.shaderExecution ?? ''}
              >
                {shaderApproximation.label}
              </span>
            ) : null}
          </button>

          {currentPresetId ? (
            <button
              type="button"
              className={styles.navBtn}
              data-action="save-preset"
              data-saved={String(presetSaved)}
              aria-pressed={presetSaved}
              aria-label={presetSaved ? 'Remove from saved' : 'Save preset'}
              data-hint={withHint(
                presetSaved ? 'Remove from saved' : 'Save preset',
                'save-preset',
              )}
              aria-keyshortcuts={ariaKeyShortcutsFor(
                'save-preset',
                shortcutOverrides,
              )}
              onClick={handleToggleSave}
            >
              <UiIcon
                name="star"
                className="stims-icon-slot stims-icon-slot--sm"
              />
            </button>
          ) : null}

          {/* The transport control every visualizer is expected to have.
              This slot used to hold "Stop audio" behind a mute glyph, and
              stopping audio unmounts the engine and returns to the start
              page — so the button that looked like mute was the exit. Pause
              holds the frame and keeps the session; stopping lives in the
              menu under a label that says where it goes. */}
          {engineSnapshot?.audioSource ? (
            <button
              type="button"
              className={styles.navBtn}
              data-action="toggle-playback"
              data-paused={String(playbackPaused)}
              aria-label={playbackLabel}
              data-hint={playbackHint}
              aria-keyshortcuts={ariaKeyShortcutsFor(
                'toggle-playback',
                shortcutOverrides,
              )}
              onClick={() => {
                signalActivity();
                pulseHaptic(10);
                engine.handleTogglePlayback();
              }}
            >
              <UiIcon
                name={playbackPaused ? 'play' : 'pause'}
                className="stims-icon-slot stims-icon-slot--sm"
              />
            </button>
          ) : null}

          <button
            type="button"
            className={styles.navBtn}
            data-action="toggle-fullscreen"
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            data-hint={withHint(
              isFullscreen ? 'Exit full screen' : 'Full screen',
              'toggle-fullscreen',
            )}
            aria-keyshortcuts={ariaKeyShortcutsFor(
              'toggle-fullscreen',
              shortcutOverrides,
            )}
            onClick={() => {
              signalActivity();
              pulseHaptic(10);
              onToggleFullscreen();
            }}
          >
            <UiIcon
              name="expand"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>

          <button
            ref={menuBtnRef}
            type="button"
            className={styles.menuBtn}
            aria-expanded={showMenu}
            aria-haspopup="menu"
            aria-label="More actions"
            data-hint="More actions"
            onClick={() => {
              signalActivity();
              pulseHaptic(10);
              setShowMenu((s) => !s);
            }}
          >
            <UiIcon
              name="menu"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>
      </div>

      {showMenu ? (
        // Presentational only: the document pointerdown listener above already
        // closes the menu on any press outside it, and this sits underneath.
        <div className={styles.menuScrim} aria-hidden="true" />
      ) : null}

      {showMenu ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          data-telemetry-surface="menu"
          aria-label="More actions"
        >
          {/* Two columns from 640px up, one below. As a single column of 26
              items the menu was 1186px tall in a 694px viewport: it scrolled
              at every common desktop height, and the two routes to everything
              it does not list — Settings and the palette — were the last two
              items. Reading order is the same in both layouts: what to play,
              how it plays, then the studio tools, workspace and display.
              The studio tools lead the second column: as its last group they
              started at the menu's bottom edge at 1280x720 and at the end of
              the phone's single column, and they carry the landing's promise
              (edit the code) and its AI tools. */}
          <div className={styles.menuColumn}>
            {presetItems.map(renderMenuItem)}

            <div className={styles.menuSep} />
            <div className={styles.menuLabel} aria-hidden="true">
              Live VJ and audio
            </div>
            {/* Direct picks, not a cycle: mid-set there is no time to click
              through the ladder to reach the rung you want. A rung is marked
              only on an exact match; when Settings holds a value off this
              ladder the label carries it, because this menu is the only
              place the transition is shown at all. */}
            {/* biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA menu pattern for menuitemradio sets; fieldset carries form semantics a menu must not have */}
            <div
              className={styles.menuGroup}
              role="group"
              aria-label={
                transitionOnLadder
                  ? 'Transition'
                  : `Transition, currently ${transitionLabel}`
              }
            >
              <span className={styles.menuGroupLabel} aria-hidden="true">
                Transition
                {transitionOnLadder ? null : (
                  <span className={styles.menuGroupValue}>
                    {' '}
                    · {transitionShortLabel}
                  </span>
                )}
              </span>
              {/* A tap here mid-set changes the saved default that Settings
                  shows too, not only the next switch. */}
              <span className={styles.menuGroupHint} id="menu-transition-hint">
                How the next preset arrives. Saved as your default.
              </span>
              <div className={styles.menuGroupOptions}>
                {TRANSITION_STEPS.map((step) => {
                  const checked = isTransitionStep(
                    step,
                    transitionMode,
                    blendDuration,
                  );
                  return (
                    <button
                      key={describeTransitionStep(step)}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      aria-label={`Transition: ${describeTransitionStep(step)}`}
                      aria-describedby="menu-transition-hint"
                      className={styles.menuOption}
                      data-action={transitionActionId(step)}
                      data-active={String(checked)}
                      onClick={() =>
                        run(() =>
                          setTransition(
                            engine,
                            ui.setStatusMessage,
                            step.mode,
                            step.seconds,
                          ),
                        )
                      }
                    >
                      {step.mode === 'cut'
                        ? 'Cut'
                        : `${formatSeconds(step.seconds)}s`}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA menu pattern for menuitemradio sets; fieldset carries form semantics a menu must not have */}
            <div
              className={styles.menuGroup}
              role="group"
              aria-label="Audio source"
            >
              <span className={styles.menuGroupLabel} aria-hidden="true">
                Audio source
              </span>
              <span className={styles.menuGroupHint} aria-hidden="true">
                Replaces the current sound. Mic and Tab audio ask the browser
                for permission.
              </span>
              <div className={styles.menuGroupOptions}>
                {AUDIO_SOURCE_OPTIONS.map((option) => (
                  <button
                    key={option.source}
                    type="button"
                    role="menuitemradio"
                    aria-checked={engineSnapshot?.audioSource === option.source}
                    aria-label={option.name}
                    className={styles.menuOption}
                    data-action={`audio-${option.source}`}
                    data-active={String(
                      engineSnapshot?.audioSource === option.source,
                    )}
                    onClick={() =>
                      run(() => startAudioSource(engine, option.source))
                    }
                  >
                    {option.shortLabel}
                  </button>
                ))}
              </div>
            </div>
            {vjItems.map(renderMenuItem)}
          </div>

          <div className={styles.menuColumn}>
            {studioItems.map(renderMenuItem)}
            <div className={styles.menuSep} />
            {workspaceItems.map(renderMenuItem)}
            <div className={styles.menuSep} />
            {displayItems.map(renderMenuItem)}
          </div>
        </div>
      ) : null}

      {/* The folded dock. Always mounted, never conditional — the handle and
          the transport are two states of one control, and rendering the
          handle only while `visible` is false let both occupy the same patch
          of screen at once: the bar takes 300ms to fade out, the handle
          appeared instantly, and for that window the preset title sat
          underneath the word "Controls". Driving both from the same flag
          lets the CSS hand off cleanly — the incoming one waits for the
          outgoing one to clear. */}
      <div
        className={styles.foldedDock}
        data-visible={String(!visible)}
        data-telemetry-surface="dock"
      >
        {/* The bar is `visibility: hidden` while folded, so its Edit button
            leaves the accessibility tree exactly when a visitor reading the
            stage would most need to find it (docs/PRODUCT_MOMENTS.md,
            "Open one up"). A second Edit, shown only in the folded state,
            keeps the promise's action in the tree and on the screen. Phones
            drop it with the bar's own Edit: the editor sheet covers the
            stage there, and that finding is still open. */}
        <button
          type="button"
          className={styles.foldedEdit}
          data-action="open-editor"
          data-visible={String(!visible)}
          aria-label="Edit this visual"
          title={withHint('Edit this visual', 'open-editor')}
          aria-keyshortcuts={ariaKeyShortcutsFor(
            'open-editor',
            shortcutOverrides,
          )}
          inert={visible || undefined}
          onClick={() => {
            signalActivity();
            ui.updatePanel('editor');
          }}
        >
          <UiIcon
            name="pencil"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          Edit
        </button>
        <button
          type="button"
          className={styles.handle}
          data-visible={String(!visible)}
          aria-label="Show controls"
          title="Show controls"
          // Hidden by `visibility` in CSS, which already removes it from the
          // tab order; `inert` additionally keeps a mid-transition frame from
          // catching a click aimed at the transport underneath it.
          inert={visible || undefined}
          onClick={() => signalActivity()}
        >
          <span className={styles.handleIcon} aria-hidden="true">
            <UiIcon
              name="chevron-up"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </span>
          {/* A bare chevron on an unlabeled pill was the only visible UI on
              an idle stage; first-time visitors had to guess what it did. */}
          <span>Controls</span>
        </button>
      </div>
      {videoShareOpen ? (
        <Suspense fallback={null}>
          <VideoShareDialog onClose={() => setVideoShareOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
