import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/MobileControlBar.module.css';
import { useWorkspace } from './workspace-context';
import { UiIcon } from './workspace-ui';

type MobileControlBarProps = {
  audioEnergy: number;
  presetTitle: string;
  presetAuthor: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme?: () => void;
};

export function MobileControlBar({
  audioEnergy,
  presetTitle,
  presetAuthor,
  isFullscreen,
  onToggleFullscreen,
  onToggleTheme,
}: MobileControlBarProps) {
  const { ui, engine } = useWorkspace();
  const panel = ui.routeState.panel;
  const [visible, setVisible] = useState(true);
  const [showMoods, setShowMoods] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const energyPercent = `${Math.min(100, Math.max(0, audioEnergy * 100)).toFixed(0)}%`;

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 4000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    const handleInteraction = () => resetHideTimer();

    document.addEventListener('touchstart', handleInteraction, {
      passive: true,
    });
    document.addEventListener('click', handleInteraction);

    return () => {
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('click', handleInteraction);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const handleBrowse = useCallback(() => {
    resetHideTimer();
    ui.updatePanel(panel === 'browse' ? null : 'browse');
  }, [ui, panel, resetHideTimer]);

  const handleSettings = useCallback(() => {
    resetHideTimer();
    ui.updatePanel(panel === 'settings' ? null : 'settings');
  }, [ui, panel, resetHideTimer]);

  const handleShuffle = useCallback(() => {
    resetHideTimer();
    void engine.handleShufflePreset();
  }, [engine, resetHideTimer]);

  const handleShare = useCallback(() => {
    resetHideTimer();
    void ui.handleShowCurrentLink();
  }, [ui, resetHideTimer]);

  const handleFullscreen = useCallback(() => {
    resetHideTimer();
    onToggleFullscreen();
  }, [onToggleFullscreen, resetHideTimer]);

  const handleTheme = useCallback(() => {
    resetHideTimer();
    onToggleTheme?.();
  }, [onToggleTheme, resetHideTimer]);

  const handleMoodGenerate = useCallback(
    (mood: { label: string; desc: string }) => {
      resetHideTimer();
      fetch('/api/generate-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${mood.desc} ${mood.label.toLowerCase()} visualizer preset`,
          complexity: 'moderate',
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.milkSource) {
            document.dispatchEvent(
              new CustomEvent('stims:editor:source-change', {
                detail: {
                  source: data.milkSource,
                  title: data.title || mood.label,
                },
              }),
            );
          }
        });
    },
    [resetHideTimer],
  );

  const moods = [
    { label: 'Chill', desc: 'slow drifting ambient', icon: '\uD83C\uDF0A' },
    { label: 'Aggressive', desc: 'fast intense heavy', icon: '\u26A1' },
    { label: 'Retro', desc: 'classic geometric 90s', icon: '\uD83D\uDCFA' },
    { label: 'Cosmic', desc: 'space nebula starfield', icon: '\u2728' },
  ];

  return (
    <div className={styles.bar} data-visible={String(visible)}>
      <div className={styles.energyMeter} style={{ width: energyPercent }} />
      {presetTitle ? (
        <div className={styles.nowPlaying}>
          <span className={styles.nowPlayingTitle}>{presetTitle}</span>
          {presetAuthor ? (
            <span className={styles.nowPlayingAuthor}>{presetAuthor}</span>
          ) : null}
        </div>
      ) : null}
      {showMoods && (
        <fieldset className="mc-bar__mood-row" aria-label="Mood presets">
          {moods.map((mood) => (
            <button
              key={mood.label}
              type="button"
              className="mc-bar__mood-btn"
              onClick={() => handleMoodGenerate(mood)}
            >
              <span className="mc-bar__mood-icon">{mood.icon}</span>
              <span className="mc-bar__mood-label">{mood.label}</span>
            </button>
          ))}
        </fieldset>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          data-active={String(panel === 'browse')}
          onClick={handleBrowse}
          aria-label="Browse presets"
        >
          <UiIcon
            name="sparkles"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          <span className={styles.actionLabel}>Browse</span>
        </button>
        <button
          type="button"
          className={styles.action}
          data-active={String(panel === 'settings')}
          onClick={handleSettings}
          aria-label="Style settings"
        >
          <UiIcon
            name="sliders"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          <span className={styles.actionLabel}>Style</span>
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={handleShuffle}
          aria-label="Surprise me"
        >
          <UiIcon
            name="pulse"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          <span className={styles.actionLabel}>Surprise</span>
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={handleFullscreen}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
        >
          <UiIcon
            name="expand"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          <span className={styles.actionLabel}>
            {isFullscreen ? 'Exit' : 'Full'}
          </span>
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={handleShare}
          aria-label="Share link"
        >
          <UiIcon name="link" className="stims-icon-slot stims-icon-slot--sm" />
          <span className={styles.actionLabel}>Share</span>
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            resetHideTimer();
            setShowMoods((s) => !s);
          }}
          aria-label="Mood presets"
        >
          <UiIcon
            name="sparkles"
            className="stims-icon-slot stims-icon-slot--sm"
          />
          <span className={styles.actionLabel}>
            {showMoods ? 'Close' : 'Vibe'}
          </span>
        </button>
        {onToggleTheme ? (
          <button
            type="button"
            className={styles.action}
            onClick={handleTheme}
            aria-label="Toggle theme"
          >
            <UiIcon
              name="moon"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Theme</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
