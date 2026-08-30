import { clearMilkdropWebGpuQueryOverride } from '../milkdrop/webgpu-query-override.ts';
import { resetRendererRetryPolicy } from './renderer-retry-policy.ts';
import {
  getBrowserSessionStorage,
  getBrowserStorage,
} from './state/browser-storage.ts';
import { resetQualityPresetState } from './state/quality-preset-store.ts';
import {
  resetRenderPreferenceStore,
  setCompatibilityMode,
} from './state/render-preference-store.ts';

export function resetAllOverrides(): { clearedKeys: string[] } {
  const clearedKeys: string[] = [];

  setCompatibilityMode(false);
  resetRenderPreferenceStore();
  resetRendererRetryPolicy();
  clearMilkdropWebGpuQueryOverride();
  resetQualityPresetState();

  const localStorage = getBrowserStorage();
  if (localStorage) {
    const keysToRemove = new Set<string>();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('stims:')) {
          keysToRemove.add(key);
        }
      }
    } catch {
      // ignore index access error
    }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('stims:')) {
        keysToRemove.add(key);
      }
    }
    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      clearedKeys.push(key);
    });
  }

  const sessionStorage = getBrowserSessionStorage();
  if (sessionStorage) {
    const keysToRemove = new Set<string>();
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith('stims:')) {
          keysToRemove.add(key);
        }
      }
    } catch {
      // ignore index access error
    }
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('stims:')) {
        keysToRemove.add(key);
      }
    }
    keysToRemove.forEach((key) => {
      sessionStorage.removeItem(key);
      clearedKeys.push(key);
    });
  }

  return { clearedKeys };
}
