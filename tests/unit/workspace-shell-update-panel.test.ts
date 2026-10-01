import { afterEach, describe, expect, jest, test } from 'bun:test';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionRouteState } from '../../src/js/frontend/contracts.ts';
import { useWorkspaceShellOrchestration } from '../../src/js/frontend/workspace-shell-hooks.ts';

/**
 * The shell's panel/preset/audio handlers each own one route field. They
 * used to commit `{ ...routeState, field }` from the render they were created
 * in, which rewrote every other field to that render's values — see the
 * Backspace-with-Browse-open regression in app-shell-route-sync.test.ts.
 */
describe('shell orchestration route commits', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    host?.remove();
    host = null;
    root = null;
  });

  const stale: SessionRouteState = {
    presetId: 'old-preset',
    collectionTag: null,
    panel: 'browse',
    audioSource: 'demo',
    agentMode: false,
  };

  function render(
    commitRoute: (next: unknown) => void,
    overrides: Partial<
      Parameters<typeof useWorkspaceShellOrchestration>[0]
    > = {},
  ) {
    let api: ReturnType<typeof useWorkspaceShellOrchestration> | null = null;
    function Host() {
      api = useWorkspaceShellOrchestration({
        commitRoute: commitRoute as never,
        deferredSearch: '',
        engineSnapshot: null,
        fallbackCatalog: [],
        fallbackCatalogError: null,
        fallbackCatalogReady: true,
        activityCatalog: [],
        goBackPreset: async () => {},
        importPresetFiles: async () => {},
        routeState: stale,
        setStatusMessage: () => {},
        setPlaybackPaused: () => false,
        startAudioSource: async () => {},
        updateEditorSource: () => {},
        stageRef: { current: null },
        youtubePreviewRef: { current: null },
        ...overrides,
      });
      return null;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => {
      root?.render(createElement(Host));
    });
    if (!api) throw new Error('hook did not render');
    return api as ReturnType<typeof useWorkspaceShellOrchestration>;
  }

  /** Applies whatever the handler committed to a route newer than its render. */
  function applyTo(
    commit: jest.Mock,
    newer: SessionRouteState,
  ): SessionRouteState {
    const next = commit.mock.calls.at(-1)?.[0];
    return typeof next === 'function' ? next(newer) : next;
  }

  const newer: SessionRouteState = { ...stale, presetId: 'new-preset' };

  test('closing a panel leaves a preset that moved after the render alone', () => {
    const commit = jest.fn();
    const api = render(commit);
    api.updatePanel(null);
    expect(applyTo(commit, newer)).toEqual({ ...newer, panel: null });
  });

  test('picking a preset and stopping audio change only their own fields', () => {
    const commit = jest.fn();
    const api = render(commit);
    const moved: SessionRouteState = { ...stale, collectionTag: 'ambient' };

    api.handlePresetSelection('picked');
    expect(applyTo(commit, moved)).toEqual({
      ...moved,
      presetId: 'picked',
      panel: null,
    });

    api.handleAudioStop();
    expect(applyTo(commit, newer)).toEqual({ ...newer, audioSource: null });
  });

  /**
   * The start path reports what happened, not just a status line: the agent
   * bridge used to read the status log and wait out a timeout to learn that
   * a start had failed.
   */
  describe('audio start outcome', () => {
    test('a started source says so', async () => {
      const started: string[] = [];
      const api = render(() => {}, {
        startAudioSource: async (request) => {
          started.push(request.source);
        },
      });

      expect(await api.handleAudioStart('demo')).toEqual({
        ok: true,
        source: 'demo',
      });
      expect(started).toEqual(['demo']);
    });

    test('a failed start carries the message the visitor saw', async () => {
      const shown: Array<string | null> = [];
      const api = render(() => {}, {
        setStatusMessage: (message) => shown.push(message),
        startAudioSource: async () => {
          throw new Error('The audio device went away.');
        },
      });

      expect(await api.handleAudioStart('demo')).toEqual({
        ok: false,
        source: null,
        message: 'The audio device went away.',
      });
      expect(shown.at(-1)).toBe('The audio device went away.');
    });

    test('a second start while one is running is refused, not dropped', async () => {
      let release: () => void = () => {};
      let reached: () => void = () => {};
      const inFlight = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const api = render(() => {}, {
        startAudioSource: () =>
          new Promise<void>((resolve) => {
            release = resolve;
            reached();
          }),
      });

      const first = api.handleAudioStart('demo');
      await inFlight;
      const second = await api.handleAudioStart('demo');
      release();

      expect(second.ok).toBe(false);
      expect((await first).ok).toBe(true);
    });
  });
});
