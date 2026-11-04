import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
  getActiveAccessibilityPreference,
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
import { SettingsSheetPanel } from '../../src/js/frontend/SettingsSheetPanel.tsx';
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
    const rendered = renderWorkspace(
      <FlashProtectionNotice onOpenSetting={() => {}} />,
    );
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

  test('its button asks for the setting and leaves protection on', () => {
    const stage = document.createElement('div');
    setAccessibilityPreference({ reduceFlashing: true });
    const onOpenSetting = jest.fn();
    const rendered = renderWorkspace(
      <FlashProtectionNotice onOpenSetting={onOpenSetting} />,
    );
    try {
      act(() => setStageLuminanceChannel(stage, 'governor', 0.6));
      rendered.click(rendered.container.querySelector('button'));
      expect(onOpenSetting).toHaveBeenCalledTimes(1);
      expect(getActiveAccessibilityPreference().reduceFlashing).toBe(true);
    } finally {
      act(() => resetStageLuminance(stage));
      rendered.dispose();
    }
  });

  test('it stays while focused after the dimming ends, then leaves', () => {
    const stage = document.createElement('div');
    const pending = new Map<number, () => void>();
    let nextTimer = 1;
    const setTimeoutSpy = jest.spyOn(window, 'setTimeout').mockImplementation(((
      callback: () => void,
    ) => {
      const id = nextTimer++;
      pending.set(id, callback);
      return id;
    }) as unknown as typeof window.setTimeout);
    const clearTimeoutSpy = jest
      .spyOn(window, 'clearTimeout')
      .mockImplementation(((id: number) => {
        pending.delete(id);
      }) as unknown as typeof window.clearTimeout);
    const fireTimers = () =>
      act(() => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const callback of callbacks) callback();
      });
    const rendered = renderWorkspace(
      <FlashProtectionNotice onOpenSetting={() => {}} />,
    );
    try {
      act(() => setStageLuminanceChannel(stage, 'governor', 0.6));
      const button = rendered.container.querySelector('button');
      act(() => button?.focus());
      act(() => setStageLuminanceChannel(stage, 'governor', 1));
      fireTimers();
      expect(rendered.text()).toContain('Dimming flashes');

      act(() => button?.blur());
      fireTimers();
      expect(rendered.text()).toBe('');
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      act(() => resetStageLuminance(stage));
      rendered.dispose();
    }
  });
});

describe('Settings opened from the stage notice', () => {
  // The panel builds links from the page's origin, so it needs a real one.
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://toil.fyi/'),
    });
  });
  afterEach(() => {
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  const settingsProps = {
    onCompatibilityModeChange: () => {},
    onMotionPreferenceChange: () => {},
    onOpenShortcuts: () => {},
    onOpenCredits: () => {},
  };

  test('lands on the Reduce flashing switch', async () => {
    const onRevealed = jest.fn();
    const rendered = renderWorkspace(
      <SettingsSheetPanel
        {...settingsProps}
        revealReduceFlashing
        onReduceFlashingRevealed={onRevealed}
      />,
    );
    try {
      expect(
        rendered.container.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent,
      ).toBe('Appearance and device');
      await act(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      const focused = document.activeElement as HTMLElement;
      expect(focused.getAttribute('role')).toBe('switch');
      expect(focused.closest('label')?.textContent).toContain(
        'Reduce flashing',
      );
      expect(onRevealed).toHaveBeenCalledTimes(1);
    } finally {
      rendered.dispose();
    }
  });

  test('opens on its usual tab otherwise', () => {
    const rendered = renderWorkspace(<SettingsSheetPanel {...settingsProps} />);
    try {
      expect(
        rendered.container.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent,
      ).toBe('Playback and audio');
    } finally {
      rendered.dispose();
    }
  });
});
