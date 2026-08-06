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

export function installMilkdropRuntimeKeybindings({
  overlay,
  getTransitionMode,
  getBlendDuration,
  selectRandomPreset,
  goBackPreset,
  setTransitionMode,
  setOverlayStatus,
  cycleWaveMode,
  nudgeNumericField,
  togglePresetLock,
  isPresetLocked,
}: {
  overlay: {
    isOpen: () => boolean;
    toggleOpen: (open?: boolean) => void;
    toggleShortcutHud: (open?: boolean) => void;
  };
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
}) {
  const keyboardHandler = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLElement &&
      (target.closest('.cm-editor') ||
        /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
    ) {
      return;
    }

    if (event.key === 'Escape' && overlay.isOpen()) {
      overlay.toggleOpen(false);
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      overlay.toggleShortcutHud(false);
    }
    // n, p, f, b, e, m, ?, 1-5 are handled by the React shell's keyboard
    // shortcuts (useKeyboardShortcuts). Skip them here to avoid dual-fire
    // races where both handlers trigger conflicting preset switches.
    if (event.key === 'r') {
      selectRandomPreset();
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      goBackPreset();
      event.preventDefault();
      return;
    }
    if (event.key === 'h' || event.key === 'H') {
      const nextMode = getTransitionMode() === 'blend' ? 'cut' : 'blend';
      setTransitionMode(nextMode);
      setOverlayStatus(
        nextMode === 'cut'
          ? 'Transition mode: hard cut.'
          : `Transition mode: blend (${getBlendDuration().toFixed(2)}s).`,
      );
      event.preventDefault();
      return;
    }
    if (event.key === 'w' || event.key === 'W') {
      cycleWaveMode(event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }

    const nudges = {
      i: {
        key: 'zoom',
        delta: 0.02,
        min: 0.5,
        max: 2.5,
        label: 'Zoom',
        digits: 3,
      },
      I: {
        key: 'zoom',
        delta: -0.02,
        min: 0.5,
        max: 2.5,
        label: 'Zoom',
        digits: 3,
      },
      o: {
        key: 'warp',
        delta: -0.01,
        min: 0,
        max: 1,
        label: 'Warp',
        digits: 3,
      },
      O: { key: 'warp', delta: 0.01, min: 0, max: 1, label: 'Warp', digits: 3 },
      j: {
        key: 'wave_scale',
        delta: -0.03,
        min: 0.25,
        max: 3,
        label: 'Wave scale',
        digits: 3,
      },
      J: {
        key: 'wave_scale',
        delta: 0.03,
        min: 0.25,
        max: 3,
        label: 'Wave scale',
        digits: 3,
      },
      q: {
        key: 'video_echo_zoom',
        delta: -0.01,
        min: 0.85,
        max: 1.3,
        label: 'Video echo zoom',
        digits: 3,
      },
      Q: {
        key: 'video_echo_zoom',
        delta: 0.01,
        min: 0.85,
        max: 1.3,
        label: 'Video echo zoom',
        digits: 3,
      },
      '<': {
        key: 'rot',
        delta: -0.003,
        min: -1,
        max: 1,
        label: 'Rotation',
        digits: 4,
      },
      '>': {
        key: 'rot',
        delta: 0.003,
        min: -1,
        max: 1,
        label: 'Rotation',
        digits: 4,
      },
    } as const;
    const nudge = nudges[event.key as keyof typeof nudges];
    if (nudge) {
      nudgeNumericField(nudge);
      event.preventDefault();
      return;
    }

    if (
      (event.key === 'l' || event.key === 'L') &&
      togglePresetLock &&
      isPresetLocked
    ) {
      togglePresetLock();
      setOverlayStatus(
        isPresetLocked() ? 'Preset locked.' : 'Preset unlocked.',
      );
      event.preventDefault();
      return;
    }
  };

  document.addEventListener('keydown', keyboardHandler);
  return () => {
    document.removeEventListener('keydown', keyboardHandler);
  };
}

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
