import { resolve } from 'node:path';

/**
 * Imports a module with a cache-busting query so each call gets a fresh
 * instance.
 *
 * The specifier is resolved from the repo root rather than from the caller,
 * because a bare `import()` here would resolve relative to *this* file — which
 * silently couples every call site to how deep it sits under `tests/`. Leading
 * `../` segments are stripped so both `assets/js/x.ts` and `../../assets/js/x.ts`
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
