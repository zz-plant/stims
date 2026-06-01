import type { ErrorInfo, ReactNode } from 'react';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import '../../css/app-shell.css';
import { setMotionPreference } from '../core/motion-preferences.ts';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { useTemporalMemory } from '../core/services/temporal-memory.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  applyTheme,
  getActiveThemePreference,
  setThemePreference,
} from '../core/theme-preferences.ts';
import { ContextualHelp, useHelpHints } from './ContextualHelp.tsx';
import {
  getFullscreenElement,
  subscribeToFullscreenChange,
  toggleElementFullscreen,
} from './fullscreen.ts';
import { useMediaQuery } from './hooks/useMediaQuery';
import { MobileControlBar } from './MobileControlBar.tsx';
import { NewHomePage } from './NewHomePage.tsx';
import { OnboardingFlow, useOnboarding } from './OnboardingFlow.tsx';
import { SplitViewBrowse } from './SplitViewBrowse.tsx';
import { connectWakeLock } from './wake-lock.ts';
import { useWorkspace, WorkspaceProvider } from './workspace-context.tsx';
import { describePresetMood } from './workspace-helpers.ts';
import {
  WorkspaceStagePanel,
  WorkspaceToast,
  WorkspaceToolSheet,
} from './workspace-ui.tsx';

class StimsErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Stims crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          className="stims-shell"
          id="stims-main"
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100vh',
            background: '#0a0f19',
            color: '#e9fbff',
            fontFamily: 'system-ui,sans-serif',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Error</h1>
            <p style={{ opacity: 0.6, fontSize: '0.9rem', margin: 0 }}>
              Reload to retry.
            </p>
            <div style={{ marginTop: '24px' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Reload page
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch {}
                  try {
                    window.localStorage.setItem(
                      'stims:compatibility-mode',
                      'true',
                    );
                  } catch {}
                  window.location.reload();
                }}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Try WebGL mode
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    const keys: string[] = [];
                    for (let i = 0; i < window.localStorage.length; i++) {
                      const key = window.localStorage.key(i);
                      if (key?.startsWith('stims:')) {
                        keys.push(key);
                      }
                    }
                    keys.forEach((key) => window.localStorage.removeItem(key));
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch {}
                  window.location.href = '/';
                }}
                style={{
                  margin: '8px',
                  padding: '8px 16px',
                  background: '#1a2a3a',
                  color: '#e9fbff',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Reset settings
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function StimsWorkspaceAppShell() {
  const { ui, engine } = useWorkspace();
  const isWideEnough = useMediaQuery('(min-width: 1024px)');
  const temporalMemory = useTemporalMemory();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [audioMatch, setAudioMatch] = useState<{
    presetId: string;
    name: string;
    score: number;
  } | null>(null);

  const stageAnchoredToolOpen =
    ui.routeState.panel === 'editor' || ui.routeState.panel === 'inspector';
  const liveMode = engine.launchControlsHidden;
  const audioEnergy = engine.engineSnapshot?.audioEnergy ?? 0;
  const currentAudioSource =
    engine.engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  const quietAtRef = useRef<number | null>(null);
  const quietDemoSuggestedRef = useRef(false);

  const { showOnboarding, dismissOnboarding } = useOnboarding();
  const showOnboardingFlow =
    showOnboarding && !ui.routeState.previewMode && !ui.routeState.agentMode;
  const { visibleHint, showHint, dismissHint } = useHelpHints();

  const handleToggleFullscreen = useCallback(() => {
    const stageElement = ui.stageRef.current?.parentElement;
    if (!stageElement) {
      return;
    }

    void (async () => {
      try {
        const toggled = await toggleElementFullscreen(stageElement, document);
        if (!toggled) {
          ui.setStatusMessage('Full screen unavailable.');
        }
      } catch (_error) {
        ui.setStatusMessage('Full screen unavailable.');
      }
    })();
  }, [ui.stageRef, ui.setStatusMessage]);

  useEffect(() => {
    if (
      !liveMode ||
      !engine.engineSnapshot?.audioActive ||
      currentAudioSource === 'demo'
    ) {
      quietAtRef.current = null;
      quietDemoSuggestedRef.current = false;
      return;
    }

    if (audioEnergy < 0.04) {
      if (quietAtRef.current === null) {
        quietAtRef.current = performance.now();
      } else if (
        performance.now() - quietAtRef.current >= 3000 &&
        !quietDemoSuggestedRef.current
      ) {
        quietDemoSuggestedRef.current = true;
        ui.setStatusMessage(
          'Not hearing much? Switch to demo audio for guaranteed motion.',
        );
      }
    } else {
      quietAtRef.current = null;
      quietDemoSuggestedRef.current = false;
    }
  }, [
    audioEnergy,
    currentAudioSource,
    liveMode,
    engine.engineSnapshot?.audioActive,
    ui.setStatusMessage,
  ]);

  const stageEyebrow = engine.loadingRequestedPreset
    ? 'Loading preset'
    : liveMode
      ? 'Now playing'
      : 'Stage ready';
  const stageTitle = engine.loadingRequestedPreset
    ? 'Loading preset'
    : engine.selectedPreset
      ? engine.selectedPreset.title
      : engine.missingRequestedPreset
        ? 'Change preset'
        : (engine.featuredPreset?.title ?? 'Featured pick');
  const stageSummary = engine.loadingRequestedPreset
    ? `Loading ${ui.routeState.presetId}.`
    : engine.selectedPreset
      ? engine.selectedPreset.author || 'Unknown author'
      : engine.missingRequestedPreset
        ? 'Start with the featured pick or open the full list.'
        : engine.featuredPreset
          ? describePresetMood(engine.featuredPreset)
          : 'Press play with demo audio, or open the full list first.';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    };

    handleFullscreenChange();
    return subscribeToFullscreenChange(handleFullscreenChange, document);
  }, []);

  useEffect(() => {
    return connectWakeLock(() => {
      return (
        isFullscreen ||
        (liveMode && (engine.engineSnapshot?.audioActive ?? false))
      );
    });
  }, [isFullscreen, liveMode, engine.engineSnapshot?.audioActive]);

  useEffect(() => {
    let title = 'Stims';
    if (engine.loadingRequestedPreset) {
      title = `Loading\u2026 \u00B7 ${title}`;
    } else if (engine.selectedPreset && liveMode) {
      title = `${engine.selectedPreset.title} \u00B7 ${title}`;
    } else if (ui.routeState.panel) {
      const panelLabel =
        ui.routeState.panel === 'browse'
          ? 'Browse'
          : ui.routeState.panel === 'settings'
            ? 'Settings'
            : ui.routeState.panel === 'editor'
              ? 'Editor'
              : 'Inspector';
      title = `${panelLabel} \u00B7 ${title}`;
    } else if (liveMode) {
      title = `Now Playing \u00B7 ${title}`;
    } else if (!engine.engineReady) {
      title = `Loading\u2026 \u00B7 ${title}`;
    }
    document.title = title;
  }, [
    engine.loadingRequestedPreset,
    engine.selectedPreset,
    ui.routeState.panel,
    liveMode,
    engine.engineReady,
  ]);

  useEffect(() => {
    if (liveMode && engine.engineSnapshot?.audioActive) {
      showHint('first-play');
    }
  }, [liveMode, engine.engineSnapshot?.audioActive, showHint]);

  useEffect(() => {
    if (ui.routeState.panel === 'browse') {
      showHint('browse-open');
    }
  }, [ui.routeState.panel, showHint]);

  useEffect(() => {
    if (ui.routeState.panel === 'editor') {
      showHint('editor-open');
    }
  }, [ui.routeState.panel, showHint]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: internal refs and service methods don't change
  useEffect(() => {
    const activePresetId = engine.engineSnapshot?.activePresetId;
    if (!activePresetId) return;
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    temporalMemory.record(activePresetId, canvas);
  }, [engine.engineSnapshot?.activePresetId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ignore snapshot sub-properties
  useEffect(() => {
    if (!engine.engineSnapshot?.audioActive) {
      setAudioMatch(null);
      return;
    }
    const controller = new AbortController();
    const snap = engine.engineSnapshot;
    const profile = buildAudioProfile({ audioEnergy: snap.audioEnergy });
    if (profile.rms < 0.02) return;

    void searchByAudioProfile(profile, controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      if (results.length === 0) return;
      const top = results[0];
      if (top.score < 0.75) return;
      const preset = engine.catalog.find((e) => e.id === top.presetId);
      setAudioMatch({
        presetId: top.presetId,
        name: preset?.title ?? top.presetId,
        score: top.score,
      });
    });

    return () => controller.abort();
  }, [engine.engineSnapshot?.audioActive, engine.engineSnapshot?.audioSource]);

  const filteredCatalogRef = useRef(engine.filteredCatalog);
  filteredCatalogRef.current = engine.filteredCatalog;
  const handlePresetSelectionRef = useRef(engine.handlePresetSelection);
  handlePresetSelectionRef.current = engine.handlePresetSelection;
  const setStatusMessageRef = useRef(ui.setStatusMessage);
  setStatusMessageRef.current = ui.setStatusMessage;
  const updatePanelRef = useRef(ui.updatePanel);
  updatePanelRef.current = ui.updatePanel;
  const handleShufflePresetRef = useRef(engine.handleShufflePreset);
  handleShufflePresetRef.current = engine.handleShufflePreset;
  const handleAudioStartRef = useRef(engine.handleAudioStart);
  handleAudioStartRef.current = engine.handleAudioStart;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === ' ' && liveMode && engine.engineReady) {
        event.preventDefault();
        void handleAudioStartRef.current('demo');
      } else if (key === 'f') {
        event.preventDefault();
        handleToggleFullscreen();
      } else if (key === 'b') {
        event.preventDefault();
        updatePanelRef.current(
          ui.routeState.panel === 'browse' ? null : 'browse',
        );
      } else if (key === 's') {
        event.preventDefault();
        updatePanelRef.current(
          ui.routeState.panel === 'settings' ? null : 'settings',
        );
      } else if (key === 'e') {
        event.preventDefault();
        updatePanelRef.current(
          ui.routeState.panel === 'editor' ? null : 'editor',
        );
      } else if (key === 'i') {
        event.preventDefault();
        updatePanelRef.current(
          ui.routeState.panel === 'inspector' ? null : 'inspector',
        );
      } else if (key === 'n' || key === 'arrowright') {
        event.preventDefault();
        void handleShufflePresetRef.current();
      } else if (key === 'p' || key === 'arrowleft') {
        event.preventDefault();
        setStatusMessageRef.current(
          'Previous preset \u2014 use Shuffle for random',
        );
      } else if (/^[1-9]$/.test(key) && liveMode) {
        event.preventDefault();
        const index = Number.parseInt(key, 10) - 1;
        const preset = filteredCatalogRef.current[index];
        if (preset) {
          handlePresetSelectionRef.current(preset.id);
        }
      } else if (key === '?') {
        event.preventDefault();
        setShowShortcuts((s) => !s);
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchStartX || !touchStartY) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      touchStartX = 0;
      touchStartY = 0;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) {
        setStatusMessageRef.current(
          'Previous preset \u2014 use Shuffle for random',
        );
      } else {
        void handleShufflePresetRef.current();
      }
    };

    document.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );
    document.addEventListener('touchstart', handleTouchStart, {
      passive: true,
    });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [
    handleToggleFullscreen,
    liveMode,
    engine.engineReady,
    ui.routeState.panel,
  ]);

  useEffect(() => {
    const preference = getActiveThemePreference();
    applyTheme(preference.theme);
  }, []);

  useEffect(() => {
    const el = document.getElementById('stims-loading');
    if (el) el.hidden = true;
  }, []);

  const handleToggleTheme = () => {
    const current = getActiveThemePreference();
    const next = current.theme === 'dark' ? 'light' : 'dark';
    setThemePreference({ theme: next });
    applyTheme(next);
  };

  const shell = (
    <main
      className="stims-shell"
      id="stims-main"
      data-has-toast={ui.toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
      data-preview={ui.routeState.previewMode ? 'true' : undefined}
    >
      <a href="#stims-main" className="skip-link">
        Skip to main content
      </a>
      <WorkspaceStagePanel
        audioEnergy={audioEnergy}
        isFullscreen={isFullscreen}
        launchPanel={<NewHomePage />}
        liveMode={liveMode}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleTheme={handleToggleTheme}
        stageEyebrow={stageEyebrow}
        stageSummary={stageSummary}
        stageTitle={stageTitle}
      />

      <WorkspaceToolSheet
        onCompatibilityModeChange={setCompatibilityMode}
        onMotionPreferenceChange={(enabled) => setMotionPreference({ enabled })}
        stageAnchoredToolOpen={stageAnchoredToolOpen}
      />

      {isWideEnough &&
      ui.routeState.panel === 'browse' &&
      engine.filteredCatalog.length > 0 ? (
        <SplitViewBrowse
          presets={engine.filteredCatalog}
          currentPresetId={engine.engineSnapshot?.activePresetId ?? null}
          onSelect={engine.handlePresetSelection}
          onClose={() => ui.updatePanel(null)}
          onPlay={(presetId) => {
            engine.handlePresetSelection(presetId);
            ui.updatePanel(null);
          }}
        />
      ) : null}

      <WorkspaceToast toast={ui.toast} onDismiss={ui.dismissToast} />

      {showOnboardingFlow ? (
        <OnboardingFlow
          onDismiss={dismissOnboarding}
          onStartDemo={() => void engine.handleAudioStart('demo')}
        />
      ) : null}

      <ContextualHelp hint={visibleHint} onDismiss={dismissHint} />

      {liveMode ? (
        <MobileControlBar
          audioEnergy={audioEnergy}
          presetTitle={
            engine.selectedPreset?.title ?? engine.featuredPreset?.title ?? ''
          }
          presetAuthor={
            engine.selectedPreset?.author ?? engine.featuredPreset?.author ?? ''
          }
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onToggleTheme={handleToggleTheme}
        />
      ) : null}
      {audioMatch ? (
        <div className="stims-shell__audio-match">
          <span className="stims-shell__eyebrow">Audio match</span>
          <button
            type="button"
            className="stims-shell__text-button"
            onClick={() => engine.handlePresetSelection(audioMatch.presetId)}
          >
            {audioMatch.name} — {(audioMatch.score * 100).toFixed(0)}% match
          </button>
          <button
            type="button"
            className="stims-shell__audio-match-close"
            onClick={(e) => {
              e.stopPropagation();
              setAudioMatch(null);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {showShortcuts ? (
        <div
          className="stims-shell__shortcut-overlay"
          role="dialog"
          aria-label="Keyboard shortcuts"
          onClick={() => setShowShortcuts(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowShortcuts(false);
          }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: card is visual-only, backdrop handles dismiss */}
          <div
            className="stims-shell__shortcut-card"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <h2>Keyboard shortcuts</h2>
            <div className="stims-shell__shortcut-grid">
              <kbd>Space</kbd>
              <span>Demo audio</span>
              <kbd>F</kbd>
              <span>Fullscreen</span>
              <kbd>B</kbd>
              <span>Browse panel</span>
              <kbd>S</kbd>
              <span>Settings</span>
              <kbd>E</kbd>
              <span>Editor</span>
              <kbd>I</kbd>
              <span>Inspector</span>
              <kbd>N / →</kbd>
              <span>Shuffle preset</span>
              <kbd>P / ←</kbd>
              <span>Previous preset</span>
              <kbd>1–9</kbd>
              <span>Quick-select preset</span>
              <kbd>?</kbd>
              <span>This help</span>
              <kbd>Esc</kbd>
              <span>Close panels / dismiss</span>
              <kbd>Cmd+Enter</kbd>
              <span>Compile in editor</span>
            </div>
            <button
              type="button"
              className="cta-button ghost"
              onClick={() => setShowShortcuts(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );

  return shell;
}

export function StimsWorkspaceApp() {
  return (
    <StimsErrorBoundary>
      <WorkspaceProvider>
        <StimsWorkspaceAppShell />
      </WorkspaceProvider>
    </StimsErrorBoundary>
  );
}
