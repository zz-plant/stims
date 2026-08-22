/**
 * Live performance mode — "this screen is the show".
 *
 * Three defaults that are right for a browser tab are wrong for a set, and
 * all three fail the same way: the picture changes without the performer
 * asking, in front of an audience.
 *
 *  - **Hidden tabs stop rendering.** Correct for a background tab; fatal
 *    when the operator flips to another tab to line up the next preset and
 *    the projector goes black. Note the limit here, measured rather than
 *    assumed: a fully hidden tab gets ZERO `requestAnimationFrame`
 *    callbacks from the browser (probed in Chrome: 0 ticks while
 *    `document.hidden`), so no page-level code can keep drawing. Dropping
 *    our own extra pause only helps where the browser still schedules
 *    frames — an unfocused but visible window, or a tab kept alive by an
 *    open picture-in-picture. For the case we cannot fix, the mode says so
 *    (see `describeHiddenTabFreezeRisk`) instead of leaving the performer
 *    staring at a frozen room with no explanation.
 *  - **Battery saving caps the frame rate.** A laptop unplugged in a booth
 *    is not a laptop idling in a café.
 *  - **Adaptive quality re-scales resolution mid-frame-run.** On a large
 *    projection that reads as the image softening and re-sharpening on its
 *    own. Off-stage it is exactly the right trade; on-stage a steady
 *    picture at lower quality beats a pumping one.
 *
 * Agent mode already suppresses the first two, because automation hits the
 * same problems. This is the same idea made intentional and reachable, so a
 * performer does not have to discover a debug URL flag.
 *
 * The mode is published as a `data-live-performance` attribute on the root
 * element so the render and power paths can consult it synchronously, the
 * same way they consult `data-agent-mode` — those checks run per frame and
 * must not depend on React state having propagated.
 */

const STORAGE_KEY = 'stims:live-performance-mode';
const ATTRIBUTE = 'livePerformance';

type Listener = (enabled: boolean) => void;

const listeners = new Set<Listener>();
let enabled = false;
let hydrated = false;

function applyToDocument() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  if (enabled) {
    root.dataset[ATTRIBUTE] = 'true';
  } else {
    delete root.dataset[ATTRIBUTE];
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    enabled = globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private-mode storage denial is not a reason to fail to start.
    enabled = false;
  }
  applyToDocument();
}

/**
 * Synchronous read for per-frame callers.
 *
 * Reads the document attribute rather than the module variable so a caller
 * in another bundle chunk — or a test that set the attribute directly —
 * sees the same answer.
 */
export function isLivePerformanceModeActive(): boolean {
  if (typeof document !== 'undefined' && document.documentElement) {
    return document.documentElement.dataset[ATTRIBUTE] === 'true';
  }
  hydrate();
  return enabled;
}

export function getLivePerformanceMode(): boolean {
  hydrate();
  return enabled;
}

export function setLivePerformanceMode(next: boolean): boolean {
  hydrate();
  if (enabled === next) return enabled;
  enabled = next;
  applyToDocument();
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
  } catch {
    // Non-persistent is still usable for the current session.
  }
  for (const listener of listeners) listener(enabled);
  return enabled;
}

export function toggleLivePerformanceMode(): boolean {
  return setLivePerformanceMode(!getLivePerformanceMode());
}

export function subscribeLivePerformanceMode(listener: Listener) {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the hydrated value and the document attribute. */
export function resetLivePerformanceModeForTests() {
  enabled = false;
  hydrated = false;
  listeners.clear();
  applyToDocument();
}

/**
 * Why the stage output just froze, or null if it should still be running.
 *
 * A hidden tab is paused by the browser, not by us, so the only thing left
 * to do is turn a mystery black screen into a sentence the performer can
 * act on — and they will read it the moment they switch back.
 */
export function describeHiddenTabFreezeRisk(): string | null {
  if (typeof document === 'undefined') return null;
  if (!isLivePerformanceModeActive()) return null;
  if (!document.hidden) return null;
  // An open picture-in-picture window keeps the browser scheduling frames
  // for this tab, so the stage output survives being switched away from.
  if (document.pictureInPictureElement !== null) return null;
  return 'Stage output pauses while this tab is in the background — the browser stops scheduling frames. Keep the show window visible, or pop the stage out to picture-in-picture or a second screen before switching tabs.';
}
