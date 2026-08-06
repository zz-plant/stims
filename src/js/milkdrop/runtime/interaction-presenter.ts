import { installMilkdropRuntimeKeybindings } from './ui-bridge';

export type { MilkdropScenePickResult } from './ui-bridge';

export function createMilkdropRuntimeInteractionPresenter({
  overlay,
  keybindingActions,
  sceneInteractionActions,
}: {
  overlay: {
    isOpen: () => boolean;
    toggleOpen: (open?: boolean) => void;
    toggleShortcutHud: (open?: boolean) => void;
  };
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
