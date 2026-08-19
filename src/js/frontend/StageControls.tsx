import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import styles from '../../css/StageControls.module.css';
import type { UiIconName } from '../ui/icon-library.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { pulseHaptic } from './haptics.ts';
import { useListKeyboardNav } from './hooks/use-list-keyboard-nav.ts';
import { useAutoHideActivity } from './hooks/useAutoHideActivity.ts';
import { usePictureInPicture } from './hooks/usePictureInPicture.ts';
import { usePresetTransition } from './hooks/usePresetTransition.ts';
import { getSyncSessionState, subscribeSyncSession } from './sync-session.ts';
import { UiIcon } from './UiIcon.tsx';
import {
  endWatchParty,
  openRecordPanel,
  setTransition,
  startAudioSource,
  startOrCopyWatchPartyAction,
  togglePanel,
} from './workspace-actions.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type MenuItem = {
  icon: UiIconName;
  label: string;
  action: () => void;
  active?: boolean;
  separatorBefore?: boolean;
  // Short group header rendered above the item (implies a separator).
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
 */
const TRANSITION_STEPS = [
  { mode: 'cut' as const, seconds: 0 },
  { mode: 'blend' as const, seconds: 1 },
  { mode: 'blend' as const, seconds: 2 },
  { mode: 'blend' as const, seconds: 5 },
];

function describeTransitionStep(step: (typeof TRANSITION_STEPS)[number]) {
  return step.mode === 'cut' ? 'Instant cut' : `Blend ${step.seconds}s`;
}

/** Nearest ladder rung to what the engine currently holds, so the marked
 * option reflects where the user actually is even when Settings set an
 * off-ladder duration like 3s or 8s. */
function findTransitionStepIndex(
  mode: 'blend' | 'cut',
  seconds: number,
): number {
  if (mode === 'cut') return 0;
  let best = 1;
  for (let i = 1; i < TRANSITION_STEPS.length; i += 1) {
    const step = TRANSITION_STEPS[i];
    if (
      Math.abs(step.seconds - seconds) <
      Math.abs(TRANSITION_STEPS[best].seconds - seconds)
    ) {
      best = i;
    }
  }
  return best;
}

/**
 * The sources worth one-click access mid-set. YouTube and file playback need
 * a URL or a picker, so they stay in the audio setup panel; these three start
 * (or fail with a useful message) straight from the menu.
 */
const AUDIO_SOURCE_OPTIONS = [
  { source: 'demo' as const, shortLabel: 'Demo', name: 'Demo audio' },
  { source: 'microphone' as const, shortLabel: 'Mic', name: 'Microphone' },
  { source: 'tab' as const, shortLabel: 'Tab', name: 'This tab' },
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
  const transitionStepIndex = findTransitionStepIndex(
    engineSnapshot?.transitionMode ?? 'blend',
    engineSnapshot?.blendDuration ?? 2,
  );

  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';
  const currentPresetId =
    engine.selectedPreset?.id ?? engine.featuredPreset?.id ?? null;
  // favoritePresets is the store-derived list, so it stays fresh across
  // toggles even if the selectedPreset entry object is a stale snapshot.
  const presetSaved =
    currentPresetId !== null &&
    engine.favoritePresets.some((preset) => preset.id === currentPresetId);

  const syncSession = useSyncExternalStore(
    subscribeSyncSession,
    getSyncSessionState,
  );
  const hostingRoom =
    syncSession.role === 'host' && syncSession.status !== 'idle'
      ? syncSession.room
      : null;

  const { visible, signalActivity } = useAutoHideActivity(3000, true);
  const transition = usePresetTransition();
  const pip = usePictureInPicture(ui.stageRef);
  const [showMenu, setShowMenu] = useState(false);
  const energyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

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
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowMenu(false);
        menuBtnRef.current?.focus();
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

  const libraryItems: MenuItem[] = [
    {
      icon: 'grid' as const,
      label: 'Browse presets',
      action: () => run(() => togglePanel(menuSurface, 'browse')),
      actionId: 'open-browse',
      active: panel === 'browse',
    },
    {
      // "More like this" and "Match my music" were two menu items opening two
      // panels that did the same job from different seeds. One entry now
      // opens the finder; it starts on the audio tab when there is audio to
      // profile and on the frame tab otherwise, and either tab is one click
      // away once open.
      icon: 'eye' as const,
      label: 'Find similar',
      actionId: 'find-similar',
      action: () => run(() => togglePanel(menuSurface, 'finder')),
      active: panel === 'finder',
    },
    {
      icon: 'sparkles' as const,
      label: 'Generate with AI',
      actionId: 'open-generate',
      action: () => run(() => togglePanel(menuSurface, 'synthesize')),
      active: panel === 'synthesize',
      separatorBefore: true,
      sectionLabel: 'Make your own',
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
      // Shared body (workspace-actions.ts): repeat use auto-starts with the
      // remembered format; the palette's "Record video" runs the same code.
      action: () => run(() => openRecordPanel(menuSurface)),
      active: panel === 'capture',
      separatorBefore: true,
    },
  ];

  // Rendered after the VJ Stage Controls radio groups (transition + audio
  // source), which are laid out inline in the JSX below because they are
  // rows of menuitemradio options rather than single-action items.
  const utilityItems: MenuItem[] = [
    {
      icon: 'link' as const,
      label: 'Share link',
      actionId: 'share-link',
      action: () => run(() => void ui.handleShowCurrentLink()),
    },
    {
      // One action: create the room (unless this tab already hosts one) and
      // put the invite link on the clipboard. Peer count still lives in
      // Settings → Watch together.
      icon: 'pulse' as const,
      label: hostingRoom ? 'Copy watch party link' : 'Start watch party',
      actionId: 'watch-party',
      action: () => run(handleWatchParty),
    },
    // Ending should be as close as starting was — symmetric with the item
    // above, shown only while this tab hosts.
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
    {
      icon: 'sliders' as const,
      label: 'Settings',
      actionId: 'open-settings',
      action: () => run(() => togglePanel(menuSurface, 'settings')),
      active: panel === 'settings',
      separatorBefore: true,
    },
    {
      icon: 'expand' as const,
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
      actionId: 'toggle-fullscreen',
      action: () => run(() => onToggleFullscreen()),
    },
    // Absent on browsers without the Picture-in-Picture API (a synchronous
    // support check, unlike a device probe).
    ...(pip.supported
      ? [
          {
            icon: 'picture-in-picture' as const,
            label: pip.active
              ? 'Exit picture in picture'
              : 'Picture in picture',
            actionId: 'toggle-pip',
            // `run` invokes this synchronously inside the click handler, so
            // the PiP request still carries transient user activation.
            action: () => run(() => pip.toggle()),
            active: pip.active,
          },
        ]
      : []),
    ...(engineSnapshot?.audioSource
      ? [
          {
            icon: 'volume-off' as const,
            label: 'Stop audio',
            actionId: 'stop-audio',
            action: () => run(() => engine.handleAudioStop()),
            separatorBefore: true,
          },
        ]
      : []),
    // Discoverability for the palette: keyboard users find ⌘K, pointer users
    // find this. Hidden when App doesn't wire the palette (e.g. harnesses).
    ...(onOpenPalette
      ? [
          {
            icon: 'sparkles' as const,
            label: `Command palette (${
              typeof navigator !== 'undefined' &&
              /Mac|iPhone|iPad/.test(navigator.platform)
                ? '⌘K'
                : 'Ctrl+K'
            })`,
            actionId: 'open-palette',
            action: () => run(onOpenPalette),
            separatorBefore: true,
          } satisfies MenuItem,
        ]
      : []),
  ];

  const renderMenuItem = (item: MenuItem) => (
    <div key={item.label}>
      {item.separatorBefore ? <div className={styles.menuSep} /> : null}
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
        onClick={item.action}
      >
        <UiIcon
          name={item.icon}
          className="stims-icon-slot stims-icon-slot--sm"
        />
        <span>{item.label}</span>
      </button>
    </div>
  );

  return (
    <>
      <div
        className={styles.bar}
        data-visible={String(visible)}
        onPointerEnter={() => signalActivity()}
      >
        <div
          ref={energyRef}
          className={styles.pill}
          data-transition={
            transition.phase !== 'idle' ? transition.phase : undefined
          }
        >
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
          <span className={styles.energyBar} aria-hidden="true" />
          <button
            type="button"
            className={styles.navBtn}
            data-action="previous-preset"
            aria-label="Previous preset"
            title="Previous"
            onClick={handlePrevious}
          >
            <UiIcon
              name="arrow-left"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          <button
            type="button"
            className={styles.navBtn}
            data-action="next-preset"
            aria-label="Shuffle to random preset"
            title="Surprise me"
            onClick={handleShuffle}
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>

          <button
            type="button"
            className={styles.titleBtn}
            data-action="open-browse"
            data-active={String(panel === 'browse')}
            aria-label="Browse presets"
            onClick={handleBrowse}
          >
            <span className={styles.titleText}>{presetTitle}</span>
            {transition.phase === 'loading' ? (
              <span className={styles.statusText}>Loading…</span>
            ) : transition.phase === 'blending' ? (
              <span className={styles.statusText}>Blending…</span>
            ) : presetAuthor ? (
              <span className={styles.authorText}>{presetAuthor}</span>
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
              title={presetSaved ? 'Remove from saved' : 'Save preset'}
              onClick={handleToggleSave}
            >
              <UiIcon
                name="star"
                className="stims-icon-slot stims-icon-slot--sm"
              />
            </button>
          ) : null}

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

      {showMenu ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="More actions"
        >
          {libraryItems.map(renderMenuItem)}

          <div className={styles.menuSep} />
          <div className={styles.menuLabel} aria-hidden="true">
            VJ Stage Controls
          </div>
          {/* Direct picks, not a cycle: mid-set there is no time to click
              through the ladder to reach the rung you want. The active rung
              is the nearest one to what the engine holds, so an off-ladder
              Settings duration still shows a sensible mark. */}
          {/* biome-ignore lint/a11y/useSemanticElements: role=group is the ARIA menu pattern for menuitemradio sets; fieldset carries form semantics a menu must not have */}
          <div
            className={styles.menuGroup}
            role="group"
            aria-label="Transition"
          >
            <span className={styles.menuGroupLabel} aria-hidden="true">
              Transition
            </span>
            <div className={styles.menuGroupOptions}>
              {TRANSITION_STEPS.map((step, index) => (
                <button
                  key={describeTransitionStep(step)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={index === transitionStepIndex}
                  aria-label={`Transition: ${describeTransitionStep(step)}`}
                  className={styles.menuOption}
                  data-action={
                    step.mode === 'cut'
                      ? 'transition-cut'
                      : `transition-${step.seconds}s`
                  }
                  data-active={String(index === transitionStepIndex)}
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
                  {step.mode === 'cut' ? 'Cut' : `${step.seconds}s`}
                </button>
              ))}
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

          {utilityItems.map(renderMenuItem)}
        </div>
      ) : null}

      {!visible ? (
        <button
          type="button"
          className={styles.handle}
          aria-label="Show controls"
          title="Show controls"
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
      ) : null}
    </>
  );
}
