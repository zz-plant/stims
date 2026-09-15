/**
 * The presets the digit keys 1–9 currently point at.
 *
 * Quick-select used to index the shell's filtered catalog — a list whose
 * order nothing on screen showed, so "3" played a preset the person had no
 * way to predict. The Browse panel now publishes the nine entries it is
 * actually showing first, in the order it shows them, and wears the digits
 * on those cards; the shortcut reads the same list. Empty while Browse is
 * closed, which the shortcut reports instead of guessing.
 */

export const QUICK_SELECT_LIMIT = 9;

let entries: readonly string[] = [];
const subscribers = new Set<() => void>();

export function publishQuickSelectEntries(presetIds: readonly string[]): void {
  const next = presetIds.slice(0, QUICK_SELECT_LIMIT);
  if (
    next.length === entries.length &&
    next.every((id, index) => id === entries[index])
  ) {
    return;
  }
  entries = next;
  for (const subscriber of subscribers) subscriber();
}

export function clearQuickSelectEntries(): void {
  publishQuickSelectEntries([]);
}

export function getQuickSelectEntries(): readonly string[] {
  return entries;
}

export function subscribeQuickSelect(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/** The digit shown on a card at `index`, or null past the ninth. */
export function quickSelectDigit(index: number): string | null {
  return index >= 0 && index < QUICK_SELECT_LIMIT ? String(index + 1) : null;
}
