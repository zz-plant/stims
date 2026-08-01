import { describe, expect, it } from 'bun:test';
import { bindMidiToMilkdropControls } from '../../src/js/frontend/performance-hardware-controls.ts';

describe('performance hardware controls', () => {
  it('routes mapped MIDI CC values into live MilkDrop controls', () => {
    let midiListener:
      | ((
          cc: number,
          raw: number,
          target?: string,
          normalized?: number,
        ) => void)
      | null = null;
    let unsubscribed = false;
    const midi = {
      onControlChange(listener: typeof midiListener) {
        midiListener = listener;
        return () => {
          unsubscribed = true;
        };
      },
    };
    const applied: Array<[string, number]> = [];

    const unsubscribe = bindMidiToMilkdropControls(midi, (target, value) => {
      applied.push([target, value]);
    });

    (
      midiListener as unknown as (
        cc: number,
        raw: number,
        target?: string,
        normalized?: number,
      ) => void
    )(1, 127, 'zoom', 1.2);
    (
      midiListener as unknown as (
        cc: number,
        raw: number,
        target?: string,
        normalized?: number,
      ) => void
    )(15, 64);

    expect(applied).toEqual([['zoom', 1.2]]);
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });
});
