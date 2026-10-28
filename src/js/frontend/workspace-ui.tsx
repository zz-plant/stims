import { type ReactNode, useSyncExternalStore } from 'react';
import { isRoomModeRequested } from '../core/room-mode.ts';
import {
  getStageOverlayPreference,
  subscribeToStageOverlayPreference,
} from '../core/stage-overlay-preferences.ts';
import { parseURLParams } from '../core/url-params.ts';
import { CueMonitor } from './CueMonitor.tsx';
import { FlashProtectionNotice } from './FlashProtectionNotice.tsx';
import { usePresetTransition } from './hooks/usePresetTransition.ts';
import { PerformSurface } from './PerformSurface.tsx';
import { PresetTitleCard } from './PresetTitleCard.tsx';
import { StageControls } from './StageControls.tsx';
import { StageUtilitiesOverlay } from './StageUtilitiesOverlay.tsx';
import { StageWarpGizmo } from './StageWarpGizmo.tsx';
import { StimsStageFrame } from './StimsStageFrame.tsx';
import { StrudelLabPanel } from './StrudelLabPanel.tsx';
import { WorkspaceToast } from './WorkspaceToast.tsx';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

export { PresetArtwork } from './PresetArtwork.tsx';
export { SkeletonPresetCard } from './SkeletonPresetCard.tsx';
export { UiIcon } from './UiIcon.tsx';
export { WorkspaceToast } from './WorkspaceToast.tsx';

export const BROWSE_PANEL_FOCUS_SELECTOR = '#preset-search';

// `?strudel=1` keeps working as a one-shot prototype flag even though the lab
// is now also controllable from Settings; the two are OR-ed on purpose so a
// deep link to the lab still opens it.
const strudelFlag = parseURLParams().flags.strudel;

export function WorkspaceStagePanel({
  isFullscreen,
  launchPanel,
  liveMode,
  onToggleFullscreen,
  onOpenPalette,
  onOpenShortcuts,
  onOpenSets,
}: {
  isFullscreen: boolean;
  launchPanel: ReactNode;
  liveMode: boolean;
  onToggleFullscreen: () => void;
  onOpenPalette?: () => void;
  onOpenShortcuts?: () => void;
  onOpenSets?: () => void;
}) {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const presetTransition = usePresetTransition();
  const missingRequestedPreset = engine.missingRequestedPreset;
  const invalidExperienceSlug = ui.routeState.invalidExperienceSlug;
  const invalidPanel = ui.routeState.invalidPanel;
  const activePresetId = engineSnapshot?.activePresetId ?? null;
  const panelOpen = ui.routeState.panel !== null;
  const strudelLabPref = useSyncExternalStore(
    subscribeToStageOverlayPreference,
    () => getStageOverlayPreference().strudelLab,
    () => false,
  );
  const strudelLabEnabled = strudelFlag || strudelLabPref;
  const _audioSource = engineSnapshot?.audioSource ?? ui.routeState.audioSource;
  const stageReady = liveMode && !missingRequestedPreset;
  // A room display (core/room-mode.ts) shows the picture and nothing else:
  // no controls to reach for, no names over the visuals, no notices.
  const roomMode = isRoomModeRequested();
  const stageChrome = stageReady && !roomMode;

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
        {stageChrome ? (
          <StageControls
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            onOpenPalette={onOpenPalette}
            onOpenShortcuts={onOpenShortcuts}
            onOpenSets={onOpenSets}
          />
        ) : null}
        {/* Only while the editor is open — it renders its own null otherwise.
            The handle is the one thing on this layer that takes the pointer. */}
        {stageChrome ? <StageWarpGizmo /> : null}
        {/* Both render themselves away when empty. Their one-time empty-state
            hints wait for a returning visitor on a wide screen — a first
            session stays free of stage chrome. */}
        {stageChrome ? <CueMonitor /> : null}
        {stageChrome ? <PerformSurface /> : null}
        {stageChrome ? <PresetTitleCard /> : null}
        {/* inert: the hero is pointer-events:none in live mode but its
            buttons stay in the tab order and accessibility tree without it.
            Also inert whenever a panel is open — on the home screen the hero
            stayed fully live and full-contrast behind an open sheet, so
            "Welcome back / Continue with <preset>" sat at display size
            competing with the list the user was actually reading, and Tab
            still walked into it from behind the panel. */}
        <div
          className="stims-shell__stage-hero"
          data-behind-panel={panelOpen ? 'true' : undefined}
          inert={liveMode || panelOpen}
        >
          {launchPanel}
        </div>
        {/* An unrecognized ?tool= used to be dropped silently, landing you on
            the stage with no idea the link had asked for anything. Name the
            value back, the same way an unknown experience slug does. */}
        {!invalidExperienceSlug && invalidPanel ? (
          <div className="active-toy-status is-error">
            <div className="active-toy-status__content">
              <h2>Unknown panel</h2>
              <p>
                This link asked for a panel called "{invalidPanel}", which
                doesn't exist. Everything else in the link still loaded.
              </p>
            </div>
          </div>
        ) : null}
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
        {roomMode ? null : <FlashProtectionNotice />}
        {/* The D/Y stage utilities. Live mode only: there is nothing to cut
            on the launch page, and unmounting with the session releases any
            latched blackout. */}
        {stageReady ? <StageUtilitiesOverlay stageRef={ui.stageRef} /> : null}
        <WorkspaceToast toast={ui.toast} />
        {strudelLabEnabled ? <StrudelLabPanel /> : null}
      </StimsStageFrame>
    </section>
  );
}
