import {
  MILKDROP_OVERLAY_TAB_EVENT,
  type MilkdropOverlayTab,
} from '../overlay-intent';
import { MILKDROP_PRESET_SELECTION_EVENT } from '../preset-selection';

export type MilkdropOverlayActionHandlers = {
  onSelectPreset: (id: string) => void;
  onSelectQualityPreset: (presetId: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onSetRating: (id: string, rating: number) => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onTransitionModeChange: (mode: 'blend' | 'cut') => void;
  onGoBackPreset: () => void;
  onNextPreset: () => void;
  onPreviousPreset: () => void;
  onRandomize: () => void;
  onBlendDurationChange: (value: number) => void;
  onImportFiles: (files: FileList) => void;
  onExport: () => void;
  onDuplicatePreset: () => void;
  onDeletePreset: () => void;
  onEditorSourceChange: (source: string) => void;
  onRevertToActive: () => void;
  onInspectorFieldChange: (key: string, value: string | number) => void;
};

export function createMilkdropOverlayCallbacks(
  actions: MilkdropOverlayActionHandlers,
) {
  return {
    onSelectPreset: (id: string) => {
      void actions.onSelectPreset(id);
    },
    onSelectQualityPreset: actions.onSelectQualityPreset,
    onToggleFavorite: (id: string, favorite: boolean) => {
      void actions.onToggleFavorite(id, favorite);
    },
    onSetRating: (id: string, rating: number) => {
      void actions.onSetRating(id, rating);
    },
    onToggleAutoplay: actions.onToggleAutoplay,
    onTransitionModeChange: actions.onTransitionModeChange,
    onGoBackPreset: () => {
      void actions.onGoBackPreset();
    },
    onNextPreset: () => {
      void actions.onNextPreset();
    },
    onPreviousPreset: () => {
      void actions.onPreviousPreset();
    },
    onRandomize: () => {
      void actions.onRandomize();
    },
    onBlendDurationChange: actions.onBlendDurationChange,
    onImportFiles: (files: FileList) => {
      void actions.onImportFiles(files);
    },
    onExport: actions.onExport,
    onDuplicatePreset: () => {
      void actions.onDuplicatePreset();
    },
    onDeletePreset: () => {
      void actions.onDeletePreset();
    },
    onEditorSourceChange: (source: string) => {
      void actions.onEditorSourceChange(source);
    },
    onRevertToActive: () => {
      void actions.onRevertToActive();
    },
    onInspectorFieldChange: (key: string, value: string | number) => {
      void actions.onInspectorFieldChange(key, value);
    },
  };
}

export function installMilkdropRuntimeKeybindings({
  overlay,
  getActivePresetId,
  getActiveCatalogEntry,
  getTransitionMode,
  getBlendDuration,
  selectAdjacentPreset,
  selectRandomPreset,
  goBackPreset,
  setTransitionMode,
  setOverlayStatus,
  cycleWaveMode,
  nudgeNumericField,
  toggleFavorite,
  setRating,
}: {
  overlay: { isOpen: () => boolean; toggleOpen: (open?: boolean) => void };
  getActivePresetId: () => string;
  getActiveCatalogEntry: () => unknown;
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

    if (event.key === 'm' || event.key === 'M') {
      overlay.toggleOpen();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && overlay.isOpen()) {
      overlay.toggleOpen(false);
      event.preventDefault();
      return;
    }
    if (event.key === 'n') {
      selectAdjacentPreset(1);
      event.preventDefault();
      return;
    }
    if (event.key === 'p') {
      selectAdjacentPreset(-1);
      event.preventDefault();
      return;
    }
    if (event.key === 'r') {
      selectRandomPreset();
      event.preventDefault();
      return;
    }
    if (event.key === 'b' || event.key === 'Backspace') {
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
      e: {
        key: 'wave_a',
        delta: -0.04,
        min: 0,
        max: 1,
        label: 'Wave alpha',
        digits: 3,
      },
      E: {
        key: 'wave_a',
        delta: 0.04,
        min: 0,
        max: 1,
        label: 'Wave alpha',
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

    const activePresetId = getActivePresetId();
    if (event.key === 'f' && activePresetId && getActiveCatalogEntry()) {
      toggleFavorite(activePresetId);
      event.preventDefault();
      return;
    }
    if (/^[1-5]$/u.test(event.key) && activePresetId) {
      setRating(activePresetId, Number.parseInt(event.key, 10));
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

export function installRequestedOverlayTabListener(
  onTab: (tab: MilkdropOverlayTab) => void,
) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const listener = (event: Event) => {
    const tab = (event as CustomEvent<{ tab?: MilkdropOverlayTab }>).detail
      ?.tab;
    if (!tab) {
      return;
    }
    onTab(tab);
  };
  window.addEventListener(MILKDROP_OVERLAY_TAB_EVENT, listener);
  return () => {
    window.removeEventListener(MILKDROP_OVERLAY_TAB_EVENT, listener);
  };
}
