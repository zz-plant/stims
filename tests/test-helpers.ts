import { test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

/**
 * Imports a module with a cache-busting query so each call gets a fresh
 * instance.
 *
 * The specifier is resolved from the repo root rather than from the caller,
 * because a bare `import()` here would resolve relative to *this* file — which
 * silently couples every call site to how deep it sits under `tests/`. Leading
 * `../` segments are stripped so both `src/js/x.ts` and `../../src/js/x.ts`
 * land on the same module regardless of which category folder the test lives in.
 */
export async function importFresh<T>(path: string): Promise<T> {
  const rootRelative = path.replace(/^(?:\.\.\/)+/, '');
  const absolute = resolve(process.cwd(), rootRelative);
  return import(`${absolute}?t=${Date.now()}-${Math.random()}`) as Promise<T>;
}

export async function flushTasks(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function replaceProperty<
  T extends object,
  K extends keyof T | string | symbol,
>(target: T, key: K, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key as keyof T);

  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });

  return () => {
    if (original) {
      Object.defineProperty(target, key, original);
      return;
    }

    Reflect.deleteProperty(target, key);
  };
}

/**
 * `test` when Playwright's Chromium is on disk, `test.skip` when it is not.
 *
 * Two tests in `tests/corpus/` drive a real browser, and corpus runs in
 * `bun run check`. Playwright's browsers are a separate download that
 * `bun install` does not perform, so without this a fresh clone fails the
 * gate on a missing binary rather than a real defect. `bun run setup:browsers`
 * installs them and the tests then run.
 *
 * Deliberately not keyed off `process.env.CI`. The Parity corpus job installs
 * Chromium and the Quality gate job does not, so "in CI" says nothing about
 * whether a browser exists — assuming it did is what turned this gate red.
 * Availability is the only honest signal, and a broken install cannot hide
 * behind it: `setup-playwright` failing fails that job before any test runs.
 */
export const browserTest = (() => {
  try {
    return existsSync(chromium.executablePath()) ? test : test.skip;
  } catch {
    return test.skip;
  }
})();
