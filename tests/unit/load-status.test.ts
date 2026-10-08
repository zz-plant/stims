/**
 * `afterLoadPhasePainted` gates a deep link's engine mount on the launch page
 * having painted. Too early and the engine's chunks compete with that page
 * for the connection; never, and the visitor is stranded on the launch page.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  flushAnimationFrame,
  installAnimationFrameController,
} from '../environment/animation-frame.ts';
import { flushTasks, importFresh } from '../test-helpers.ts';

type LoadStatusModule = typeof import('../../src/js/frontend/load-status.ts');

// Fresh per test: the module remembers which phases it has seen.
const load = () =>
  importFresh<LoadStatusModule>('../../src/js/frontend/load-status.ts');

const NO_TIMEOUT = { timeoutMs: 60_000 };

beforeEach(() => {
  installAnimationFrameController({ autoAdvance: false });
});

afterEach(() => {
  installAnimationFrameController();
});

describe('afterLoadPhasePainted', () => {
  test('waits for the phase, then for a frame to be presented', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    const calls: string[] = [];
    afterLoadPhasePainted(
      'launch-rendered',
      () => calls.push('ran'),
      NO_TIMEOUT,
    );

    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual([]);

    reportLoadStatus('launch-rendered');
    await flushTasks(2);
    expect(calls).toEqual([]);

    // The first frame's callback runs before that frame paints.
    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual([]);

    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual(['ran']);
  });

  test('a phase reported before the wait began still releases it', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    reportLoadStatus('launch-rendered');
    const calls: string[] = [];
    afterLoadPhasePainted(
      'launch-rendered',
      () => calls.push('ran'),
      NO_TIMEOUT,
    );

    flushAnimationFrame();
    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual(['ran']);
  });

  test('other phases do not release it', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    const calls: string[] = [];
    afterLoadPhasePainted(
      'launch-rendered',
      () => calls.push('ran'),
      NO_TIMEOUT,
    );

    reportLoadStatus('shell-rendered');
    reportLoadStatus('starter-catalog');
    flushAnimationFrame();
    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual([]);
  });

  test('gives up waiting once the timeout passes', async () => {
    const { afterLoadPhasePainted } = await load();
    const calls: string[] = [];
    afterLoadPhasePainted('launch-rendered', () => calls.push('ran'), {
      timeoutMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    flushAnimationFrame();
    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual(['ran']);
  });

  test('runs once even when the phase and the timeout both arrive', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    const calls: string[] = [];
    afterLoadPhasePainted('launch-rendered', () => calls.push('ran'), {
      timeoutMs: 5,
    });

    reportLoadStatus('launch-rendered');
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let frame = 0; frame < 4; frame += 1) flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual(['ran']);
  });

  test('the cleanup cancels a pending run', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    const calls: string[] = [];
    const cancel = afterLoadPhasePainted(
      'launch-rendered',
      () => calls.push('ran'),
      NO_TIMEOUT,
    );

    reportLoadStatus('launch-rendered');
    flushAnimationFrame();
    cancel();
    flushAnimationFrame();
    await flushTasks(2);
    expect(calls).toEqual([]);
  });

  test('a hidden document does not wait for frames it will never get', async () => {
    const { afterLoadPhasePainted, reportLoadStatus } = await load();
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      const calls: string[] = [];
      afterLoadPhasePainted(
        'launch-rendered',
        () => calls.push('ran'),
        NO_TIMEOUT,
      );
      reportLoadStatus('launch-rendered');
      await flushTasks(2);
      expect(calls).toEqual(['ran']);
    } finally {
      if (descriptor) {
        Object.defineProperty(document, 'visibilityState', descriptor);
      } else {
        delete (document as { visibilityState?: unknown }).visibilityState;
      }
    }
  });
});
