export function canUseHaptics(enabled = true) {
  return (
    enabled &&
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function'
  );
}

export function pulseHaptic(pattern: number | number[] = 12, enabled = true) {
  if (!canUseHaptics(enabled)) return;
  navigator.vibrate(pattern);
}
