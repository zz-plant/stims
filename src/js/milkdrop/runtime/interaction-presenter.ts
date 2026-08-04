import {
  createMilkdropOverlayCallbacks,
  installMilkdropRuntimeKeybindings,
  type MilkdropOverlayActionHandlers,
} from './ui-bridge';

export type { MilkdropScenePickResult } from './ui-bridge';

export function createMilkdropRuntimeInteractionPresenter({
  overlay,
  overlayActions,
  keybindingActions,
  sceneInteractionActions,
}: {
  overlay: {
    isOpen: () => boolean;
    toggleOpen: (open?: boolean) => void;
    toggleShortcutHud: (open?: boolean) => void;
  };
  overlayActions: MilkdropOverlayActionHandlers;
  keybindingActions: {
    getTransitionMode: () => 'blend' | 'cut';
    getBlendDuration: () => number;
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
    togglePresetLock?: () => void;
    isPresetLocked?: () => boolean;
  };
  sceneInteractionActions?: {
    isSceneInteractionEnabled: () => boolean;
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
    isSceneInteractionEnabled() {
      return Boolean(sceneInteractionActions?.isSceneInteractionEnabled?.());
    },
  };
}
