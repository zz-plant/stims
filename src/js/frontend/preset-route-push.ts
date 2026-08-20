/**
 * Decides whether the route -> engine sync should push the URL's preset into
 * the engine.
 *
 * Two effects keep the URL and the engine in agreement, in opposite
 * directions: `usePresetRouteSync` publishes engine -> route, and the load
 * effect in `workspace-hooks.ts` pushes route -> engine. Both re-run on every
 * engine snapshot change, so when the engine changes preset ON ITS OWN
 * (autoplay advance, WebGL fallback, an in-canvas keyboard shortcut) they run
 * in the same commit against a `routeState` that has not caught up yet. The
 * push direction would then load the now-stale route preset and drag the
 * engine back, while the publish direction moved the URL forward — the two
 * fight, and the stage and the address bar flicker between two presets.
 *
 * The rule that resolves it: this effect exists to react to ROUTE changes.
 * If the route has not changed since it last acted, the re-run was caused by
 * the engine moving, and the engine's pick wins.
 */
export type PresetRoutePushDecision =
  | 'load'
  | 'engine-not-mounted'
  | 'no-request'
  | 'already-failed'
  | 'already-active'
  | 'engine-moved'
  | 'in-flight';

export function decidePresetRoutePush({
  engineMounted,
  requestedPresetId,
  activePresetId,
  handledRouteRequestId,
  pendingPresetId,
  hasFailed,
}: {
  engineMounted: boolean;
  /** Resolved preset id the URL is asking for, if any. */
  requestedPresetId: string | null;
  /** What the engine is actually rendering right now. */
  activePresetId: string | null | undefined;
  /** Resolved route preset id this sync last acted on. */
  handledRouteRequestId: string | null;
  /** A route -> engine load already in flight for this id. */
  pendingPresetId: string | null;
  /** This id already timed out or failed; the fallback is on screen. */
  hasFailed: boolean;
}): PresetRoutePushDecision {
  if (!engineMounted) {
    return 'engine-not-mounted';
  }
  if (!requestedPresetId) {
    return 'no-request';
  }
  if (hasFailed) {
    return 'already-failed';
  }
  if (requestedPresetId === activePresetId) {
    return 'already-active';
  }
  // The route is unchanged since the last time this sync acted, so the only
  // reason it is running again is that the engine moved on its own. Pushing
  // the stale route preset here is the flicker.
  if (handledRouteRequestId === requestedPresetId) {
    return 'engine-moved';
  }
  // Re-requesting while the first load is still compiling makes the
  // navigation controller discard the earlier one as `superseded` after it
  // already paid for the fetch and compile.
  if (pendingPresetId === requestedPresetId) {
    return 'in-flight';
  }
  return 'load';
}
