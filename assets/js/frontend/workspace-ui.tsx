import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { BrowseSheetPanel } from './BrowseSheetPanel.tsx';
import { EditorPanel } from './EditorPanel.tsx';
import { SettingsSheetPanel } from './SettingsSheetPanel.tsx';
import { StimsControlDock } from './StimsControlDock.tsx';
import {
  StimsCornerBrand,
  StimsFrameChrome,
  StimsFrameHeader,
  StimsRailActions,
  StimsStageFrame,
} from './StimsStageFrame.tsx';
import { UiIcon } from './UiIcon.tsx';
import { WorkspaceToast } from './WorkspaceToast.tsx';
import {
  useEngineSnapshot,
  useUI,
  useWorkspace,
} from './workspace-context.tsx';
import {
  getToolDescription,
  getToolLabel,
  TOOL_TABS,
} from './workspace-helpers.ts';

export { PresetArtwork } from './PresetArtwork.tsx';
export {
  PresetShelfSection,
  SkeletonPresetCard,
} from './PresetShelfSection.tsx';
export { UiIcon } from './UiIcon.tsx';
export { WorkspaceToast } from './WorkspaceToast.tsx';

export function WorkspaceStagePanel({
  isFullscreen,
  launchPanel,
  liveMode,
  onToggleFullscreen,
  onToggleTheme,
  stageEyebrow,
  stageSummary,
  stageTitle,
}: {
  isFullscreen: boolean;
  launchPanel: ReactNode;
  liveMode: boolean;
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
  stageEyebrow: string;
  stageSummary: string;
  stageTitle: string;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const missingRequestedPreset = engine.missingRequestedPreset;
  const invalidExperienceSlug = ui.routeState.invalidExperienceSlug;
  const audioSource = engineSnapshot?.audioSource ?? ui.routeState.audioSource;

  return (
    <section
      className="stims-shell__workspace"
      data-mode={liveMode ? 'live' : 'home'}
      aria-label="Stims visualizer workspace"
    >
      <StimsStageFrame stageRef={ui.stageRef} liveMode={liveMode}>
        <StimsFrameChrome>
          <StimsCornerBrand>
            <span className="stims-shell__logo">
              <a href="/">
                <span>Stims</span>
                <small>Sound into motion</small>
              </a>
            </span>
          </StimsCornerBrand>
          <StimsRailActions>
            {!missingRequestedPreset ? (
              <StimsControlDock
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onToggleTheme={onToggleTheme}
              />
            ) : null}
          </StimsRailActions>
        </StimsFrameChrome>
        <StimsFrameHeader>
          <div className="stims-shell__stage-copy">
            <p className="stims-shell__eyebrow">{stageEyebrow}</p>
            <h2>{stageTitle}</h2>
            <p className="stims-shell__meta-copy stims-shell__stage-summary">
              {stageSummary}
            </p>
          </div>
          {liveMode ? (
            <div className="stims-shell__frame-sidecar">
              <button
                type="button"
                className="stims-shell__text-button stims-shell__audio-bridge-link"
                onClick={engine.handleAudioStop}
              >
                ← Back to library
              </button>
              {audioSource === 'demo' ? (
                <button
                  type="button"
                  className="stims-shell__text-button stims-shell__audio-bridge-link"
                  style={{ marginLeft: 12 }}
                  onClick={ui.toggleExtendedSources}
                >
                  {ui.showExtendedSources
                    ? 'Hide sources'
                    : 'Switch to your music \u2192'}
                </button>
              ) : null}
              <button
                type="button"
                className="stims-shell__text-button stims-shell__shortcuts-trigger"
                style={{ marginLeft: 12 }}
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('stims:shortcuts:open'))
                }
              >
                Shortcuts
              </button>
              {audioSource === 'demo' && ui.showExtendedSources ? (
                <AudioSourcePanel />
              ) : null}
            </div>
          ) : (
            <div className="stims-shell__frame-sidecar">
              {audioSource === 'demo' ? (
                <button
                  type="button"
                  className="stims-shell__text-button stims-shell__audio-bridge-link"
                  onClick={ui.toggleExtendedSources}
                >
                  {ui.showExtendedSources
                    ? 'Hide sources'
                    : 'Switch to your music \u2192'}
                </button>
              ) : null}
              <button
                type="button"
                className="stims-shell__text-button stims-shell__shortcuts-trigger"
                style={{ marginLeft: 12 }}
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('stims:shortcuts:open'))
                }
              >
                Shortcuts
              </button>
              {audioSource === 'demo' && ui.showExtendedSources ? (
                <AudioSourcePanel />
              ) : null}
            </div>
          )}
        </StimsFrameHeader>
        <div className="stims-shell__stage-hero">{launchPanel}</div>
        {invalidExperienceSlug ? (
          <div className="active-toy-status is-error">
            <div className="active-toy-status__content">
              <h2>Link no longer works</h2>
              <p>
                This Stims link points to a view that is no longer available: "
                {invalidExperienceSlug}".
              </p>
            </div>
          </div>
        ) : null}
        <WorkspaceToast toast={ui.toast} onDismiss={ui.dismissToast} />
      </StimsStageFrame>
    </section>
  );
}

export function WorkspaceToolSheet({
  onCompatibilityModeChange,
  onMotionPreferenceChange,
  stageAnchoredToolOpen,
}: {
  onCompatibilityModeChange: (enabled: boolean) => void;
  onMotionPreferenceChange: (enabled: boolean) => void;
  stageAnchoredToolOpen: boolean;
}) {
  const w = useUI();
  const panel = w.routeState.panel;
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        w.updatePanel(null);
        return;
      }

      if (event.key === 'Tab' && sheetRef.current) {
        const focusableElements = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;

        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    const sheetElement = sheetRef.current;
    sheetElement?.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );

    // Focus the most useful element for the active panel.
    // Defer by a frame to let the overlay mount its DOM first.
    requestAnimationFrame(() => {
      if (w.routeState.panel === 'browse') {
        const searchEl = document.querySelector<HTMLElement>(
          '#preset-search, .milkdrop-overlay__search',
        );
        (searchEl ?? sheetElement)?.focus();
      } else {
        sheetElement?.focus();
      }
    });

    return () => {
      sheetElement?.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
    };
  }, [w.routeState.panel, w.updatePanel]);

  if (!panel) {
    return null;
  }

  const visibleTabs = stageAnchoredToolOpen
    ? TOOL_TABS
    : TOOL_TABS.filter((tool) => tool === 'browse' || tool === 'settings');

  return (
    <aside
      ref={sheetRef}
      className="stims-shell__sheet"
      data-panel={panel}
      aria-label="Tools"
      tabIndex={-1}
    >
      <div className="stims-shell__sheet-header">
        <div className="stims-shell__sheet-heading">
          <h2>{getToolLabel(panel)}</h2>
          <p className="stims-shell__meta-copy">{getToolDescription(panel)}</p>
        </div>
        <button
          type="button"
          className="stims-shell__icon-button"
          onClick={() => w.updatePanel(null)}
        >
          <UiIcon
            name="close"
            className="stims-shell__button-icon stims-icon-slot stims-icon-slot--sm"
          />
          <span className="stims-shell__button-label">Close</span>
        </button>
      </div>

      {visibleTabs.length > 2 ? (
        <nav className="stims-shell__tool-tabs" aria-label="Tool sections">
          {visibleTabs.map((tool) => (
            <button
              key={tool}
              type="button"
              className="stims-shell__sheet-tab"
              data-active={String(panel === tool)}
              onClick={() => w.updatePanel(tool)}
            >
              {getToolLabel(tool)}
            </button>
          ))}
        </nav>
      ) : (
        <nav className="stims-shell__tool-jumplink" aria-label="Tool sections">
          {visibleTabs
            .filter((tool) => tool !== panel)
            .map((tool) => (
              <button
                key={tool}
                type="button"
                className="stims-shell__text-button"
                onClick={() => w.updatePanel(tool)}
              >
                {panel === 'browse' && tool === 'settings'
                  ? 'Style \u2192'
                  : panel === 'settings' && tool === 'browse'
                    ? '\u2190 Browse presets'
                    : `Open ${getToolLabel(tool).toLowerCase()}`}
              </button>
            ))}
        </nav>
      )}

      <div className="stims-shell__sheet-body">
        {panel === 'editor' ? <EditorPanel /> : null}

        {panel === 'browse' ? (
          <BrowseSheetPanel
            onCollectionTagChange={(collectionTag) =>
              w.commitRoute({ ...w.routeState, collectionTag })
            }
            onImport={(files) => {
              void w.handleImport(files);
            }}
          />
        ) : null}

        {panel === 'settings' ? (
          <SettingsSheetPanel
            onCompatibilityModeChange={onCompatibilityModeChange}
            onMotionPreferenceChange={onMotionPreferenceChange}
          />
        ) : null}
      </div>
    </aside>
  );
}
