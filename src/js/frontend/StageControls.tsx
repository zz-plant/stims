import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/StageControls.module.css';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { pulseHaptic } from './haptics.ts';
import { useAutoHideActivity } from './hooks/useAutoHideActivity.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

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
  const [showOverflow, setShowOverflow] = useState(false);
  const nowPlayingBarRef = useRef<HTMLSpanElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updateEnergyBar = () => {
      nowPlayingBarRef.current?.style.setProperty(
        '--stims-energy',
        String(Math.min(1, Math.max(0, getAudioEnergy()))),
      );
    };

    updateEnergyBar();
    return subscribeAudioEnergy(updateEnergyBar);
  }, []);

  // Close overflow on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        overflowRef.current?.contains(event.target)
      ) {
        return;
      }
      setShowOverflow(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showOverflow]);

  // Close overflow on Escape
  useEffect(() => {
    if (!showOverflow) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowOverflow(false);
        moreBtnRef.current?.focus();
      }
    };
    const handleResize = () => setShowOverflow(false);
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
  }, [showOverflow]);

  // Re-show controls on any interaction
  useEffect(() => {
    const handleActivity = () => signalActivity();
    document.addEventListener('mousemove', handleActivity, { passive: true });
    document.addEventListener('pointerdown', handleActivity, { passive: true });
    document.addEventListener('pointermove', handleActivity, { passive: true });
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'g':
          event.preventDefault();
          ui.updatePanel(panel === 'refine' ? null : 'refine');
          break;
        case 'm':
          event.preventDefault();
          engine.handleVisualSearch?.();
          break;
        case 'r':
          event.preventDefault();
          ui.updatePanel(panel === 'refine' ? null : 'refine');
          break;
        case 'b':
          event.preventDefault();
          ui.updatePanel(panel === 'browse' ? null : 'browse');
          break;
        case 'i':
          event.preventDefault();
          ui.updatePanel(panel === 'inspector' ? null : 'inspector');
          break;
        case ' ':
          if (engineSnapshot?.audioSource) {
            event.preventDefault();
            engine.handleAudioStop();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [engine, engineSnapshot?.audioSource, panel, ui]);

  const handleBrowse = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    ui.updatePanel(panel === 'browse' ? null : 'browse');
  }, [ui, panel, signalActivity]);

  const handleSettings = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    ui.updatePanel(panel === 'settings' ? null : 'settings');
  }, [ui, panel, signalActivity]);

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

  const handleFullscreen = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    onToggleFullscreen();
  }, [onToggleFullscreen, signalActivity]);

  const handleEditor = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow(false);
    ui.updatePanel(panel === 'editor' ? null : 'editor');
  }, [ui, panel, signalActivity]);

  const handleShare = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow(false);
    void ui.handleShowCurrentLink();
  }, [ui, signalActivity]);

  const handleCapture = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow(false);
    ui.updatePanel(panel === 'capture' ? null : 'capture');
  }, [ui, panel, signalActivity]);

  const handleSynthesize = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow(false);
    ui.updatePanel(panel === 'synthesize' ? null : 'synthesize');
  }, [ui, panel, signalActivity]);

  const handleMore = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow((s) => !s);
  }, [signalActivity]);

  const handleVisualSearch = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    void engine.handleVisualSearch?.();
  }, [engine, signalActivity]);

  const handleAudioMatch = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    ui.updatePanel(panel === 'audiomatch' ? null : 'audiomatch');
  }, [ui, panel, signalActivity]);

  const handleRefine = useCallback(() => {
    signalActivity();
    pulseHaptic(10);
    setShowOverflow(false);
    ui.updatePanel(panel === 'refine' ? null : 'refine');
  }, [ui, panel, signalActivity]);

  return (
    <>
      <div
        className={styles.wrap}
        data-visible={String(visible)}
        onPointerEnter={() => signalActivity()}
      >
        {presetTitle ? (
          <div className={styles.nowPlaying}>
            <span className={styles.nowPlayingTitle}>{presetTitle}</span>
            {presetAuthor ? (
              <span className={styles.nowPlayingAuthor}>{presetAuthor}</span>
            ) : null}
            <span ref={nowPlayingBarRef} className={styles.nowPlayingBar} />
          </div>
        ) : null}
        <div className={styles.toolbar} role="toolbar" aria-label="Controls">
          <button
            type="button"
            className={styles.btn}
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
            className={styles.btn}
            aria-label="Shuffle to random preset"
            title="Surprise me"
            onClick={handleShuffle}
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>

          <span className={styles.sep} aria-hidden="true" />

          <button
            type="button"
            className={styles.btn}
            data-active={String(panel === 'browse')}
            aria-expanded={panel === 'browse'}
            aria-label="Browse presets"
            title="Browse presets"
            onClick={handleBrowse}
          >
            <UiIcon
              name="sparkles"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          <button
            type="button"
            className={styles.btn}
            data-active={String(panel === 'visualsearch')}
            aria-expanded={panel === 'visualsearch'}
            aria-label="More like this"
            title="More like this"
            onClick={handleVisualSearch}
          >
            <UiIcon
              name="eye"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          {engineSnapshot?.audioActive ? (
            <button
              type="button"
              className={styles.btn}
              data-active={String(panel === 'audiomatch')}
              aria-expanded={panel === 'audiomatch'}
              aria-label="Match my music"
              title="Match my music"
              onClick={handleAudioMatch}
            >
              <UiIcon
                name="pulse"
                className="stims-icon-slot stims-icon-slot--sm"
              />
            </button>
          ) : null}

          <span className={styles.sep} aria-hidden="true" />

          <button
            type="button"
            className={styles.btn}
            data-active={String(panel === 'settings')}
            aria-expanded={panel === 'settings'}
            aria-label="Settings"
            title="Settings"
            onClick={handleSettings}
          >
            <UiIcon
              name="sliders"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          <button
            type="button"
            className={styles.btn}
            aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={handleFullscreen}
          >
            <UiIcon
              name="expand"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
          <button
            ref={moreBtnRef}
            type="button"
            className={styles.btn}
            aria-expanded={showOverflow}
            aria-haspopup="menu"
            aria-label="More actions"
            title="More"
            onClick={handleMore}
          >
            <UiIcon
              name="menu"
              className="stims-icon-slot stims-icon-slot--sm"
            />
          </button>
        </div>
        {showOverflow ? (
          <div
            ref={overflowRef}
            className={styles.overflow}
            role="menu"
            aria-label="More actions"
          >
            {engineSnapshot?.audioSource ? (
              <button
                type="button"
                role="menuitem"
                className={styles.btn}
                aria-label="Stop audio"
                title="Stop"
                onClick={() => {
                  signalActivity();
                  setShowOverflow(false);
                  engine.handleAudioStop();
                }}
              >
                <UiIcon
                  name="close"
                  className="stims-icon-slot stims-icon-slot--sm"
                />
                <span className={styles.btnLabel}>Stop</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              data-active={String(panel === 'editor')}
              aria-label="Edit preset code"
              title="Edit"
              onClick={handleEditor}
            >
              <UiIcon
                name="gauge"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Edit</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              data-active={String(panel === 'refine')}
              aria-label="Refine this preset"
              title="Refine"
              onClick={handleRefine}
            >
              <UiIcon
                name="wand"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Refine</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              data-active={String(panel === 'synthesize')}
              aria-label="Generate a visualizer from a description"
              title="Generate"
              onClick={handleSynthesize}
            >
              <UiIcon
                name="wand"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Generate</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              data-active={String(panel === 'capture')}
              aria-label="Record visualizer video"
              title="Record video"
              onClick={handleCapture}
            >
              <UiIcon
                name="image"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Record video</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              aria-label="Share link"
              title="Share"
              onClick={handleShare}
            >
              <UiIcon
                name="link"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Share</span>
            </button>
          </div>
        ) : null}
      </div>

      {!visible ? (
        <button
          type="button"
          className={styles.handle}
          aria-label="Show controls"
          onClick={() => signalActivity()}
        >
          <span className={styles.handleIcon} aria-hidden="true">
            {'⌃'}
          </span>
          Controls
        </button>
      ) : null}
    </>
  );
}
