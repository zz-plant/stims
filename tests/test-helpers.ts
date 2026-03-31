export async function importFresh<T>(path: string): Promise<T> {
  return import(`${path}?t=${Date.now()}-${Math.random()}`) as Promise<T>;
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
