import { isMobileDevice } from '../utils/browser/device-detect.ts';

export const DEFAULT_WEBGPU_INIT_TIMEOUT_MS = 3000;

/** Mobile GPU process cold starts routinely exceed the desktop budget. */
export const MOBILE_WEBGPU_INIT_TIMEOUT_MS = 8000;

/**
 * The device budget for adapter/device initialization. A first WebGPU device
 * request on Android (GPU process spin-up, driver shader-cache misses) can
 * take well past 3s; timing out there falls the whole session back to WebGL,
 * so on phones a slower first boot is the better trade.
 */
export function getDefaultWebGpuInitTimeoutMs(): number {
  return isMobileDevice()
    ? MOBILE_WEBGPU_INIT_TIMEOUT_MS
    : DEFAULT_WEBGPU_INIT_TIMEOUT_MS;
}

export async function resolveWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  abortController?: AbortController,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      abortController?.abort();
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
