import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/MobileControlBar.module.css';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context';

const moods = [
  { label: 'Chill', desc: 'slow drifting ambient', icon: '\uD83C\uDF0A' },
  { label: 'Aggressive', desc: 'fast intense heavy', icon: '\u26A1' },
  { label: 'Retro', desc: 'classic geometric 90s', icon: '\uD83D\uDCFA' },
  { label: 'Cosmic', desc: 'space nebula starfield', icon: '\u2728' },
];

const MOBILE_CONTROL_IDLE_MS = 12_000;

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
  onToggleTheme: _onToggleTheme,
}: MobileControlBarProps) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const panel = ui.routeState.panel;
  const [visible, setVisible] = useState(true);
  const [showMoods, setShowMoods] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodAbortRef = useRef<AbortController | null>(null);
  const similarAbortRef = useRef<AbortController | null>(null);
  const energyPercent = `${Math.min(100, Math.max(0, audioEnergy * 100)).toFixed(0)}%`;

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setVisible(false),
      MOBILE_CONTROL_IDLE_MS,
    );
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

  const handleSimilar = useCallback(async () => {
    resetHideTimer();
    const canvas = document.querySelector(
      '#stims-main canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    similarAbortRef.current?.abort();
    const controller = new AbortController();
    similarAbortRef.current = controller;
    try {
      const results = await searchByFrame(canvas, controller.signal);
      if (controller.signal.aborted) return;
      if (results.length > 0) {
        engine.handlePresetSelection(results[0].presetId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [engine, resetHideTimer]);

  const handleEditor = useCallback(() => {
    resetHideTimer();
    ui.updatePanel(panel === 'editor' ? null : 'editor');
  }, [ui, panel, resetHideTimer]);

  const handleShare = useCallback(() => {
    resetHideTimer();
    void ui.handleShowCurrentLink();
  }, [ui, resetHideTimer]);

  const handleFullscreen = useCallback(() => {
    resetHideTimer();
    onToggleFullscreen();
  }, [onToggleFullscreen, resetHideTimer]);

  const handleMoodGenerate = useCallback(
    (mood: { label: string; desc: string }) => {
      resetHideTimer();
      moodAbortRef.current?.abort();
      const controller = new AbortController();
      moodAbortRef.current = controller;
      fetch('/api/generate-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${mood.desc} ${mood.label.toLowerCase()} visualizer preset`,
          complexity: 'moderate',
        }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          if (data.milkSource) {
            document.dispatchEvent(
              new CustomEvent('stims:editor:source-change', {
                detail: {
                  source: data.milkSource,
                  title: data.title || mood.label,
                },
              }),
            );
            ui.updatePanel('editor');
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
        });
    },
    [resetHideTimer, ui],
  );

  return (
    <>
      <div className={styles.bar} data-visible={String(visible)}>
        {/* biome-ignore lint/a11y/useSemanticElements: custom visual div designed specifically for visual status/metering */}
        <div
          className={styles.energyMeter}
          style={{ width: energyPercent }}
          role="meter"
          aria-label="Audio energy level"
          aria-valuenow={Math.round(audioEnergy * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
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
                aria-label={`Generate ${mood.label.toLowerCase()} preset`}
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
            aria-expanded={panel === 'browse'}
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
            aria-expanded={panel === 'settings'}
            onClick={handleSettings}
            aria-label="Settings panel"
          >
            <UiIcon
              name="sliders"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Settings</span>
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={handleShuffle}
            aria-label="Shuffle preset"
          >
            <UiIcon
              name="shuffle"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Shuffle</span>
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={handleSimilar}
            aria-label="Find similar presets"
          >
            <UiIcon
              name="eye"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>More</span>
          </button>
          <button
            type="button"
            className={styles.action}
            data-active={String(panel === 'editor')}
            aria-expanded={panel === 'editor'}
            onClick={handleEditor}
            aria-label="Edit preset code"
          >
            <UiIcon
              name="gauge"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Edit</span>
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              resetHideTimer();
              const nextShowMoods = !showMoods;
              setShowMoods(nextShowMoods);
              if (nextShowMoods) {
                ui.updatePanel(null);
              }
            }}
            aria-label="Generate from mood"
          >
            <UiIcon
              name="wand"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Generate</span>
          </button>
          {engineSnapshot?.audioSource ? (
            <button
              type="button"
              className={styles.action}
              aria-label="Stop audio"
              title="Stop audio"
              onClick={engine.handleAudioStop}
            >
              <UiIcon
                name="close"
                className="stims-icon-slot stims-icon-slot--sm"
              />
              <span className={styles.actionLabel}>Stop</span>
            </button>
          ) : null}
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
            <UiIcon
              name="link"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>Share</span>
          </button>
        </div>
      </div>
      {!visible ? (
        <button
          type="button"
          className={styles.handle}
          aria-label="Show controls"
          onClick={() => {
            resetHideTimer();
          }}
        >
          <span aria-hidden="true">^</span>
          <span className={styles.handleLabel}>Controls</span>
        </button>
      ) : null}
    </>
  );
}
