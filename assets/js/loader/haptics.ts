import { WebHaptics } from 'web-haptics';

export const HAPTICS_STORAGE_KEY = 'stims:haptics-enabled';

type HapticPatternStep = {
  delay?: number;
  duration: number;
  intensity?: number;
};

type HapticEngine = {
  isSupported: boolean;
  trigger: (input?: number | number[] | HapticPatternStep[]) => Promise<void>;
  cancel: () => void;
};

function createDefaultHapticEngine(
  navigatorRef: () => Navigator | null,
): HapticEngine {
  const webHaptics = new WebHaptics();

  const triggerWithNavigatorFallback = (
    input: number | number[] | HapticPatternStep[] = [
      { duration: 25, intensity: 0.7 },
    ],
  ) => {
    if (WebHaptics.isSupported) {
      return webHaptics.trigger(input);
    }

    const nav = navigatorRef();
    if (!nav?.vibrate) {
      return Promise.resolve();
    }

    if (typeof input === 'number') {
      nav.vibrate(input);
      return Promise.resolve();
    }

    if (Array.isArray(input) && typeof input[0] === 'number') {
      nav.vibrate(input as number[]);
      return Promise.resolve();
    }

    const steps = (input as HapticPatternStep[]) ?? [];
    const pattern = steps.flatMap((entry) =>
      entry.delay ? [entry.delay, entry.duration] : [entry.duration],
    );
    nav.vibrate(pattern);
    return Promise.resolve();
  };

  return {
    isSupported: WebHaptics.isSupported,
    trigger: triggerWithNavigatorFallback,
    cancel: () => {
      webHaptics.cancel();
      const nav = navigatorRef();
      nav?.vibrate?.(0);
    },
  };
}

export function canUseHaptics() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const supportsVibration =
    WebHaptics.isSupported || typeof navigator.vibrate === 'function';
  return (
    supportsVibration && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  );
}

export function createHapticsController({
  view,
  isPartyModeActive,
  windowRef = () => (typeof window !== 'undefined' ? window : null),
  navigatorRef = () => (typeof navigator !== 'undefined' ? navigator : null),
  documentRef = () => (typeof document !== 'undefined' ? document : null),
  hapticEngine = createDefaultHapticEngine(navigatorRef),
}: {
  view?: { setHapticsState?: (active: boolean) => void };
  isPartyModeActive: () => boolean;
  windowRef?: () => Window | null;
  navigatorRef?: () => Navigator | null;
  documentRef?: () => Document | null;
  hapticEngine?: HapticEngine;
}) {
  let hapticsEnabled = false;
  let beatCleanup: (() => void) | null = null;

  const canUseLocalHaptics = () => {
    const win = windowRef();
    const nav = navigatorRef();
    if (!win || !nav) return false;
    const supportsVibration =
      hapticEngine.isSupported || typeof nav.vibrate === 'function';
    return supportsVibration && /Mobi|Android|iPhone|iPad/i.test(nav.userAgent);
  };

  const clearBeatHapticsListener = () => {
    beatCleanup?.();
    beatCleanup = null;
  };

  const pulseHaptics = (intensity = 0.4) => {
    if (!hapticsEnabled || !canUseLocalHaptics()) return;
    const doc = documentRef();
    if (doc && doc.body.dataset.audioActive !== 'true') return;

    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const duration = Math.round(10 + clampedIntensity * 18);
    void hapticEngine.trigger(
      isPartyModeActive() ? [duration, 28, duration] : [duration],
    );
  };

  const syncBeatHapticsListener = () => {
    clearBeatHapticsListener();
    const win = windowRef();
    if (!hapticsEnabled || !canUseLocalHaptics() || !win) return;

    const onBeat = (event: Event) => {
      const detail = (event as CustomEvent<{ intensity?: number }>).detail;
      pulseHaptics(detail?.intensity ?? 0.4);
    };

    win.addEventListener('stims:audio-beat', onBeat as EventListener);
    beatCleanup = () => {
      win.removeEventListener('stims:audio-beat', onBeat as EventListener);
    };
  };

  const persistHaptics = (enabled: boolean) => {
    const win = windowRef();
    if (!win) return;
    try {
      win.localStorage.setItem(HAPTICS_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (_error) {
      // Ignore storage access issues.
    }
  };

  const readPersistedHaptics = () => {
    const win = windowRef();
    if (!win) return false;
    try {
      return win.localStorage.getItem(HAPTICS_STORAGE_KEY) === 'true';
    } catch (_error) {
      return false;
    }
  };

  const setHapticsEnabled = (enabled: boolean) => {
    const nextEnabled = enabled && canUseLocalHaptics();
    hapticsEnabled = nextEnabled;
    view?.setHapticsState?.(nextEnabled);
    persistHaptics(nextEnabled);
    if (!nextEnabled) {
      hapticEngine.cancel();
    }
    syncBeatHapticsListener();
  };

  return {
    clearBeatHapticsListener,
    pulseHaptics,
    syncBeatHapticsListener,
    readPersistedHaptics,
    setHapticsEnabled,
    getHapticsEnabled: () => hapticsEnabled,
    setFromPersisted: () => {
      hapticsEnabled = readPersistedHaptics();
      return hapticsEnabled;
    },
  };
}
