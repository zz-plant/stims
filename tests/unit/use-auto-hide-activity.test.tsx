import { afterEach, describe, expect, jest, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useAutoHideActivity } from '../../src/js/frontend/hooks/useAutoHideActivity.ts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  jest.useRealTimers();
  document.body.replaceChildren();
});

function ActivityHarness({ delayMs }: { delayMs: number }) {
  const { visible, signalActivity } = useAutoHideActivity(delayMs, false);

  return createElement(
    'button',
    {
      type: 'button',
      'data-visible': visible,
      onPointerMove: signalActivity,
    },
    'activity target',
  );
}

describe('useAutoHideActivity', () => {
  test('coalesces a pointer-event burst into one active timeout', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(createElement(ActivityHarness, { delayMs: 1000 })));
    const button = container.querySelector('button');

    act(() => {
      for (let index = 0; index < 50; index += 1) {
        button?.dispatchEvent(new Event('pointermove', { bubbles: true }));
      }
    });

    expect(button?.getAttribute('data-visible')).toBe('true');
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
    act(() => root.unmount());
  });

  test('hides after inactivity measured from the latest event', () => {
    jest.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(createElement(ActivityHarness, { delayMs: 1000 })));
    const button = container.querySelector('button');
    act(() => {
      button?.dispatchEvent(new Event('pointermove', { bubbles: true }));
      jest.advanceTimersByTime(800);
      button?.dispatchEvent(new Event('pointermove', { bubbles: true }));
      jest.advanceTimersByTime(999);
    });
    expect(button?.getAttribute('data-visible')).toBe('true');

    act(() => jest.advanceTimersByTime(1));
    expect(button?.getAttribute('data-visible')).toBe('false');
    act(() => root.unmount());
  });
});
