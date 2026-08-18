import type Stats from 'stats-gl';
import { getBrowserStorage } from './state/browser-storage.ts';
import { parseURLParams } from './url-params.ts';

const STATS_STORAGE_KEY = 'stims:debug:stats-gl';

export function shouldEnableStatsOverlay({
  search = typeof window !== 'undefined' ? window.location.search : '',
  storageValue,
}: {
  search?: string;
  storageValue?: string | null;
} = {}) {
  const stats = parseURLParams(search).stats;
  if (stats === '1') {
    return true;
  }
  if (stats === '0') {
    return false;
  }
  return storageValue === '1';
}

export function createStatsOverlay({
  storageKey = STATS_STORAGE_KEY,
}: {
  storageKey?: string;
} = {}) {
  let stats: Stats | null = null;
  let enabled = false;
  let initialized = false;
  let initPromise: Promise<void> | null = null;

  const resolveEnabled = () => {
    const storageValue = getBrowserStorage()?.getItem(storageKey) ?? null;
    enabled = shouldEnableStatsOverlay({
      storageValue,
    });
    return enabled;
  };

  return {
    isEnabled() {
      return resolveEnabled();
    },

    async init(renderer: unknown) {
      if (!resolveEnabled() || initialized || initPromise) {
        return initPromise ?? Promise.resolve();
      }

      if (typeof document === 'undefined' || !document.body) {
        return;
      }

      // stats-gl only loads when the overlay is actually enabled, so the
      // library stays out of the runtime chunk for regular sessions.
      initPromise = import('stats-gl')
        .then(({ default: StatsGl }) => {
          const nextStats = new StatsGl({
            trackGPU: true,
            trackCPT: false,
            trackHz: false,
            minimal: false,
            horizontal: false,
          });

          nextStats.dom.style.position = 'fixed';
          nextStats.dom.style.right = '12px';
          nextStats.dom.style.bottom = '12px';
          nextStats.dom.style.zIndex = '3000';
          nextStats.dom.dataset.stimsStatsGl = 'true';
          document.body.appendChild(nextStats.dom);

          stats = nextStats;
          return nextStats
            .init(renderer as never)
            .then(() => {
              initialized = true;
            })
            .catch(() => {
              nextStats.dom.remove();
              nextStats.dispose();
              stats = null;
            });
        })
        .catch(() => {
          stats = null;
        })
        .finally(() => {
          initPromise = null;
        });

      return initPromise;
    },

    update() {
      if (!enabled || !initialized || !stats) {
        return;
      }
      stats.update();
    },

    dispose() {
      stats?.dom.remove();
      stats?.dispose();
      stats = null;
      enabled = false;
      initialized = false;
      initPromise = null;
    },
  };
}
