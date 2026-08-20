import { describe, expect, test } from 'bun:test';
import {
  createEmptyEngineSnapshot,
  type EngineSnapshot,
} from '../../src/js/frontend/engine/engine-snapshot.ts';
import { coarseEngineSnapshotEqual } from '../../src/js/frontend/workspace-context.tsx';

/**
 * The engine snapshot context memo republishes to useEngineSnapshot consumers
 * only when coarseEngineSnapshotEqual reports a difference. A field missing
 * from that comparison silently stops propagating: setBlendDuration(5) updated
 * the runtime and localStorage, but the Settings panel kept rendering the old
 * value until a full page reload, because blendDuration (with transitionMode,
 * autoplay, and audioEndedAt) was left out of the coarse check.
 *
 * This test enumerates EngineSnapshot's fields so a future field added to the
 * snapshot but forgotten in the comparison fails here instead of shipping the
 * same bug again.
 */

// Fields the context intentionally does NOT republish on:
// - audioEnergy/audioBass/audioMid/audioTreble churn per frame while audio
//   plays; they flow through the dedicated audio-energy store instead, and
//   comparing them would re-render every consumer at frame rate.
// - currentSource is derived from sessionState.source inside
//   buildEngineSnapshot, so it cannot change without the sessionState identity
//   changing; the sessionState check covers it.
const INTENTIONALLY_SKIPPED: ReadonlySet<keyof EngineSnapshot> = new Set([
  'audioEnergy',
  'audioBass',
  'audioMid',
  'audioTreble',
  'currentSource',
] as const);

// A distinguishable replacement value per field. When a new field is added to
// EngineSnapshot, this map (and coarseEngineSnapshotEqual, unless the field is
// deliberately skipped) must gain an entry — the loop below fails otherwise.
const CHANGED_VALUES: { [K in keyof EngineSnapshot]: EngineSnapshot[K] } = {
  activePresetId: 'another-preset',
  backend: 'webgpu',
  status: 'changed status',
  adaptiveQuality: { qualityStep: 1 } as EngineSnapshot['adaptiveQuality'],
  catalogEntries: [
    { id: 'p', title: 'P', author: 'A', tags: [] },
  ] as EngineSnapshot['catalogEntries'],
  sessionState: { source: 'x' } as EngineSnapshot['sessionState'],
  currentSource: 'x',
  runtimeReady: true,
  audioActive: true,
  audioSource: 'demo',
  audioEnergy: 0.9,
  audioBass: 0.9,
  audioMid: 0.9,
  audioTreble: 0.9,
  audioEndedAt: 1234567890,
  tempoBpm: 128,
  autoplay: true,
  transitionMode: 'cut',
  blendDuration: 5,
};

describe('coarseEngineSnapshotEqual', () => {
  test('identical snapshots are equal', () => {
    const snap = createEmptyEngineSnapshot();
    expect(coarseEngineSnapshotEqual(snap, { ...snap })).toBe(true);
  });

  test('every non-skipped snapshot field triggers republish when it changes', () => {
    const base = createEmptyEngineSnapshot();
    for (const key of Object.keys(base) as Array<keyof EngineSnapshot>) {
      if (!(key in CHANGED_VALUES)) {
        throw new Error(
          `EngineSnapshot gained field "${key}" — add it to CHANGED_VALUES ` +
            'and to coarseEngineSnapshotEqual (or to INTENTIONALLY_SKIPPED ' +
            'with a reason).',
        );
      }
      if (INTENTIONALLY_SKIPPED.has(key)) {
        continue;
      }
      const mutated = { ...base, [key]: CHANGED_VALUES[key] };
      expect(base[key]).not.toEqual(mutated[key]);
      expect(
        coarseEngineSnapshotEqual(base, mutated),
        `changing "${key}" must republish the engine snapshot context`,
      ).toBe(false);
    }
  });

  test('blendDuration change alone republishes (the stale Settings bug)', () => {
    const base = createEmptyEngineSnapshot();
    expect(coarseEngineSnapshotEqual(base, { ...base, blendDuration: 5 })).toBe(
      false,
    );
  });

  test('audio energy churn alone does not republish', () => {
    const base = createEmptyEngineSnapshot();
    const churn = {
      ...base,
      audioEnergy: 0.42,
      audioBass: 0.1,
      audioMid: 0.2,
      audioTreble: 0.3,
    };
    expect(coarseEngineSnapshotEqual(base, churn)).toBe(true);
  });
});
