/**
 * Route <-> engine preset sync arbitration.
 *
 * The regression this guards: the engine can change preset on its own
 * (autoplay advance, WebGL fallback, an in-canvas keyboard shortcut). The
 * route -> engine effect re-runs on that snapshot change with a `routeState`
 * that has not caught up, and used to push the now-stale route preset back
 * into the engine while usePresetRouteSync pulled the URL forward — the two
 * fought and the stage and address bar flickered between two presets.
 */
import { describe, expect, test } from 'bun:test';
import { decidePresetRoutePush } from '../../src/js/frontend/preset-route-push.ts';

const base = {
  engineMounted: true,
  requestedPresetId: 'preset-a' as string | null,
  activePresetId: 'preset-a' as string | null | undefined,
  handledRouteRequestId: null as string | null,
  pendingPresetId: null as string | null,
  hasFailed: false,
};

describe('decidePresetRoutePush', () => {
  test('loads a newly requested route preset', () => {
    expect(
      decidePresetRoutePush({
        ...base,
        requestedPresetId: 'preset-b',
        activePresetId: 'preset-a',
      }),
    ).toBe('load');
  });

  test('does nothing when the engine already renders the requested preset', () => {
    expect(
      decidePresetRoutePush({
        ...base,
        requestedPresetId: 'preset-a',
        activePresetId: 'preset-a',
      }),
    ).toBe('already-active');
  });

  test('defers until the engine is mounted', () => {
    expect(
      decidePresetRoutePush({
        ...base,
        engineMounted: false,
        requestedPresetId: 'preset-b',
      }),
    ).toBe('engine-not-mounted');
  });

  test('does not re-request a preset that already failed', () => {
    expect(
      decidePresetRoutePush({
        ...base,
        requestedPresetId: 'preset-b',
        activePresetId: 'preset-a',
        hasFailed: true,
      }),
    ).toBe('already-failed');
  });

  test('does not re-request a load that is still in flight', () => {
    expect(
      decidePresetRoutePush({
        ...base,
        requestedPresetId: 'preset-b',
        activePresetId: 'preset-a',
        pendingPresetId: 'preset-b',
      }),
    ).toBe('in-flight');
  });

  // ── The flicker regression ────────────────────────────────────────────
  test('does not push the stale route preset back after the engine self-navigates', () => {
    // Route asked for A and this sync handled it; the engine then advanced to
    // B on its own (autoplay). routeState still says A in this commit.
    expect(
      decidePresetRoutePush({
        engineMounted: true,
        requestedPresetId: 'preset-a',
        activePresetId: 'preset-b',
        handledRouteRequestId: 'preset-a',
        pendingPresetId: null,
        hasFailed: false,
      }),
    ).toBe('engine-moved');
  });

  test('a real route change after an engine self-navigation still loads', () => {
    // Same state as above, except the visitor picked C — the route genuinely
    // changed, so the push must not be suppressed.
    expect(
      decidePresetRoutePush({
        engineMounted: true,
        requestedPresetId: 'preset-c',
        activePresetId: 'preset-b',
        handledRouteRequestId: 'preset-a',
        pendingPresetId: null,
        hasFailed: false,
      }),
    ).toBe('load');
  });

  test('navigating back to a previously handled preset loads again', () => {
    // A -> B -> A: the last handled id is B, so returning to A is a real
    // route change and must load rather than be swallowed as "engine moved".
    expect(
      decidePresetRoutePush({
        engineMounted: true,
        requestedPresetId: 'preset-a',
        activePresetId: 'preset-b',
        handledRouteRequestId: 'preset-b',
        pendingPresetId: null,
        hasFailed: false,
      }),
    ).toBe('load');
  });

  test('an autoplay run does not fight the route on every advance', () => {
    // Simulates the loop that produced the flicker: the engine keeps moving,
    // and each time the route sync has already handled the current route id.
    const handled = 'preset-a';
    const advances = ['preset-b', 'preset-c', 'preset-d'];
    const decisions = advances.map((active) =>
      decidePresetRoutePush({
        engineMounted: true,
        requestedPresetId: 'preset-a',
        activePresetId: active,
        // Stays put: an engine-initiated move must not re-arm this sync.
        handledRouteRequestId: handled,
        pendingPresetId: null,
        hasFailed: false,
      }),
    );
    expect(decisions).toEqual(['engine-moved', 'engine-moved', 'engine-moved']);
  });
});
