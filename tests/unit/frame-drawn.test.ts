import { describe, expect, test } from 'bun:test';
import {
  notifyFrameDrawn,
  readAfterNextFrameDrawn,
  subscribeToFrameDrawn,
} from '../../src/js/core/frame-drawn.ts';

describe('frame-drawn notifications', () => {
  test('every subscriber hears each drawn frame until it unsubscribes', () => {
    const heard: number[] = [];
    const stop = subscribeToFrameDrawn((now) => heard.push(now));
    notifyFrameDrawn(16);
    notifyFrameDrawn(32);
    stop();
    notifyFrameDrawn(48);
    expect(heard).toEqual([16, 32]);
  });

  test('one failing observer does not stop the others', () => {
    const heard: string[] = [];
    const stopBad = subscribeToFrameDrawn(() => {
      throw new Error('boom');
    });
    const stopGood = subscribeToFrameDrawn(() => heard.push('good'));
    const warn = console.warn;
    console.warn = () => {};
    try {
      notifyFrameDrawn(0);
    } finally {
      console.warn = warn;
      stopBad();
      stopGood();
    }
    expect(heard).toEqual(['good']);
  });

  test('a read runs inside the next drawn frame, synchronously', async () => {
    let inside = false;
    const pending = readAfterNextFrameDrawn(() => inside, 1000);
    inside = true;
    notifyFrameDrawn(0);
    inside = false;
    expect(await pending).toBe(true);
  });

  test('with no frame drawn the read gives up and resolves null', async () => {
    expect(await readAfterNextFrameDrawn(() => 'read', 0)).toBeNull();
  });
});
