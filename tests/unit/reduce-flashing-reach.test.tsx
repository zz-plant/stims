import { afterEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import type {
  PresetCatalogEntry,
  SessionRouteState,
} from '../../src/js/frontend/contracts.ts';
import { FlashProtectionNotice } from '../../src/js/frontend/FlashProtectionNotice.tsx';
import { useWorkspaceShellOrchestration } from '../../src/js/frontend/workspace-shell-hooks.ts';
import { makePresetEntry, renderWorkspace } from '../frontend-harness.tsx';

const route: SessionRouteState = {
  presetId: 'active',
  collectionTag: null,
  panel: null,
  audioSource: 'demo',
  agentMode: false,
};

const flashy = (): PresetCatalogEntry =>
  makePresetEntry({
    id: 'flashy',
    title: 'Flashy',
    sensoryProfile: {
      flashRiskLevel: 'high',
      maxTransitionsPerSecondEstimate: 5,
      meanLuminance: 0.5,
      maxLuminanceDelta: 0.8,
      measuredAt: '2026-08-20',
    },
  } as Partial<PresetCatalogEntry> as PresetCatalogEntry);

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
  host = null;
  root = null;
  resetAccessibilityPreferenceState();
});

function shuffleTargets(times: number) {
  const commit = jest.fn();
  const catalog = [
    makePresetEntry({ id: 'active', title: 'Active' }),
    flashy(),
    makePresetEntry({ id: 'calm', title: 'Calm' }),
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

describe('Reduce flashing reaches every way a preset gets picked', () => {
  test('shuffle skips a measured high-risk preset while it is on', () => {
    setAccessibilityPreference({ reduceFlashing: true });
    const picks = shuffleTargets(20);
    expect(picks.length).toBe(20);
    expect(picks).not.toContain('flashy');
  });

  test('shuffle can pick it again once the setting is off', () => {
    setAccessibilityPreference({ reduceFlashing: false });
    expect(shuffleTargets(40)).toContain('flashy');
  });
});

describe('the stage notice', () => {
  test('appears while the governor dims the stage', () => {
    const stage = document.createElement('div');
    const rendered = renderWorkspace(<FlashProtectionNotice />);
    try {
      expect(rendered.text()).toBe('');
      act(() => setStageLuminanceChannel(stage, 'governor', 0.6));
      expect(rendered.text()).toContain('Dimming flashes');
      // The visitor's own brightness ceiling is not the governor.
      act(() => {
        setStageLuminanceChannel(stage, 'governor', 1);
        setStageLuminanceChannel(stage, 'ceiling', 0.5);
      });
    } finally {
      act(() => resetStageLuminance(stage));
      rendered.dispose();
    }
  });
});
