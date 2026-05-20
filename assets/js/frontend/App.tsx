import type { ErrorInfo, ReactNode } from 'react';
import { Component, useCallback, useEffect, useRef, useState } from 'react';
import '../../css/app-shell.css';
import { setMotionPreference } from '../core/motion-preferences.ts';
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
import { MobileControlBar } from './MobileControlBar.tsx';
import { NewHomePage } from './NewHomePage.tsx';
import { OnboardingFlow, useOnboarding } from './OnboardingFlow.tsx';
import { SplitViewBrowse } from './SplitViewBrowse.tsx';
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
            <h1 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
              Something went wrong
            </h1>
            <p style={{ opacity: 0.6, fontSize: '0.9rem', margin: 0 }}>
              Reload the page to try again.
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
  const w = useWorkspace();

  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageAnchoredToolOpen =
    w.routeState.panel === 'editor' || w.routeState.panel === 'inspector';
  const liveMode = w.launchControlsHidden;
  const audioEnergy = w.engineSnapshot?.audioEnergy ?? 0;
  const currentAudioSource =
    w.engineSnapshot?.audioSource ?? w.routeState.audioSource;
  const quietAtRef = useRef<number | null>(null);
  const quietDemoSuggestedRef = useRef(false);

  const { showOnboarding, dismissOnboarding } = useOnboarding();
  const { visibleHint, showHint, dismissHint } = useHelpHints();

  const handleToggleFullscreen = useCallback(() => {
    const stageElement = w.stageRef.current?.parentElement;
    if (!stageElement) {
      return;
    }

    void (async () => {
      try {
        const toggled = await toggleElementFullscreen(stageElement, document);
        if (!toggled) {
          w.setStatusMessage('Full screen is unavailable in this browser.');
        }
      } catch (_error) {
        w.setStatusMessage('Full screen is unavailable in this browser.');
      }
    })();
  }, [w.stageRef, w.setStatusMessage]);

  useEffect(() => {
    if (
      !liveMode ||
      !w.engineSnapshot?.audioActive ||
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
        w.setStatusMessage(
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
    w.engineSnapshot?.audioActive,
    w.setStatusMessage,
  ]);

  const stageEyebrow = w.loadingRequestedPreset
    ? 'Loading preset'
    : liveMode
      ? 'Now playing'
      : 'Ready when you are';
  const stageTitle = w.loadingRequestedPreset
    ? 'Loading preset'
    : w.selectedPreset
      ? w.selectedPreset.title
      : w.missingRequestedPreset
        ? 'Choose something new'
        : (w.featuredPreset?.title ?? 'Featured pick');
  const stageSummary = w.loadingRequestedPreset
    ? `Loading ${w.routeState.presetId}.`
    : w.selectedPreset
      ? w.selectedPreset.author || 'Unknown author'
      : w.missingRequestedPreset
        ? 'Start with the featured pick or open the full list.'
        : w.featuredPreset
          ? describePresetMood(w.featuredPreset)
          : 'Press play with demo audio, or open the full list first.';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement(document)));
    };

    handleFullscreenChange();
    return subscribeToFullscreenChange(handleFullscreenChange, document);
  }, []);

  useEffect(() => {
    let title = 'Stims';
    if (w.loadingRequestedPreset) {
      title = `Loading\u2026 \u00B7 ${title}`;
    } else if (w.selectedPreset) {
      title = `${w.selectedPreset.title} \u00B7 ${title}`;
    } else if (w.routeState.panel) {
      const panelLabel =
        w.routeState.panel === 'browse'
          ? 'Browse'
          : w.routeState.panel === 'settings'
            ? 'Settings'
            : w.routeState.panel === 'editor'
              ? 'Editor'
              : 'Inspector';
      title = `${panelLabel} \u00B7 ${title}`;
    } else if (liveMode) {
      title = `Now Playing \u00B7 ${title}`;
    } else if (!w.engineReady) {
      title = `Loading\u2026 \u00B7 ${title}`;
    }
    document.title = title;
  }, [
    w.loadingRequestedPreset,
    w.selectedPreset,
    w.routeState.panel,
    liveMode,
    w.engineReady,
  ]);

  useEffect(() => {
    if (liveMode && w.engineSnapshot?.audioActive) {
      showHint('first-play');
    }
  }, [liveMode, w.engineSnapshot?.audioActive, showHint]);

  useEffect(() => {
    if (w.routeState.panel === 'browse') {
      showHint('browse-open');
    }
  }, [w.routeState.panel, showHint]);

  useEffect(() => {
    if (w.routeState.panel === 'editor') {
      showHint('editor-open');
    }
  }, [w.routeState.panel, showHint]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === ' ' && liveMode && w.engineReady) {
        event.preventDefault();
        void w.handleAudioStart('demo');
      } else if (key === 'f') {
        event.preventDefault();
        handleToggleFullscreen();
      } else if (key === 'b') {
        event.preventDefault();
        w.updatePanel(w.routeState.panel === 'browse' ? null : 'browse');
      } else if (key === 's') {
        event.preventDefault();
        w.updatePanel(w.routeState.panel === 'settings' ? null : 'settings');
      } else if (key === 'e') {
        event.preventDefault();
        w.updatePanel(w.routeState.panel === 'editor' ? null : 'editor');
      } else if (key === 'i') {
        event.preventDefault();
        w.updatePanel(w.routeState.panel === 'inspector' ? null : 'inspector');
      } else if (key === 'n' || key === 'arrowright') {
        event.preventDefault();
        void w.handleShufflePreset();
      } else if (key === 'p' || key === 'arrowleft') {
        event.preventDefault();
        w.setStatusMessage('Previous preset — use Shuffle for random');
      } else if (/^[1-9]$/.test(key) && liveMode) {
        event.preventDefault();
        const index = Number.parseInt(key, 10) - 1;
        const preset = w.filteredCatalog[index];
        if (preset) {
          w.handlePresetSelection(preset.id);
        }
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
        w.setStatusMessage('Previous preset \u2014 use Shuffle for random');
      } else {
        void w.handleShufflePreset();
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
    w.engineReady,
    w.routeState.panel,
    w.updatePanel,
    w.handleAudioStart,
    w.handleShufflePreset,
    w.filteredCatalog,
    w.handlePresetSelection,
    w.setStatusMessage,
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
      data-has-toast={w.toast ? 'true' : undefined}
      data-mode={liveMode ? 'live' : 'home'}
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

      {w.routeState.panel === 'browse' && w.filteredCatalog.length > 0 ? (
        <SplitViewBrowse
          presets={w.filteredCatalog}
          currentPresetId={w.engineSnapshot?.activePresetId ?? null}
          onSelect={w.handlePresetSelection}
          onClose={() => w.updatePanel(null)}
          onPlay={(presetId) => {
            w.handlePresetSelection(presetId);
            w.updatePanel(null);
          }}
        />
      ) : null}

      <WorkspaceToast toast={w.toast} onDismiss={w.dismissToast} />

      {showOnboarding ? <OnboardingFlow onDismiss={dismissOnboarding} /> : null}

      <ContextualHelp hint={visibleHint} onDismiss={dismissHint} />

      {liveMode ? (
        <MobileControlBar
          audioEnergy={audioEnergy}
          presetTitle={w.selectedPreset?.title ?? w.featuredPreset?.title ?? ''}
          presetAuthor={
            w.selectedPreset?.author ?? w.featuredPreset?.author ?? ''
          }
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onToggleTheme={handleToggleTheme}
        />
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
