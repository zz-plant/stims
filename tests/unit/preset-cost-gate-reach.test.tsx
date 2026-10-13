import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { resetAccessibilityPreferenceState } from '../../src/js/core/accessibility-preferences.ts';
import {
  installPresetFrameCostDataForTests,
  LOW_TIER_FRAME_WORK_BUDGET_MS,
  resetPresetFrameCostData,
} from '../../src/js/core/preset-cost-signal.ts';
import type {
  PresetCatalogEntry,
  SessionRouteState,
} from '../../src/js/frontend/contracts.ts';
import { useWorkspaceShellOrchestration } from '../../src/js/frontend/workspace-shell-hooks.ts';
import { makePresetEntry } from '../frontend-harness.tsx';

/**
 * Shuffle reach of the performance-cost gate, mirroring the Reduce flashing
 * precedent (reduce-flashing-reach.test.tsx): the gate only counts if the
 * place shuffle actually picks from cannot reach a measured-too-heavy preset
 * on a low-tier device — while leaving every pool untouched on stronger
 * hardware and whenever the sidecar holds no measurement.
 */

const route: SessionRouteState = {
  presetId: 'active',
  collectionTag: null,
  panel: null,
  audioSource: 'demo',
  agentMode: false,
};

/** Hardware facts that resolve to the `low` device tier (see device-profile.ts). */
const LOW_TIER_NAVIGATOR = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  hardwareConcurrency: 2,
  deviceMemory: 2,
};

/** Hardware facts that resolve to the `high` device tier. */
const HIGH_TIER_NAVIGATOR = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  hardwareConcurrency: 8,
  deviceMemory: 8,
};

const HEAVY_FRAME_WORK_MS = LOW_TIER_FRAME_WORK_BUDGET_MS * 2;

function costSnapshot(entries: Record<string, number>) {
  return {
    version: 1,
    entries: Object.fromEntries(
      Object.entries(entries).map(([presetId, frameWorkMs]) => [
        presetId,
        {
          frameWorkMs,
          tier: 'apple-m2-pro',
          qualityStep: 1,
          measuredAt: '2026-10-11',
          instrument: 'perf:certification-corpus',
        },
      ]),
    ),
  };
}

const originalNavigator = globalThis.navigator;

let host: HTMLElement | null = null;
let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  host?.remove();
  host = null;
  root = null;
  resetPresetFrameCostData();
  resetAccessibilityPreferenceState();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

function shuffleTargets(times: number) {
  const commit = jest.fn();
  const catalog: PresetCatalogEntry[] = [
    makePresetEntry({ id: 'active', title: 'Active' }),
    makePresetEntry({ id: 'heavy', title: 'Heavy' }),
    makePresetEntry({ id: 'light', title: 'Light' }),
  ];
  let api: ReturnType<typeof useWorkspaceShellOrchestration> | null = null;
  function Host() {
    api = useWorkspaceShellOrchestration({
      commitRoute: commit as never,
      deferredSearch: '',
      engineSnapshot: null,
      fallbackCatalog: catalog,
      fallbackCatalogError: null,
      fallbackCatalogReady: true,
      activityCatalog: [],
      goBackPreset: async () => {},
      importPresetFiles: async () => {},
      routeState: route,
      setStatusMessage: () => {},
      setPlaybackPaused: () => false,
      startAudioSource: async () => {},
      updateEditorSource: () => {},
      stageRef: { current: null },
      youtubePreviewRef: { current: null },
    });
    return null;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root?.render(createElement(Host)));
  for (let i = 0; i < times; i += 1) {
    (
      api as ReturnType<typeof useWorkspaceShellOrchestration> | null
    )?.handleShufflePreset();
  }
  return commit.mock.calls.map((call) => {
    const next = call[0];
    return (typeof next === 'function' ? next(route) : next).presetId;
  });
}

describe('the frame-cost gate reaches shuffle', () => {
  test('shuffle skips a measured-too-heavy preset on a low-tier device', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: LOW_TIER_NAVIGATOR,
    });
    installPresetFrameCostDataForTests(
      costSnapshot({ heavy: HEAVY_FRAME_WORK_MS }),
    );

    const picks = shuffleTargets(40);
    expect(picks.length).toBe(40);
    expect(picks).not.toContain('heavy');
  });

  test('with no measurement for it, the same preset is back in the pool', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: LOW_TIER_NAVIGATOR,
    });
    // Signal present but this preset unmeasured: absent data must leave the
    // pool exactly as wide as before the feature existed.
    installPresetFrameCostDataForTests(
      costSnapshot({ 'some-other-preset': HEAVY_FRAME_WORK_MS }),
    );

    expect(shuffleTargets(40)).toContain('heavy');
  });

  test('a strong device is never gated, even for a measured-heavy preset', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: HIGH_TIER_NAVIGATOR,
    });
    installPresetFrameCostDataForTests(
      costSnapshot({ heavy: HEAVY_FRAME_WORK_MS }),
    );

    expect(shuffleTargets(40)).toContain('heavy');
  });
});
