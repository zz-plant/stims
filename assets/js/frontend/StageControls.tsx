import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/StageControls.module.css';
import { useAudioEnergy } from './hooks/useAudioEnergy.ts';
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
  const audioEnergy = useAudioEnergy();
  const panel = ui.routeState.panel;

  const presetTitle =
    engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? '';
  const presetAuthor =
    engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? '';

  const { visible, signalActivity } = useAutoHideActivity(3000, true);
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const energyNorm = Math.min(1, Math.max(0, audioEnergy));

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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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

  const handleBrowse = useCallback(() => {
    signalActivity();
    ui.updatePanel(panel === 'browse' ? null : 'browse');
  }, [ui, panel, signalActivity]);

  const handleSettings = useCallback(() => {
    signalActivity();
    ui.updatePanel(panel === 'settings' ? null : 'settings');
  }, [ui, panel, signalActivity]);

  const handleShuffle = useCallback(() => {
    signalActivity();
    void engine.handleShufflePreset();
  }, [engine, signalActivity]);

  const handlePrevious = useCallback(() => {
    signalActivity();
    void engine.handlePreviousPreset();
  }, [engine, signalActivity]);

  const handleFullscreen = useCallback(() => {
    signalActivity();
    onToggleFullscreen();
  }, [onToggleFullscreen, signalActivity]);

  const handleEditor = useCallback(() => {
    signalActivity();
    setShowOverflow(false);
    ui.updatePanel(panel === 'editor' ? null : 'editor');
  }, [ui, panel, signalActivity]);

  const handleShare = useCallback(() => {
    signalActivity();
    setShowOverflow(false);
    void ui.handleShowCurrentLink();
  }, [ui, signalActivity]);

  const handleMore = useCallback(() => {
    signalActivity();
    setShowOverflow((s) => !s);
  }, [signalActivity]);

  const handleVisualSearch = useCallback(() => {
    signalActivity();
    void engine.handleVisualSearch?.();
  }, [engine, signalActivity]);

  const handleRefine = useCallback(() => {
    signalActivity();
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
            <span
              className={styles.nowPlayingBar}
              style={{ '--stims-energy': energyNorm } as React.CSSProperties}
            />
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
          <button
            type="button"
            className={styles.btn}
            aria-label="More like this"
            title="More like this"
            onClick={handleVisualSearch}
          >
            <UiIcon
              name="eye"
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
              data-active={String(panel === 'browse')}
              aria-label="Browse presets"
              title="Browse"
              onClick={handleBrowse}
            >
              <UiIcon
                name="sparkles"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Browse</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.btn}
              data-active={String(panel === 'settings')}
              aria-label="Settings"
              title="Settings"
              onClick={handleSettings}
            >
              <UiIcon
                name="sliders"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.btnLabel}>Settings</span>
            </button>
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