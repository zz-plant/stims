import type { ReactNode } from 'react';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { StimsControlDock } from './StimsControlDock.tsx';

import {
  StimsCornerBrand,
  StimsFrameChrome,
  StimsFrameHeader,
  StimsRailActions,
  StimsStageFrame,
} from './StimsStageFrame.tsx';
import { WorkspaceToast } from './WorkspaceToast.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

export { PresetArtwork } from './PresetArtwork.tsx';
export {
  PresetShelfSection,
  SkeletonPresetCard,
} from './PresetShelfSection.tsx';
export { UiIcon } from './UiIcon.tsx';
export { WorkspaceToast } from './WorkspaceToast.tsx';

export const BROWSE_PANEL_FOCUS_SELECTOR =
  '#preset-search, .milkdrop-overlay__search';

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
  const activePresetId = engineSnapshot?.activePresetId ?? null;
  const audioSource = engineSnapshot?.audioSource ?? ui.routeState.audioSource;

  return (
    <section
      className="stims-shell__workspace"
      data-mode={liveMode ? 'live' : 'home'}
      aria-label="Stims visualizer workspace"
    >
      <StimsStageFrame
        activePresetId={activePresetId}
        stageRef={ui.stageRef}
        liveMode={liveMode}
      >
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
              <div className="stims-shell__frame-sidecar-actions">
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
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('stims:shortcuts:open'),
                    )
                  }
                >
                  Shortcuts
                </button>
              </div>
              {audioSource === 'demo' && ui.showExtendedSources ? (
                <AudioSourcePanel />
              ) : null}
            </div>
          ) : (
            <div className="stims-shell__frame-sidecar">
              <div className="stims-shell__frame-sidecar-actions">
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
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('stims:shortcuts:open'),
                    )
                  }
                >
                  Shortcuts
                </button>
              </div>
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
