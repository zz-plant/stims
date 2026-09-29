/**
 * Stage Controls Overlay Component — renders the floating on-stage navigation bar, playback toggles,
 * PiP controls, audio volume meters, preset transition progress, and overlay dialog triggers.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from '../../css/StageControls.module.css';
import {
  isPresetLocked,
  subscribePresetLock,
  togglePresetLock,
} from '../core/preset-lock.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import { DEFAULT_BLEND_DURATION_SECONDS } from '../milkdrop/runtime/first-run-preset.ts';
import { describeShaderApproximation } from '../milkdrop/shader-execution-mode.ts';
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
import { openPerformPicker } from './perform-pins.ts';
import { ariaKeyShortcutsFor, shortcutHintFor } from './shortcut-registry.ts';
import { getSyncSessionState, subscribeSyncSession } from './sync-session.ts';
import { UiIcon } from './UiIcon.tsx';
import {
  endWatchParty,
  nearbyPresetRequest,
  openRecordPanel,
  playNearbyPreset,
  presentToExternalDisplayAction,
  setTransition,
  startAudioSource,
  startOrCopyWatchPartyAction,
  toggleCameraAction,
  togglePanel,
} from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type MenuItem = {
  icon: UiIconName;
  label: string;
  action: () => void;
  active?: boolean;
  // Short group header rendered above the item. Separators between groups
  // are placed by the column layout, not by the items.
  sectionLabel?: string;
  // Stable automation id, matching the command-palette action id where one
  // exists — labels are copy and may change; data-action must not.
  actionId?: string;
};

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
const AUDIO_SOURCE_OPTIONS = [
  { source: 'demo' as const, shortLabel: 'Demo', name: 'Demo audio' },
  { source: 'microphone' as const, shortLabel: 'Mic', name: 'Microphone' },
  { source: 'tab' as const, shortLabel: 'Tab', name: 'Tab or system audio' },
];

export function StageControls({
  isFullscreen,
  onToggleFullscreen,
  onOpenPalette,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenPalette?: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
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
  const hostingRoom =
    syncSession.role === 'host' && syncSession.status !== 'idle'
      ? syncSession.room
      : null;

  const [showMenu, setShowMenu] = useState(false);
  const [showTransitionMenu, setShowTransitionMenu] = useState(false);
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
    showMenu ||
      showTransitionMenu ||
      pointerOnBar ||
      focusOnBar ||
      playbackPaused,
  );
  const transition = usePresetTransition();
  // Handed the transport so the popout can carry real controls where the
  // browser supports a document-based one; see usePictureInPicture.
  const pip = usePictureInPicture(ui.stageRef, {
    paused: playbackPaused,
    previousPreset: () => void engine.handlePreviousPreset(),
    nextPreset: () => void engine.handleShufflePreset(),
    togglePlayback: () => engine.handleTogglePlayback(),
  });
  const energyRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const transitionMenuRef = useRef<HTMLDivElement>(null);
  const transitionBtnRef = useRef<HTMLButtonElement>(null);
  // Where the popover sits: centred over its trigger, measured on open. The
  // pill is centred and its width follows the title, so the trigger has no
  // fixed x to style against.
  const [transitionAnchor, setTransitionAnchor] = useState<{
    left: number;
    bottom: number;
  } | null>(null);

  // Toasts render above every overlay, so they have to know when something
  // occupies the bottom of the screen and move out of its way. Sheets publish
  // that from the shell as data-sheet-open; this menu is bottom-anchored too.
  useBottomOverlaySignal(showMenu || showTransitionMenu);

  // A stable registration: the menu must keep Escape while it is open, even
  // as the shell re-renders around it.
  useEscapeHandler(showMenu, () => {
    setShowMenu(false);
    menuBtnRef.current?.focus();
  });
  useEscapeHandler(showTransitionMenu, () => {
    setShowTransitionMenu(false);
    transitionBtnRef.current?.focus();
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

  useListKeyboardNav(transitionMenuRef, {
    itemSelector: '[role="menuitemradio"]',
    orientation: 'horizontal',
    deps: [showTransitionMenu],
  });

  // Land on the rung that is active, not the first one: the popover exists
  // to move one step from where you are, and a keyboard user should start
  // there.
  useEffect(() => {
    if (!showTransitionMenu) return;
    const current =
      transitionMenuRef.current?.querySelector<HTMLElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      ) ??
      transitionMenuRef.current?.querySelector<HTMLElement>(
        '[role="menuitemradio"]',
      );
    current?.focus();
  }, [showTransitionMenu]);

  useEffect(() => {
    if (!showTransitionMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (transitionMenuRef.current?.contains(event.target) ||
          transitionBtnRef.current?.contains(event.target))
      ) {
        return;
      }
      setShowTransitionMenu(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') setShowTransitionMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTransitionMenu]);

  // One popover at a time.
  useEffect(() => {
    if (showMenu) setShowTransitionMenu(false);
  }, [showMenu]);

  useEffect(() => {
    if (!showTransitionMenu) {
      setTransitionAnchor(null);
      return;
    }
    const measure = () => {
      const rect = transitionBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTransitionAnchor({
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    measure();
    const handleResize = () => setShowTransitionMenu(false);
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, [showTransitionMenu]);

  // Opening this menu is the strongest signal of intent the UI gets before a
  // click: nearly every item in it opens a code-split panel, and the download
  // could not start until one was picked. Start them here instead, while the
  // menu is being read. Idempotent, so reopening the menu costs nothing.
  useEffect(() => {
    if (showMenu) prefetchMenuPanelChunks();
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
        stage: ui.stageRef.current,
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
        ? 'Staying on this preset. Auto-advance is paused.'
        : 'Auto-advance on.',
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
      label: 'Browse presets',
      action: () => run(() => togglePanel(menuSurface, 'browse')),
      actionId: 'open-browse',
      active: panel === 'browse',
      sectionLabel: 'Presets & Setlist',
    },
    {
      icon: 'eye' as const,
      label: 'Find similar',
      actionId: 'find-similar',
      action: () => run(() => togglePanel(menuSurface, 'finder')),
      active: panel === 'finder',
    },
    {
      icon: 'nearby' as const,
      label: 'Nearby preset',
      actionId: 'nearby-preset',
      action: () => run(() => handleNearby()),
    },
    {
      icon: 'pin' as const,
      label: presetLocked ? 'Stop staying here' : 'Stay here',
      actionId: 'toggle-preset-lock',
      action: () => run(() => handleToggleLock()),
      active: presetLocked,
    },
    {
      icon: 'bookmark' as const,
      label: 'Queue this preset',
      actionId: 'queue-add',
      action: () => run(() => queueCurrentPreset()),
    },
    // Listed here as well as on the bar: on phones the bar drops the star to
    // give the title room to be read, and press-and-hold on the stage is a
    // gesture nobody can see. This row is the one place it is always named.
    ...(currentPresetId
      ? [
          {
            icon: 'star' as const,
            label: presetSaved ? 'Remove from saved' : 'Save preset',
            actionId: 'save-preset',
            action: () => run(() => handleToggleSave()),
            active: presetSaved,
          } satisfies MenuItem,
        ]
      : []),
  ];

  const studioItems: MenuItem[] = [
    {
      icon: 'sparkles' as const,
      label: 'Generate with AI',
      actionId: 'open-generate',
      action: () => run(() => togglePanel(menuSurface, 'synthesize')),
      active: panel === 'synthesize',
      sectionLabel: 'Studio & Create',
    },
    {
      icon: 'wand' as const,
      label: 'Refine with AI',
      actionId: 'open-refine',
      action: () => run(() => togglePanel(menuSurface, 'refine')),
      active: panel === 'refine',
    },
    {
      icon: 'pencil' as const,
      label: 'Edit preset code',
      actionId: 'open-editor',
      action: () => run(() => togglePanel(menuSurface, 'editor')),
      active: panel === 'editor',
    },
    {
      icon: 'video' as const,
      label: 'Record video',
      actionId: 'open-record',
      action: () => run(() => openRecordPanel(menuSurface)),
      active: panel === 'capture',
    },
  ];

  const vjItems: MenuItem[] = [
    {
      icon: 'sliders' as const,
      label: 'Performance controls',
      actionId: 'perform-pin',
      action: () => run(() => openPerformPicker()),
    },
    ...(engineSnapshot?.audioSource
      ? [
          {
            icon: playbackPaused ? ('play' as const) : ('pause' as const),
            label: playbackPaused ? 'Resume' : 'Pause',
            actionId: 'toggle-playback',
            action: () => run(() => engine.handleTogglePlayback()),
          } satisfies MenuItem,
          {
            icon: 'volume-off' as const,
            // Says where it goes. This unmounts the engine and shows the
            // start page; as "Stop audio" it sat behind a mute glyph and
            // read as pause — the thing above it is pause.
            label: 'Stop audio and go back to start',
            actionId: 'stop-audio',
            action: () => run(() => engine.handleAudioStop()),
          } satisfies MenuItem,
        ]
      : []),
  ];

  const displayItems: MenuItem[] = [
    {
      icon: 'expand' as const,
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
      actionId: 'toggle-fullscreen',
      action: () => run(() => onToggleFullscreen()),
      sectionLabel: 'Display & Streaming',
    },
    ...(pip.supported
      ? [
          {
            icon: 'picture-in-picture' as const,
            label: pip.active
              ? 'Exit picture in picture'
              : 'Picture in picture',
            actionId: 'toggle-pip',
            action: () => run(() => pip.toggle()),
            active: pip.active,
          } satisfies MenuItem,
        ]
      : []),
    {
      icon: 'expand' as const,
      label: 'Show on second screen or cast',
      actionId: 'external-display',
      action: () =>
        run(() => presentToExternalDisplayAction(ui.setStatusMessage)),
    },
    {
      icon: 'image' as const,
      label: 'Camera as video input',
      actionId: 'toggle-camera',
      action: () => run(() => toggleCameraAction(ui.setStatusMessage)),
    },
  ];

  // Settings and the palette lead this group. They are the two routes to
  // everything the menu does not list, and as the last two of 26 items they
  // sat below the fold of a menu that scrolled at every common height.
  const workspaceItems: MenuItem[] = [
    {
      icon: 'sliders' as const,
      label: 'Settings',
      actionId: 'open-settings',
      action: () => run(() => togglePanel(menuSurface, 'settings')),
      active: panel === 'settings',
      sectionLabel: 'Workspace & System',
    },
    ...(onOpenPalette
      ? [
          {
            icon: 'sparkles' as const,
            label: 'Command palette',
            actionId: 'open-palette',
            action: () => run(onOpenPalette),
          } satisfies MenuItem,
        ]
      : []),
    {
      icon: 'link' as const,
      label: engineSnapshot?.sessionState?.dirty
        ? 'Share link (carries your edits)'
        : 'Share link',
      actionId: 'share-link',
      action: () => run(() => void ui.handleShowCurrentLink()),
    },
    {
      icon: 'pulse' as const,
      label: hostingRoom ? 'Copy watch party link' : 'Start watch party',
      actionId: 'watch-party',
      action: () => run(handleWatchParty),
    },
    ...(hostingRoom
      ? [
          {
            icon: 'close' as const,
            label: 'End watch party',
            actionId: 'end-watch-party',
            action: () => run(() => endWatchParty(ui.setStatusMessage)),
          } satisfies MenuItem,
        ]
      : []),
  ];

  /** "Previous" -> "Previous (P)", and just "Previous" when unbound. */
  const withHint = (label: string, actionId: string) => {
    const hint = shortcutHintFor(actionId);
    return hint ? `${label} (${hint})` : label;
  };

  /**
   * The dock menu lists the same actions the command palette does, so it
   * teaches the same keys. Resolved per render through the registry rather
   * than baked in, so a rebind is reflected here too.
   */
  const MenuHint = ({ actionId }: { actionId: string }) => {
    const hint = shortcutHintFor(actionId);
    if (!hint) return null;
    return <kbd className={styles.menuHint}>{hint}</kbd>;
  };

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
          item.actionId ? ariaKeyShortcutsFor(item.actionId) : undefined
        }
        onClick={item.action}
      >
        <UiIcon
          name={item.icon}
          className="stims-icon-slot stims-icon-slot--sm"
        />
        <span>{item.label}</span>
        {item.actionId ? <MenuHint actionId={item.actionId} /> : null}
      </button>
    </div>
  );

  return (
    <>
      <div className={styles.bar} data-visible={String(visible)}>
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
            aria-label="Previous preset"
            title={withHint('Previous', 'previous-preset')}
            aria-keyshortcuts={ariaKeyShortcutsFor('previous-preset')}
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
            aria-label="Play a preset that looks like this one"
            title={withHint('Nearby', 'nearby-preset')}
            aria-keyshortcuts={ariaKeyShortcutsFor('nearby-preset')}
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
            aria-label="Shuffle to random preset"
            title={withHint('Surprise me', 'next-preset')}
            aria-keyshortcuts={ariaKeyShortcutsFor('next-preset')}
            onClick={handleShuffle}
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>

          {/* Opens the ladder rather than cycling it. A four-state cycle
              needed up to three clicks to reach a rung, could not go back,
              and printed the nearest rung — "2s" while the engine held 2.5s.
              The trigger now prints the engine's actual value and the popover
              is the same radio row the overflow menu already draws. */}
          <button
            ref={transitionBtnRef}
            type="button"
            className={styles.transitionBtn}
            data-action="transition-menu"
            aria-haspopup="menu"
            aria-expanded={showTransitionMenu}
            aria-label={`Transition: ${transitionLabel}. Choose a duration.`}
            title={`Transition: ${transitionLabel}`}
            onClick={() => {
              signalActivity();
              pulseHaptic(10);
              setShowTransitionMenu((open) => !open);
            }}
          >
            <span className={styles.transitionBtnText}>
              {transitionShortLabel}
            </span>
          </button>

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
                ? `${presetTitle}. Browse presets. ${shaderApproximation.detail}`
                : `${presetTitle}. Browse presets`
            }
            title={
              shaderApproximation
                ? `${withHint('Browse presets', 'open-browse')}\n\n${shaderApproximation.detail}`
                : withHint('Browse presets', 'open-browse')
            }
            aria-keyshortcuts={ariaKeyShortcutsFor('open-browse')}
            onClick={handleBrowse}
          >
            <span className={styles.titleText}>{presetTitle}</span>
            {playbackPaused ? (
              <span className={styles.statusText} data-static="true">
                Paused
              </span>
            ) : transition.phase === 'loading' ? (
              <span className={styles.statusText}>Loading…</span>
            ) : transition.phase === 'blending' ? (
              <span className={styles.statusText}>Blending…</span>
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
              title={withHint(
                presetSaved ? 'Remove from saved' : 'Save preset',
                'save-preset',
              )}
              aria-keyshortcuts={ariaKeyShortcutsFor('save-preset')}
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
              aria-label={playbackPaused ? 'Resume' : 'Pause'}
              title={withHint(
                playbackPaused ? 'Resume' : 'Pause',
                'toggle-playback',
              )}
              aria-keyshortcuts={ariaKeyShortcutsFor('toggle-playback')}
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
            title={withHint(
              isFullscreen ? 'Exit full screen' : 'Full screen',
              'toggle-fullscreen',
            )}
            aria-keyshortcuts={ariaKeyShortcutsFor('toggle-fullscreen')}
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
            title="More actions"
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

      {showTransitionMenu ? (
        <div
          ref={transitionMenuRef}
          className={styles.popover}
          role="menu"
          aria-label="Transition"
          data-menu="transition"
          style={
            transitionAnchor
              ? {
                  left: `${transitionAnchor.left}px`,
                  bottom: `${transitionAnchor.bottom}px`,
                }
              : undefined
          }
        >
          <span className={styles.menuGroupLabel} aria-hidden="true">
            Transition
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
                  className={styles.menuOption}
                  data-action={transitionActionId(step)}
                  data-active={String(checked)}
                  onClick={() => {
                    signalActivity();
                    pulseHaptic(10);
                    setShowTransitionMenu(false);
                    transitionBtnRef.current?.focus();
                    setTransition(
                      engine,
                      ui.setStatusMessage,
                      step.mode,
                      step.seconds,
                    );
                  }}
                >
                  {step.mode === 'cut'
                    ? 'Cut'
                    : `${formatSeconds(step.seconds)}s`}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
          aria-label="More actions"
        >
          {/* Two columns from 640px up, one below. As a single column of 26
              items the menu was 1186px tall in a 694px viewport: it scrolled
              at every common desktop height, and the two routes to everything
              it does not list — Settings and the palette — were the last two
              items. Reading order is the same in both layouts: what to play,
              how it plays, then the workspace, display, and studio tools. */}
          <div className={styles.menuColumn}>
            {presetItems.map(renderMenuItem)}

            <div className={styles.menuSep} />
            <div className={styles.menuLabel} aria-hidden="true">
              Live VJ & Audio
            </div>
            {/* Direct picks, not a cycle: mid-set there is no time to click
              through the ladder to reach the rung you want. Marked by the
              same exact rule as the popover; when Settings holds a value
              off this ladder the label carries it, because on a phone this
              menu is the only place the transition is shown at all. */}
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
            {workspaceItems.map(renderMenuItem)}
            <div className={styles.menuSep} />
            {displayItems.map(renderMenuItem)}
            <div className={styles.menuSep} />
            {studioItems.map(renderMenuItem)}
          </div>
        </div>
      ) : null}

      {/* Always mounted, never conditional. The handle and the transport are
          two states of one control, and rendering the handle only while
          `visible` is false let both occupy the same patch of screen at once:
          the bar takes 300ms to fade out, the handle appeared instantly, and
          for that window the preset title sat underneath the word "Controls".
          Driving both from the same flag lets the CSS hand off cleanly — the
          incoming one waits for the outgoing one to clear. */}
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
    </>
  );
}
