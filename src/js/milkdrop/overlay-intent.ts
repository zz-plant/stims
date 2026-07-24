const REQUESTED_OVERLAY_TAB_KEY = 'stims:milkdrop:requested-overlay-tab';
export const MILKDROP_OVERLAY_TAB_EVENT = 'stims:milkdrop:open-overlay-tab';

export type MilkdropOverlayTab = 'browse' | 'editor' | 'inspector';

type OverlayIntentDetail = {
  tab: MilkdropOverlayTab;
};

const VALID_TABS = new Set<MilkdropOverlayTab>([
  'browse',
  'editor',
  'inspector',
]);

function normalizeTab(
  tab: string | null | undefined,
): MilkdropOverlayTab | null {
  const normalized = tab?.trim().toLowerCase();
  if (!normalized || !VALID_TABS.has(normalized as MilkdropOverlayTab)) {
    return null;
  }
  return normalized as MilkdropOverlayTab;
}

export function requestMilkdropOverlayTab(tab: string) {
  const normalizedTab = normalizeTab(tab);
  if (!normalizedTab) {
    return;
  }

  try {
    window.sessionStorage.setItem(REQUESTED_OVERLAY_TAB_KEY, normalizedTab);
  } catch {
    // Ignore storage failures and rely on the live event when possible.
  }

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OverlayIntentDetail>(MILKDROP_OVERLAY_TAB_EVENT, {
      detail: { tab: normalizedTab },
    }),
  );
}

export function consumeRequestedMilkdropOverlayTab() {
  try {
    const tab = normalizeTab(
      window.sessionStorage.getItem(REQUESTED_OVERLAY_TAB_KEY),
    );
    if (!tab) {
      return null;
    }
    window.sessionStorage.removeItem(REQUESTED_OVERLAY_TAB_KEY);
    return tab;
  } catch {
    return null;
  }
}
