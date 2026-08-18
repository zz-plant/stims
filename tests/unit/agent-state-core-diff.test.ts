import { describe, expect, test } from 'bun:test';
import {
  type AgentCoreSnapshot,
  CORE_SNAPSHOT_DIFF_DESCRIPTORS,
  CORE_SNAPSHOT_INTENTIONALLY_SKIPPED,
  emitAgentCommit,
  getAgentEventsForTests,
  resetAgentStateForTests,
} from '../../src/js/frontend/agent-state.ts';

/**
 * Paired with tests/unit/workspace-engine-snapshot-coarse.test.ts, which
 * catches an EngineSnapshot field silently dropped from re-render triggers.
 * This test catches the analogous gap one layer out: an AgentCoreSnapshot
 * field silently dropped from emitAgentCommit's event log, so
 * getEvents()-based automation (and CI failure artifacts built on it) never
 * observes a change that getState() would show happened.
 */

const BASE: AgentCoreSnapshot = {
  engineState: 'ready',
  engineReady: true,
  liveMode: false,
  backend: 'webgl',
  panel: null,
  presetId: 'preset-a',
  presetTitle: 'Preset A',
  audioSource: null,
  audioEnergy: 0,
  autoplay: false,
  transition: { mode: 'blend', blendDuration: 2 },
};

const CHANGED_VALUES: { [K in keyof AgentCoreSnapshot]: AgentCoreSnapshot[K] } =
  {
    engineState: 'live',
    engineReady: false,
    liveMode: true,
    backend: 'webgpu',
    panel: 'browse',
    presetId: 'preset-b',
    presetTitle: 'Preset B',
    audioSource: 'demo',
    audioEnergy: 0.5,
    autoplay: true,
    transition: { mode: 'cut', blendDuration: 0 },
  };

describe('agent-state core snapshot diff coupling', () => {
  test('every AgentCoreSnapshot field is covered or intentionally skipped', () => {
    const coveredFields = new Set(
      CORE_SNAPSHOT_DIFF_DESCRIPTORS.flatMap((d) => d.fields),
    );
    for (const key of Object.keys(BASE) as Array<keyof AgentCoreSnapshot>) {
      if (!(key in CHANGED_VALUES)) {
        throw new Error(
          `AgentCoreSnapshot gained field "${key}" — add it to CHANGED_VALUES ` +
            'in this test, and to a CORE_SNAPSHOT_DIFF_DESCRIPTORS entry (or ' +
            'to CORE_SNAPSHOT_INTENTIONALLY_SKIPPED with a reason).',
        );
      }
      const covered = coveredFields.has(key);
      const skipped = CORE_SNAPSHOT_INTENTIONALLY_SKIPPED.has(key);
      expect(
        covered || skipped,
        `"${key}" must be covered by a diff descriptor or listed in ` +
          'CORE_SNAPSHOT_INTENTIONALLY_SKIPPED',
      ).toBe(true);
      // A field cannot be both — that would mean a descriptor exists for
      // something declared unobservable, which is just dead code the next
      // reader has to puzzle over.
      expect(covered && skipped).toBe(false);
    }
  });

  test('every non-skipped field change produces an event when committed', () => {
    for (const key of Object.keys(BASE) as Array<keyof AgentCoreSnapshot>) {
      if (CORE_SNAPSHOT_INTENTIONALLY_SKIPPED.has(key)) continue;
      resetAgentStateForTests();
      emitAgentCommit(BASE);
      const mutated: AgentCoreSnapshot = {
        ...BASE,
        [key]: CHANGED_VALUES[key],
      };
      expect(BASE[key]).not.toEqual(mutated[key]);
      emitAgentCommit(mutated);
      const events = getAgentEventsForTests();
      expect(
        events.length,
        `changing "${key}" must push at least one agent event`,
      ).toBeGreaterThan(0);
    }
  });

  test('intentionally skipped fields alone do not produce an event', () => {
    resetAgentStateForTests();
    emitAgentCommit(BASE);
    let mutated: AgentCoreSnapshot = { ...BASE };
    for (const key of CORE_SNAPSHOT_INTENTIONALLY_SKIPPED) {
      mutated = { ...mutated, [key]: CHANGED_VALUES[key] };
    }
    emitAgentCommit(mutated);
    expect(getAgentEventsForTests()).toEqual([]);
  });

  test('identical commits produce no events', () => {
    resetAgentStateForTests();
    emitAgentCommit(BASE);
    emitAgentCommit({ ...BASE });
    expect(getAgentEventsForTests()).toEqual([]);
  });
});
