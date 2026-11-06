import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createEmptyEngineSnapshot,
  type EngineSnapshot,
} from '../../src/js/frontend/engine/engine-snapshot.ts';
import type { EngineSnapshotValue } from '../../src/js/frontend/engine-context.tsx';
import { useCoarseEngineSnapshotValue } from '../../src/js/frontend/workspace-context.tsx';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The provider hands this value to every useEngineSnapshot consumer, so its
 * identity is the re-render boundary: a new object per audio frame re-rendered
 * every consumer at frame rate. These pin that the identity holds across
 * audio-only churn and changes when a coarse field does.
 */
function mountProbe() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const seen: EngineSnapshotValue[] = [];
  function Probe({ snap }: { snap: EngineSnapshot | null }) {
    seen.push(useCoarseEngineSnapshotValue(snap));
    return null;
  }
  return {
    render: (snap: EngineSnapshot | null) =>
      act(() => root.render(<Probe snap={snap} />)),
    last: () => seen[seen.length - 1],
    dispose: () => act(() => root.unmount()),
  };
}

describe('useCoarseEngineSnapshotValue', () => {
  test('keeps its identity while only audio energy changes', () => {
    const probe = mountProbe();
    const base = createEmptyEngineSnapshot();
    probe.render(base);
    const first = probe.last();
    probe.render({ ...base, audioEnergy: 0.4, audioBass: 0.2 });
    probe.render({ ...base, audioEnergy: 0.7, audioTreble: 0.5 });
    expect(probe.last()).toBe(first);
    expect(probe.last().engineSnapshot).toBe(base);
    probe.dispose();
  });

  test('publishes a new value when a coarse field changes', () => {
    const probe = mountProbe();
    const base = createEmptyEngineSnapshot();
    probe.render(base);
    const first = probe.last();
    const paused = { ...base, playbackPaused: !base.playbackPaused };
    probe.render(paused);
    expect(probe.last()).not.toBe(first);
    expect(probe.last().engineSnapshot).toBe(paused);
    probe.dispose();
  });

  test('publishes when the snapshot appears or goes away', () => {
    const probe = mountProbe();
    probe.render(null);
    const empty = probe.last();
    const snap = createEmptyEngineSnapshot();
    probe.render(snap);
    expect(probe.last()).not.toBe(empty);
    expect(probe.last().engineSnapshot).toBe(snap);
    probe.render(null);
    expect(probe.last().engineSnapshot).toBeNull();
    probe.dispose();
  });
});
