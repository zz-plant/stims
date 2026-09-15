import { MILKDROP_PRESET_SELECTION_EVENT } from '../preset-selection';

export {
  describeMilkdropScenePickResult,
  getMilkdropSceneDragFieldUpdates,
  getMilkdropScenePickResult,
  getMilkdropSceneSelectionFieldMap,
  isMilkdropSceneSelectionEditable,
  type MilkdropSceneDragModifiers,
  type MilkdropScenePickDescription,
  type MilkdropScenePickKind,
  type MilkdropScenePickResult,
  type MilkdropScenePointerPoint,
  resolveMilkdropScenePointerPoint,
} from './scene-selection';

export function installRequestedPresetListener(
  onPreset: (presetId: string) => void,
) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const listener = (event: Event) => {
    const presetId = (
      event as CustomEvent<{ presetId?: string }>
    ).detail?.presetId?.trim();
    if (!presetId) {
      return;
    }
    onPreset(presetId);
  };
  window.addEventListener(MILKDROP_PRESET_SELECTION_EVENT, listener);
  return () => {
    window.removeEventListener(MILKDROP_PRESET_SELECTION_EVENT, listener);
  };
}
