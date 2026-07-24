import Stats from 'stats-gl';

const STATS_STORAGE_KEY = 'stims:debug:stats-gl';

export function shouldEnableStatsOverlay({
  search = typeof window !== 'undefined' ? window.location.search : '',
  storageValue,
}: {
  search?: string;
  storageValue?: string | null;
} = {}) {
  const params = new URLSearchParams(search);
  if (params.get('stats') === '1') {
    return true;
  }
  if (params.get('stats') === '0') {
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
    try {
      const storageValue =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(storageKey)
          : null;
      enabled = shouldEnableStatsOverlay({
        storageValue,
      });
    } catch {
      enabled = shouldEnableStatsOverlay();
    }
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

      const nextStats = new Stats({
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
      initPromise = nextStats
        .init(renderer as never)
        .then(() => {
          initialized = true;
        })
        .catch(() => {
          nextStats.dom.remove();
          nextStats.dispose();
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
