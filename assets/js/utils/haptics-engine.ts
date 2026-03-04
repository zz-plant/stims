import { WebHaptics } from 'web-haptics';

export type HapticPatternStep = {
  delay?: number;
  duration: number;
  intensity?: number;
};

export type HapticInput = number | number[] | HapticPatternStep[];

export type HapticEngine = {
  isSupported: boolean;
  trigger: (input?: HapticInput) => Promise<void>;
  cancel: () => void;
};

export function supportsHaptics(navigatorRef: () => Navigator | null) {
  return (
    WebHaptics.isSupported || typeof navigatorRef()?.vibrate === 'function'
  );
}

export function createHapticsEngine(
  navigatorRef: () => Navigator | null,
): HapticEngine {
  const webHaptics = new WebHaptics();

  const trigger = (
    input: HapticInput = [
      {
        duration: 25,
        intensity: 0.7,
      },
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
    trigger,
    cancel: () => {
      webHaptics.cancel();
      navigatorRef()?.vibrate?.(0);
    },
  };
}
