import { describe, expect, test } from 'bun:test';
import { startGamepadPerformanceSource } from '../../src/js/core/services/gamepad-performance-source.ts';
import { VIRTUAL_GAMEPAD_DEVICE_ID } from '../../src/js/core/services/webmidi-controller.ts';

type CcCall = [string, number, number];
type NoteCall = [string, number, boolean, number];

/** Records what the source injects, and lets a test advance polling by hand
 * instead of waiting on rAF. */
function makeHarness(pads: Array<Partial<Gamepad> | null>) {
  const cc: CcCall[] = [];
  const notes: NoteCall[] = [];
  let pending: (() => void) | null = null;

  const stop = startGamepadPerformanceSource(
    {
      injectControlChange: (deviceId, ccNumber, raw) => {
        cc.push([deviceId, ccNumber, raw]);
        return { cc: ccNumber, raw };
      },
      injectNote: (deviceId, note, on, velocity) => {
        notes.push([deviceId, note, on, velocity ?? 0]);
      },
    },
    {
      requestFrame: (callback) => {
        pending = callback;
        return 1;
      },
      cancelFrame: () => {
        pending = null;
      },
      getGamepads: () => pads as Array<Gamepad | null>,
    },
  );

  return {
    cc,
    notes,
    stop,
    tick() {
      const next = pending;
      pending = null;
      next?.();
    },
    get isScheduled() {
      return pending !== null;
    },
  };
}

function makePad(
  axes: number[],
  buttons: Array<{ pressed: boolean; value: number }> = [],
): Partial<Gamepad> {
  return {
    connected: true,
    axes,
    buttons: buttons as unknown as GamepadButton[],
  };
}

describe('gamepad performance source', () => {
  test('maps a centred stick to the middle of the CC range, not zero', () => {
    const h = makeHarness([makePad([0, 0, 0, 0])]);
    h.tick();
    // A centred stick must sit mid-range so a bound parameter rests at the
    // middle of its span rather than pinned to the bottom.
    expect(h.cc[0]).toEqual([VIRTUAL_GAMEPAD_DEVICE_ID, 0, 64]);
    h.stop();
  });

  test('maps full stick deflection to the CC extremes', () => {
    const h = makeHarness([makePad([-1, 1, 0, 0])]);
    h.tick();
    expect(h.cc.find(([, cc]) => cc === 0)?.[2]).toBe(0);
    expect(h.cc.find(([, cc]) => cc === 1)?.[2]).toBe(127);
    h.stop();
  });

  test('applies a deadzone so a resting stick does not drift a parameter', () => {
    const h = makeHarness([makePad([0.05, -0.05, 0, 0])]);
    h.tick();
    // Both are inside the deadzone, so both read as centred.
    expect(h.cc[0][2]).toBe(64);
    expect(h.cc[1][2]).toBe(64);
    h.stop();
  });

  test('does not re-emit an unchanged axis every frame', () => {
    const pad = makePad([0.5, 0, 0, 0]);
    const h = makeHarness([pad]);
    h.tick();
    const afterFirst = h.cc.length;
    h.tick();
    h.tick();
    // Idle polling must stay silent — every message runs the full binding,
    // apply, and feedback path.
    expect(h.cc.length).toBe(afterFirst);
    h.stop();
  });

  test('sends analog trigger position as CC, not just pressed/released', () => {
    const buttons = Array.from({ length: 8 }, () => ({
      pressed: false,
      value: 0,
    }));
    buttons[6] = { pressed: true, value: 0.5 };
    const h = makeHarness([makePad([0, 0, 0, 0], buttons)]);
    h.tick();

    const trigger = h.cc.find(([, cc]) => cc === 4);
    expect(trigger?.[2]).toBe(64);
    // A trigger rides a parameter, so it must not also fire as a note.
    expect(h.notes.some(([, note]) => note === 6)).toBe(false);
    h.stop();
  });

  test('emits buttons as note press and release edges only', () => {
    const buttons = [{ pressed: false, value: 0 }];
    const pad = makePad([0, 0, 0, 0], buttons);
    const h = makeHarness([pad]);
    h.tick();

    buttons[0] = { pressed: true, value: 1 };
    h.tick();
    buttons[0] = { pressed: false, value: 0 };
    h.tick();

    expect(h.notes).toEqual([
      [VIRTUAL_GAMEPAD_DEVICE_ID, 0, false, 0],
      [VIRTUAL_GAMEPAD_DEVICE_ID, 0, true, 127],
      [VIRTUAL_GAMEPAD_DEVICE_ID, 0, false, 0],
    ]);
    h.stop();
  });

  test('emits nothing when no gamepad is connected, and keeps polling', () => {
    const h = makeHarness([null]);
    h.tick();
    expect(h.cc).toEqual([]);
    expect(h.notes).toEqual([]);
    // Still scheduled, so plugging a pad in later starts working.
    expect(h.isScheduled).toBe(true);
    h.stop();
  });

  test('ignores a disconnected pad entry', () => {
    const h = makeHarness([{ connected: false, axes: [1, 1], buttons: [] }]);
    h.tick();
    expect(h.cc).toEqual([]);
    h.stop();
  });

  test('stopping halts polling', () => {
    const h = makeHarness([makePad([0, 0, 0, 0])]);
    h.tick();
    h.stop();
    expect(h.isScheduled).toBe(false);
  });
});
