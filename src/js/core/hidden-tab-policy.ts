/**
 * The one rule for whether a hidden tab stops rendering.
 *
 * Hidden tabs skip frames to spare the GPU, with three exceptions: agent mode,
 * where automation (headless capture, browser-pane QA) drives frames
 * deliberately and a silent skip reads as a frozen or black canvas; an open
 * picture-in-picture window, which is a live `canvas.captureStream()` of the
 * stage and is exactly what a user pops out before switching tabs; and live
 * performance mode, where this tab is driving a projector and flipping to
 * another tab to line up the next preset must not black out the room.
 *
 * `pictureInPictureElement` is `null` when no window is open and `undefined` in
 * browsers without the API, so "no PiP" is a falsy check: comparing to `null`
 * treated an absent API as an open window and never suspended a hidden tab.
 *
 * It lives here, not inline in the frame loop, so `__stims_agent.getState()`
 * can report the same answer the frame loop acts on instead of a copy that
 * drifts: a black canvas with no error is otherwise indistinguishable from a
 * shader failure.
 */
import { isLivePerformanceModeActive } from './live-performance-mode.ts';

export function isHiddenTabSuspendingFrames(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.hidden &&
    document.documentElement.dataset.agentMode !== 'true' &&
    !isLivePerformanceModeActive() &&
    !document.pictureInPictureElement
  );
}
