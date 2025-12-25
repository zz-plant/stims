import { describe, expect, test } from 'bun:test';
import { createSharedInitializer } from '../assets/js/utils/shared-initializer.ts';

describe('createSharedInitializer', () => {
  test('runs initializer once and shares the promise', async () => {
    let callCount = 0;
    const initializer = createSharedInitializer(async () => {
      callCount += 1;
      return 'ready';
    });

    const [first, second] = await Promise.all([initializer.run(), initializer.run()]);

    expect(first).toBe('ready');
    expect(second).toBe('ready');
    expect(callCount).toBe(1);
  });

  test('resets the initializer so it can run again', async () => {
    let value = 0;
    const initializer = createSharedInitializer(() => {
      value += 1;
      return value;
    });

    expect(await initializer.run()).toBe(1);
    initializer.reset();
    expect(await initializer.run()).toBe(2);
  });

  test('allows retry after an error', async () => {
    let attempt = 0;
    const initializer = createSharedInitializer(() => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('boom');
      }
      return 'ok';
    });

    await expect(initializer.run()).rejects.toThrow('boom');
    expect(await initializer.run()).toBe('ok');
  });
});
