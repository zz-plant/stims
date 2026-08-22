/**
 * Decides whether the engine -> route sync may write the engine's active
 * preset into the address bar.
 *
 * The URL is a promise: it is what the visitor copies, what Back returns to,
 * and what a reload reopens. Attract mode breaks that promise. It mounts the
 * engine on a bare "/" arrival purely so the landing page has something
 * moving behind it (see the attract-mode gate in `workspace-hooks.ts`), the
 * runtime picks a first-run preset, and the publish direction below wrote
 * that pick straight into the address bar. Nobody asked for it, and three
 * things broke downstream:
 *
 *   - Reload or Back landed on `/?preset=<first-run-id>`, which the deep-link
 *     path treats as "this visitor came to watch this preset" and auto-starts
 *     demo audio. The landing page could never be seen twice.
 *   - Copying the URL off the landing page shared a link that skipped the
 *     landing page.
 *   - `NewHomePage`'s arrival check could observe the app's own rewrite and
 *     auto-start a session on a bare arrival.
 *
 * The rule: the address bar tracks the engine only once the visit has become
 * a session the visitor chose. Two things count as choosing, and nothing
 * else does:
 *
 *   - `audioActive` — they started a source, so the stage is theirs now.
 *   - the route already names a preset — they deep-linked, or picked one out
 *     of Browse (`handlePlayPreset` commits the route before the engine
 *     moves), so the URL is already tracking and must keep up with autoplay.
 *
 * A decorative attract-mode preset satisfies neither and stays out of the
 * URL.
 */
export type EngineRoutePublishDecision =
  | 'publish'
  | 'runtime-not-ready'
  | 'no-active-preset'
  | 'attract-only';

export function decideEngineRoutePublish({
  runtimeReady,
  activePresetId,
  audioActive,
  routePresetId,
}: {
  runtimeReady: boolean;
  /** What the engine is actually rendering right now. */
  activePresetId: string | null | undefined;
  /** The visitor started an audio source, so this is their session. */
  audioActive: boolean;
  /** Preset the URL already names, if any. */
  routePresetId: string | null;
}): EngineRoutePublishDecision {
  if (!runtimeReady) {
    return 'runtime-not-ready';
  }
  if (!activePresetId) {
    return 'no-active-preset';
  }
  if (!audioActive && !routePresetId) {
    return 'attract-only';
  }
  return 'publish';
}
