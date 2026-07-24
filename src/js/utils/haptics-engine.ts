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
  return typeof navigatorRef()?.vibrate === 'function';
}

function toVibrationPattern(input: HapticInput): number[] {
  if (typeof input === 'number') {
    return [input];
  }

  if (Array.isArray(input) && typeof input[0] === 'number') {
    return input as number[];
  }

  const steps = (input as HapticPatternStep[]) ?? [];
  return steps.flatMap((entry) =>
    entry.delay ? [entry.delay, entry.duration] : [entry.duration],
  );
}

export function createHapticsEngine(
  navigatorRef: () => Navigator | null,
): HapticEngine {
  const isSupported = supportsHaptics(navigatorRef);

  const trigger = (
    input: HapticInput = [
      {
        duration: 25,
        intensity: 0.7,
      },
    ],
  ) => {
    const nav = navigatorRef();
    if (!nav?.vibrate) {
      return Promise.resolve();
    }

    nav.vibrate(toVibrationPattern(input));
    return Promise.resolve();
  };

  return {
    isSupported,
    trigger,
    cancel: () => {
      navigatorRef()?.vibrate?.(0);
    },
  };
}
