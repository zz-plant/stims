import { describe, expect, mock, test } from 'bun:test';
import {
  createFlowTimer,
  getFlowIntervalMs,
} from '../assets/js/loader/flow-timer.ts';

describe('flow-timer helpers', () => {
  test('computes warmup, engaged, and idle intervals', () => {
    expect(
      getFlowIntervalMs({ cycleCount: 0, lastInteractionAt: 100, now: 200 }),
    ).toBe(60000);
    expect(
      getFlowIntervalMs({
        cycleCount: 2,
        lastInteractionAt: 100_000,
        now: 180_000,
      }),
    ).toBe(90000);
    expect(
      getFlowIntervalMs({
        cycleCount: 2,
        lastInteractionAt: 100_000,
        now: 240_001,
      }),
    ).toBe(120000);
  });

  test('schedules and clears timeouts using injected window', () => {
    const setTimeoutMock = mock((_cb: () => void, _delay: number) => 12);
    const clearTimeoutMock = mock((_id: number) => {});
    const onTick = mock(() => {});

    const timer = createFlowTimer({
      getDelay: () => 123,
      onTick,
      windowRef: () =>
        ({
          setTimeout: setTimeoutMock,
          clearTimeout: clearTimeoutMock,
        }) as unknown as Window,
    });

    timer.schedule();
    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 123);
    timer.clear();
    expect(clearTimeoutMock).toHaveBeenCalledWith(12);
  });
});
