import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/StageControls.module.css';
import type { UiIconName } from '../ui/icon-library.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { pulseHaptic } from './haptics.ts';
import { useAutoHideActivity } from './hooks/useAutoHideActivity.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

type MenuItem = {
  icon: UiIconName;
  label: string;
  action: () => void;
  active?: boolean;
  separatorBefore?: boolean;
};

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

  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';

  const { visible, signalActivity } = useAutoHideActivity(3000, true);
  const [showMenu, setShowMenu] = useState(false);
  const energyRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    const handleActivity = () => signalActivity();
    document.addEventListener('mousemove', handleActivity, { passive: true });
    document.addEventListener('pointerdown', handleActivity, { passive: true });
    document.addEventListener('pointermove', handleActivity, {
      passive: true,
    });
    document.addEventListener('wheel', handleActivity, { passive: true });
    document.addEventListener('keydown', handleActivity);
    return () => {
      document.removeEventListener('mousemove', handleActivity);
      document.removeEventListener('pointerdown', handleActivity);
      document.removeEventListener('pointermove', handleActivity);
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
      icon: 'eye' as const,
      label: 'More like this',
      action: () => run(() => void engine.handleVisualSearch?.()),
    },
    ...(engineSnapshot?.audioActive
      ? [
          {
            icon: 'pulse' as const,
            label: 'Match my music',
            action: () =>
              run(() =>
                ui.updatePanel(panel === 'audiomatch' ? null : 'audiomatch'),
              ),
            active: panel === 'audiomatch',
          },
        ]
      : []),
    {
      icon: 'pencil' as const,
      label: 'Edit preset',
      action: () =>
        run(() => ui.updatePanel(panel === 'editor' ? null : 'editor')),
      active: panel === 'editor',
      separatorBefore: true,
    },
    {
      icon: 'wand' as const,
      label: 'Refine',
      action: () =>
        run(() => ui.updatePanel(panel === 'refine' ? null : 'refine')),
      active: panel === 'refine',
    },
    {
      icon: 'sparkles' as const,
      label: 'Generate',
      action: () =>
        run(() => ui.updatePanel(panel === 'synthesize' ? null : 'synthesize')),
      active: panel === 'synthesize',
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
        <div ref={energyRef} className={styles.pill}>
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
            {presetAuthor ? (
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
