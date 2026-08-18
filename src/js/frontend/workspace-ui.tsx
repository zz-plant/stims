import type { ReactNode } from 'react';
import { parseURLParams } from '../core/url-params.ts';
import { usePresetTransition } from './hooks/usePresetTransition.ts';
import { StageControls } from './StageControls.tsx';
import { StageWarpGizmo } from './StageWarpGizmo.tsx';
import { StimsStageFrame } from './StimsStageFrame.tsx';
import { StrudelLabPanel } from './StrudelLabPanel.tsx';
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

// Prototype flag: `?strudel=1` mounts the Strudel live-coding lab, which
// drives the visualizer's analyser with Strudel's audio output.
const strudelLabEnabled = parseURLParams().flags.strudel;

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
  const presetTransition = usePresetTransition();
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
        activePresetTitle={engine.selectedPreset?.title ?? null}
        stageRef={ui.stageRef}
        liveMode={liveMode}
        transitionPhase={presetTransition.phase}
      >
        {liveMode && !missingRequestedPreset ? (
          <StageControls
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />
        ) : null}
        {/* Only while the editor is open — it renders its own null otherwise.
            The handle is the one thing on this layer that takes the pointer. */}
        {liveMode && !missingRequestedPreset ? <StageWarpGizmo /> : null}
        {/* inert: the hero is pointer-events:none in live mode but its
            buttons stay in the tab order and accessibility tree without it */}
        <div className="stims-shell__stage-hero" inert={liveMode}>
          {launchPanel}
        </div>
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
        <WorkspaceToast toast={ui.toast} />
        {strudelLabEnabled ? <StrudelLabPanel /> : null}
      </StimsStageFrame>
    </section>
  );
}
