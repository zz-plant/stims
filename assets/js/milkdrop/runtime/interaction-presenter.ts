import type { MilkdropCatalogEntry } from '../types';
import {
  createMilkdropOverlayCallbacks,
  installMilkdropRuntimeKeybindings,
  type MilkdropOverlayActionHandlers,
} from './ui-bridge';

export function createMilkdropRuntimeInteractionPresenter({
  overlay,
  overlayActions,
  keybindingActions,
}: {
  overlay: { isOpen: () => boolean; toggleOpen: (open?: boolean) => void };
  overlayActions: MilkdropOverlayActionHandlers;
  keybindingActions: {
    getActivePresetId: () => string;
    getActiveCatalogEntry: () => MilkdropCatalogEntry | null;
    getTransitionMode: () => 'blend' | 'cut';
    getBlendDuration: () => number;
    selectAdjacentPreset: (direction: 1 | -1) => void;
    selectRandomPreset: () => void;
    goBackPreset: () => void;
    setTransitionMode: (mode: 'blend' | 'cut') => void;
    setOverlayStatus: (message: string) => void;
    cycleWaveMode: (direction: 1 | -1) => void;
    nudgeNumericField: (args: {
      key: string;
      delta: number;
      min: number;
      max: number;
      label: string;
      digits?: number;
    }) => void;
    toggleFavorite: (id: string) => void;
    setRating: (id: string, rating: number) => void;
  };
}) {
  return {
    overlayCallbacks: createMilkdropOverlayCallbacks(overlayActions),
    installKeyboardShortcuts() {
      return installMilkdropRuntimeKeybindings({
        overlay,
        ...keybindingActions,
      });
    },
  };
}
