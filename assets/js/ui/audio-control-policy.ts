const DEFAULT_TOUCH_GESTURE_HINTS = [
  'Drag to bend the scene.',
  'Pinch to swell or compress the depth.',
  'Rotate with two fingers to twist the image.',
];

export function normalizeHints(hints: string[] | undefined, limit = 3) {
  return (hints ?? [])
    .map((hint) => hint.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function supportsTouchLikeInput() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (typeof window.matchMedia === 'function') {
    if (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches
    ) {
      return true;
    }
  }

  return navigator.maxTouchPoints > 0;
}

export function resolveTouchGestureHints(options: {
  touchHints?: string[];
  gestureHints?: string[];
}) {
  const explicitHints = normalizeHints(
    options.touchHints ?? options.gestureHints,
  );
  if (explicitHints.length > 0) {
    return explicitHints;
  }

  return DEFAULT_TOUCH_GESTURE_HINTS;
}
