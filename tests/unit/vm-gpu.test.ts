import { describe, expect, test } from 'bun:test';
import {
  clearGpuVmCaches,
  createGpuVmRunner,
} from '../../src/js/milkdrop/vm-gpu.ts';

describe('vm-gpu', () => {
  test('creates runner instance with expected lifecycle methods', () => {
    const runner = createGpuVmRunner();
    expect(typeof runner.init).toBe('function');
    expect(typeof runner.dispatch).toBe('function');
    expect(typeof runner.dispose).toBe('function');
    expect(runner.isInitialized()).toBe(false);
  });

  test('clears GPU VM caches without error', () => {
    expect(() => clearGpuVmCaches()).not.toThrow();
  });
});
