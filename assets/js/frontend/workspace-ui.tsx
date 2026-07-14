import type { ReactNode } from 'react';
import { StageControls } from './StageControls.tsx';
import { StimsStageFrame } from './StimsStageFrame.tsx';
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
}: {
  isFullscreen: boolean;
  launchPanel: ReactNode;
  liveMode: boolean;
  onToggleFullscreen: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const missingRequestedPreset = engine.missingRequestedPreset;
  const invalidExperienceSlug = ui.routeState.invalidExperienceSlug;
  const activePresetId = engineSnapshot?.activePresetId ?? null;
  const _audioSource = engineSnapshot?.audioSource ?? ui.routeState.audioSource;

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
        {liveMode && !missingRequestedPreset ? (
          <StageControls
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />
        ) : null}
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
