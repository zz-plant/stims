import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/MobileControlBar.module.css';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import { pulseHaptic } from './haptics.ts';
import { useMoodPresetGeneration } from './hooks/useMoodPresetGeneration.ts';
import { UiIcon } from './UiIcon.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context';

const moods = [
  { label: 'Chill', desc: 'slow drifting ambient', icon: '\uD83C\uDF0A' },
  { label: 'Aggressive', desc: 'fast intense heavy', icon: '\u26A1' },
  { label: 'Retro', desc: 'classic geometric 90s', icon: '\uD83D\uDCFA' },
  { label: 'Cosmic', desc: 'space nebula starfield', icon: '\u2728' },
];

const MOBILE_CONTROL_IDLE_MS = 4_000;
const MOBILE_MORE_ACTIONS_ID = 'mobile-control-more-actions';
const MOBILE_MOOD_ACTIONS_ID = 'mobile-control-mood-actions';

type MobileAction = {
  id: string;
  label: string;
  ariaLabel: string;
  icon:
    | 'arrow-left'
    | 'bookmark'
    | 'close'
    | 'expand'
    | 'eye'
    | 'gauge'
    | 'link'
    | 'shuffle'
    | 'sliders'
    | 'sparkles'
    | 'wand';
  active?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
};

type MobileControlBarProps = {
  audioEnergy: number;
  presetTitle: string;
  presetAuthor: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme?: () => void;
  thumbMode?: boolean;
  partyRemoteMode?: boolean;
  hapticsEnabled?: boolean;
};

export function MobileControlBar({
  audioEnergy,
  presetTitle,
  presetAuthor,
  isFullscreen,
  onToggleFullscreen,
  onToggleTheme: _onToggleTheme,
  thumbMode = false,
  partyRemoteMode = false,
  hapticsEnabled = true,
}: MobileControlBarProps) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const panel = ui.routeState.panel;
  const [visible, setVisible] = useState(true);
  const [showMoods, setShowMoods] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const similarAbortRef = useRef<AbortController | null>(null);
  const energyPercent = `${Math.min(100, Math.max(0, audioEnergy * 100)).toFixed(0)}%`;

  const {
    generatingMood,
    generate: generateMoodPreset,
    cancel: cancelMoodGeneration,
    retry: retryMoodGeneration,
    canRetry: canRetryMoodGeneration,
  } = useMoodPresetGeneration({
    offline: typeof navigator !== 'undefined' && !navigator.onLine,
    setStatusMessage: ui.setStatusMessage,
    openEditor: () => ui.updatePanel('editor'),
  });

  const keepBarVisible =
    showMoreActions || showMoods || generatingMood !== null;

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;

    if (keepBarVisible) return;

    hideTimer.current = setTimeout(
      () => setVisible(false),
      MOBILE_CONTROL_IDLE_MS,
    );
  }, [keepBarVisible]);

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
    pulseHaptic(12, hapticsEnabled);
    void engine.handleShufflePreset();
  }, [engine, hapticsEnabled, resetHideTimer]);

  const handlePrevious = useCallback(() => {
    resetHideTimer();
    pulseHaptic(12, hapticsEnabled);
    void engine.handlePreviousPreset();
  }, [engine, hapticsEnabled, resetHideTimer]);

  const handleSimilar = useCallback(async () => {
    resetHideTimer();
    const canvas = document.querySelector(
      '#stims-main canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) {
      ui.setStatusMessage('No visual frame available yet.');
      return;
    }
    similarAbortRef.current?.abort();
    const controller = new AbortController();
    similarAbortRef.current = controller;
    setSimilarLoading(true);
    try {
      const results = await searchByFrame(canvas, controller.signal);
      if (controller.signal.aborted) return;
      if (results.length > 0) {
        engine.handlePresetSelection(results[0].presetId);
      } else {
        ui.setStatusMessage('No similar presets found yet.');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      ui.setStatusMessage('Finding similar presets failed.');
    } finally {
      if (!controller.signal.aborted) setSimilarLoading(false);
    }
  }, [engine, resetHideTimer, ui]);

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
    pulseHaptic(10, hapticsEnabled);
    onToggleFullscreen();
  }, [hapticsEnabled, onToggleFullscreen, resetHideTimer]);

  const handleFavorite = useCallback(() => {
    resetHideTimer();
    const presetId = engineSnapshot?.activePresetId;
    if (!presetId) {
      ui.setStatusMessage('No preset is active yet.');
      return;
    }
    pulseHaptic(24, hapticsEnabled);
    const favorite = !engine.favoritePresets.some(
      (entry) => entry.id === presetId,
    );
    void engine.toggleFavoritePreset(presetId, favorite);
    ui.setStatusMessage(favorite ? 'Preset saved.' : 'Preset unsaved.');
  }, [
    engine,
    engineSnapshot?.activePresetId,
    hapticsEnabled,
    resetHideTimer,
    ui,
  ]);

  useEffect(() => {
    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(`.${styles.bar}`)
      ) {
        return;
      }
      setShowMoreActions(false);
      setShowMoods(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer, {
      passive: true,
    });
    return () =>
      document.removeEventListener('pointerdown', handleOutsidePointer);
  }, []);

  const handleMoodGenerate = useCallback(
    (mood: (typeof moods)[number]) => {
      resetHideTimer();
      setShowMoods(false);
      generateMoodPreset(mood);
    },
    [generateMoodPreset, resetHideTimer],
  );

  const favoriteActive = engine.favoritePresets.some(
    (entry) => entry.id === engineSnapshot?.activePresetId,
  );

  const mobileActions: MobileAction[] = [
    {
      id: 'favorite',
      label: favoriteActive ? 'Saved' : 'Save',
      ariaLabel: favoriteActive ? 'Remove saved preset' : 'Save current preset',
      icon: 'bookmark' as const,
      onClick: handleFavorite,
    },
    {
      id: 'browse',
      label: 'Browse',
      ariaLabel: 'Browse presets',
      icon: 'sparkles' as const,
      active: panel === 'browse',
      onClick: handleBrowse,
    },
    {
      id: 'shuffle',
      label: 'Shuffle',
      ariaLabel: 'Play a random preset',
      icon: 'shuffle' as const,
      onClick: handleShuffle,
    },
    {
      id: 'previous',
      label: 'Back',
      ariaLabel: 'Previous preset',
      icon: 'arrow-left' as const,
      onClick: handlePrevious,
    },
    {
      id: 'similar',
      label: similarLoading ? 'Searching…' : 'Similar',
      ariaLabel: 'Find similar presets',
      icon: 'eye' as const,
      disabled: similarLoading,
      onClick: handleSimilar,
    },
    {
      id: 'settings',
      label: 'Settings',
      ariaLabel: 'Settings panel',
      icon: 'sliders' as const,
      active: panel === 'settings',
      onClick: handleSettings,
    },
    {
      id: 'generate',
      label: 'Generate',
      ariaLabel: 'Generate from mood',
      icon: 'wand' as const,
      onClick: () => {
        resetHideTimer();
        const nextShowMoods = !showMoods;
        setShowMoods(nextShowMoods);
        if (nextShowMoods) {
          ui.updatePanel(null);
        }
      },
    },
    {
      id: 'fullscreen',
      label: isFullscreen ? 'Exit' : 'Full',
      ariaLabel: isFullscreen ? 'Exit full screen' : 'Full screen',
      icon: 'expand' as const,
      onClick: handleFullscreen,
    },
    {
      id: 'share',
      label: 'Share',
      ariaLabel: 'Share link',
      icon: 'link' as const,
      onClick: handleShare,
    },
    {
      id: 'editor',
      label: 'Edit',
      ariaLabel: 'Edit preset code',
      icon: 'gauge' as const,
      active: panel === 'editor',
      onClick: handleEditor,
    },
    ...(engineSnapshot?.audioSource
      ? [
          {
            id: 'stop',
            label: 'Stop',
            ariaLabel: 'Stop audio',
            icon: 'close' as const,
            onClick: engine.handleAudioStop,
          },
        ]
      : []),
  ];
  const primaryActionIds = thumbMode
    ? ['browse', 'shuffle', 'favorite', 'settings']
    : partyRemoteMode
      ? ['shuffle', 'favorite', 'fullscreen']
      : ['browse', 'shuffle', 'favorite', 'settings'];
  const primaryActions = mobileActions.filter((action) =>
    primaryActionIds.includes(action.id),
  );
  const overflowActions = mobileActions.filter(
    (action) => !primaryActionIds.includes(action.id),
  );

  // Accessibility guard: panel toggles must use aria-expanded={panel === ...}.
  const renderAction = (action: MobileAction) => (
    <button
      key={action.id}
      type="button"
      className={styles.action}
      data-active={String(Boolean(action.active))}
      aria-expanded={action.active === undefined ? undefined : action.active}
      onClick={action.onClick}
      aria-label={action.ariaLabel}
      disabled={action.disabled}
    >
      <UiIcon
        name={action.icon}
        className="stims-icon-slot stims-icon-slot--sm"
      />
      <span className={styles.actionLabel}>{action.label}</span>
    </button>
  );

  return (
    <>
      <div
        className={`${styles.bar} mc-bar`}
        data-visible={String(visible)}
        data-expanded={String(showMoreActions)}
        data-mood-open={String(showMoods)}
      >
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
          <fieldset id={MOBILE_MOOD_ACTIONS_ID} className="mc-bar__mood-row">
            <legend className="sr-only">Mood presets</legend>
            {moods.map((mood) => (
              <button
                key={mood.label}
                type="button"
                className="mc-bar__mood-btn"
                aria-label={`Generate ${mood.label.toLowerCase()} preset`}
                disabled={generatingMood !== null}
                aria-busy={generatingMood === mood.label}
                onClick={() => handleMoodGenerate(mood)}
              >
                <span className="mc-bar__mood-icon">{mood.icon}</span>
                <span className="mc-bar__mood-label">{mood.label}</span>
              </button>
            ))}
            {generatingMood ? (
              <button
                type="button"
                className="mc-bar__mood-btn"
                onClick={cancelMoodGeneration}
              >
                Cancel
              </button>
            ) : canRetryMoodGeneration ? (
              <button
                type="button"
                className="mc-bar__mood-btn"
                onClick={retryMoodGeneration}
              >
                Retry
              </button>
            ) : null}
          </fieldset>
        )}
        <div className={styles.actions} data-thumb-mode={String(thumbMode)}>
          {primaryActions.map(renderAction)}
          <button
            type="button"
            className={styles.action}
            data-active={String(showMoreActions)}
            aria-expanded={showMoreActions}
            aria-haspopup="menu"
            aria-controls={showMoreActions ? MOBILE_MORE_ACTIONS_ID : undefined}
            onClick={() => {
              resetHideTimer();
              pulseHaptic(8, hapticsEnabled);
              setShowMoreActions((current) => {
                if (current) setShowMoods(false);
                return !current;
              });
            }}
            aria-label="More mobile actions"
          >
            <UiIcon
              name="menu"
              className="stims-icon-slot stims-icon-slot--sm"
            />
            <span className={styles.actionLabel}>More</span>
          </button>
        </div>
        {showMoreActions ? (
          <fieldset id={MOBILE_MORE_ACTIONS_ID} className={styles.moreActions}>
            <legend className="sr-only">More mobile actions</legend>
            {overflowActions.map((action) =>
              renderAction({
                ...action,
                onClick: () => {
                  action.onClick();
                  if (action.id !== 'generate') setShowMoreActions(false);
                },
              }),
            )}
          </fieldset>
        ) : null}
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
          <span aria-hidden="true">⌃</span>
          <span className={styles.handleLabel}>Controls</span>
        </button>
      ) : null}
    </>
  );
}
