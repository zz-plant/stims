import { describe, expect, test } from 'bun:test';
import {
  cyclePresetWaveMode,
  NUDGE_TARGETS,
  nudgePresetField,
} from '../../src/js/frontend/preset-nudges.ts';
import type { MilkdropCompiledPreset } from '../../src/js/milkdrop/types.ts';

/**
 * The keyboard nudges the runtime used to own, now shell actions. What
 * matters is that each step lands where the old handler did (same delta,
 * clamp and rounding) and that a person is told the value — the old layer
 * announced only to the agent debug snapshot.
 */

function fakeEngine(fields: Record<string, number>) {
  const applied: Record<string, string | number>[] = [];
  const messages: string[] = [];
  const engine = {
    getActiveCompiledPreset: () =>
      ({ ir: { numericFields: fields } }) as unknown as MilkdropCompiledPreset,
    applyEditorFieldsAwaited: async (
      updates: Record<string, string | number>,
    ) => {
      applied.push(updates);
      return null;
    },
  };
  return {
    engine,
    applied,
    messages,
    announce: (m: string) => messages.push(m),
  };
}

describe('preset nudges', () => {
  test('steps a field by its delta and says where it landed', async () => {
    const { engine, applied, messages, announce } = fakeEngine({ zoom: 1 });

    const next = await nudgePresetField(engine, 'zoom', 1, announce);

    expect(next).toBe(1.02);
    expect(applied).toEqual([{ zoom: 1.02 }]);
    expect(messages).toEqual(['Zoom: 1.02']);
  });

  test('clamps at the field range', async () => {
    const { engine, applied, announce } = fakeEngine({ warp: 0.995 });

    await nudgePresetField(engine, 'warp', 1, announce);
    expect(applied).toEqual([{ warp: NUDGE_TARGETS.warp.max }]);
  });

  test('a missing field starts from zero, like the runtime did', async () => {
    const { engine, applied, announce } = fakeEngine({});

    await nudgePresetField(engine, 'rotation', -1, announce);
    expect(applied).toEqual([{ rot: -0.003 }]);
  });

  test('wave mode wraps in both directions', async () => {
    const forward = fakeEngine({ wave_mode: 7 });
    await cyclePresetWaveMode(forward.engine, 1, forward.announce);
    expect(forward.applied).toEqual([{ wave_mode: 0 }]);
    expect(forward.messages).toEqual(['Wave mode: 0']);

    const back = fakeEngine({ wave_mode: 0 });
    await cyclePresetWaveMode(back.engine, -1, back.announce);
    expect(back.applied).toEqual([{ wave_mode: 7 }]);
  });

  test('with nothing compiled it explains rather than throwing', async () => {
    const messages: string[] = [];
    const engine = {
      getActiveCompiledPreset: () => null,
      applyEditorFieldsAwaited: async () => null,
    };

    const result = await nudgePresetField(engine, 'zoom', 1, (m) =>
      messages.push(m),
    );

    expect(result).toBeNull();
    expect(messages).toEqual(['Nothing is playing to adjust yet.']);
  });
});
