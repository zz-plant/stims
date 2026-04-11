import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';

export async function waitForRuntime(
  getRuntime: () => ToyRuntimeInstance | null,
  { attempts = 80, delayMs = 50 }: { attempts?: number; delayMs?: number } = {},
) {
  let currentRuntime = getRuntime();
  if (currentRuntime) {
    return currentRuntime;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    currentRuntime = getRuntime();
    if (currentRuntime) {
      return currentRuntime;
    }
  }

  return null;
}
