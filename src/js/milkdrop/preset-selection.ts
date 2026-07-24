const REQUESTED_PRESET_KEY = 'stims:milkdrop:requested-preset';
export const MILKDROP_PRESET_SELECTION_EVENT = 'stims:milkdrop:select-preset';

type PresetSelectionEventDetail = {
  presetId: string;
};

export function requestMilkdropPresetSelection(presetId: string) {
  const normalizedPresetId = presetId.trim();
  if (!normalizedPresetId) {
    return;
  }

  try {
    window.sessionStorage.setItem(REQUESTED_PRESET_KEY, normalizedPresetId);
  } catch {
    // Ignore storage failures and rely on the live event when possible.
  }

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PresetSelectionEventDetail>(
      MILKDROP_PRESET_SELECTION_EVENT,
      {
        detail: {
          presetId: normalizedPresetId,
        },
      },
    ),
  );
}

export function consumeRequestedMilkdropPresetSelection() {
  try {
    const presetId = window.sessionStorage
      .getItem(REQUESTED_PRESET_KEY)
      ?.trim();
    if (!presetId) {
      return null;
    }
    window.sessionStorage.removeItem(REQUESTED_PRESET_KEY);
    return presetId;
  } catch {
    return null;
  }
}
