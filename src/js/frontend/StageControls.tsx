import { useCallback, useEffect, useRef, useState } from 'react';
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
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type MenuItem = {
  icon: UiIconName;
  label: string;
  action: () => void;
  active?: boolean;
  separatorBefore?: boolean;
  // Short group header rendered above the item (implies a separator).
  sectionLabel?: string;
};

/**
 * The transition ladder the stage menu cycles through. A subset of the
 * durations Settings offers, chosen so one click always lands somewhere
 * useful mid-set rather than stepping through eight near-identical values.
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

/** Nearest ladder rung to what the engine currently holds, so cycling starts
 * from where the user actually is even when Settings set an off-ladder
 * duration like 3s or 8s. */
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

export function StageControls({
  isFullscreen,
  onToggleFullscreen,
}: {
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const panel = ui.routeState.panel;
  const transitionStepIndex = findTransitionStepIndex(
    engineSnapshot?.transitionMode ?? 'blend',
    engineSnapshot?.blendDuration ?? 2,
  );
  const transitionStep = TRANSITION_STEPS[transitionStepIndex];

  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';

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
    itemSelector: '[role="menuitem"], [role="menuitemcheckbox"]',
    orientation: 'vertical',
    deps: [showMenu],
  });

  useEffect(() => {
    if (!showMenu) return;
    const firstItem = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"], [role="menuitemcheckbox"]',
    );
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
    return () => {
      if (activityFrame !== null) cancelAnimationFrame(activityFrame);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerdown', handleActivity);
      document.removeEventListener('wheel', handleActivity);
      document.removeEventListener('keydown', handleActivity);
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

  const run = useCallback(
    (fn: () => void) => {
      signalActivity();
      pulseHaptic(10);
      setShowMenu(false);
      fn();
    },
    [signalActivity],
  );

  const menuItems: MenuItem[] = [
    {
      icon: 'grid' as const,
      label: 'Browse presets',
      action: () =>
        run(() => ui.updatePanel(panel === 'browse' ? null : 'browse')),
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
      action: () =>
        run(() => {
          const target = engineSnapshot?.audioActive
            ? 'audiomatch'
            : 'visualsearch';
          ui.updatePanel(
            panel === 'audiomatch' || panel === 'visualsearch' ? null : target,
          );
        }),
      active: panel === 'audiomatch' || panel === 'visualsearch',
    },
    {
      icon: 'sparkles' as const,
      label: 'Generate with AI',
      action: () =>
        run(() => ui.updatePanel(panel === 'synthesize' ? null : 'synthesize')),
      active: panel === 'synthesize',
      separatorBefore: true,
      sectionLabel: 'Make your own',
    },
    {
      icon: 'wand' as const,
      label: 'Refine with AI',
      action: () =>
        run(() => ui.updatePanel(panel === 'refine' ? null : 'refine')),
      active: panel === 'refine',
    },
    {
      icon: 'pencil' as const,
      label: 'Edit preset code',
      action: () =>
        run(() => ui.updatePanel(panel === 'editor' ? null : 'editor')),
      active: panel === 'editor',
    },
    {
      icon: 'video' as const,
      label: 'Record video',
      action: () =>
        run(() => ui.updatePanel(panel === 'capture' ? null : 'capture')),
      active: panel === 'capture',
      separatorBefore: true,
    },
    {
      icon: 'sliders' as const,
      // One control that owns everything it displays. This used to toggle
      // mode only while printing a duration it had no way to change — the
      // duration lived in Settings, so the menu showed you a number and then
      // refused to do anything about it. Cycling the whole ladder keeps the
      // one-click speed a live set needs and makes the label honest.
      label: `Transition: ${describeTransitionStep(transitionStep)}`,
      action: () =>
        run(() => {
          const next =
            TRANSITION_STEPS[
              (transitionStepIndex + 1) % TRANSITION_STEPS.length
            ];
          engine.setTransitionMode(next.mode);
          if (next.mode === 'blend') {
            engine.setBlendDuration(next.seconds);
          }
          ui.setStatusMessage(`Transition: ${describeTransitionStep(next)}`);
        }),
      sectionLabel: 'VJ Stage Controls',
    },
    {
      icon: 'link' as const,
      label: 'Share link',
      action: () => run(() => void ui.handleShowCurrentLink()),
    },
    {
      icon: 'sliders' as const,
      label: 'Settings',
      action: () =>
        run(() => ui.updatePanel(panel === 'settings' ? null : 'settings')),
      active: panel === 'settings',
      separatorBefore: true,
    },
    {
      icon: 'expand' as const,
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
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
            action: () => run(() => engine.handleAudioStop()),
            separatorBefore: true,
          },
        ]
      : []),
  ];

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
          {menuItems.map((item) => (
            <div key={item.label}>
              {item.separatorBefore ? <div className={styles.menuSep} /> : null}
              {item.sectionLabel ? (
                <div className={styles.menuLabel} aria-hidden="true">
                  {item.sectionLabel}
                </div>
              ) : null}
              <button
                type="button"
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
          ))}
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
        </button>
      ) : null}
    </>
  );
}
