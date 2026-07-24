import { useEffect, useRef } from 'react';
import type { PanelState, PresetCatalogEntry } from '../contracts';
import {
  eventMatchesShortcut,
  readShortcutOverrides,
} from '../shortcut-registry.ts';

export function useKeyboardShortcuts({
  liveMode,
  engineReady,
  panel,
  filteredCatalog,
  updatePanel,
  handlePresetSelection,
  handleShufflePreset,
  handlePreviousPreset,
  handleAudioStop,
  handleToggleFullscreen,
  setShowShortcuts,
}: {
  liveMode: boolean;
  engineReady: boolean;
  panel: string | null;
  filteredCatalog: PresetCatalogEntry[];
  updatePanel: (panel: PanelState) => void;
  handlePresetSelection: (presetId: string) => void;
  handleShufflePreset: () => void;
  handlePreviousPreset: () => void;
  handleAudioStop: () => void;
  handleToggleFullscreen: () => void;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const filteredCatalogRef = useRef(filteredCatalog);
  filteredCatalogRef.current = filteredCatalog;
  const updatePanelRef = useRef(updatePanel);
  updatePanelRef.current = updatePanel;
  const handlePresetSelectionRef = useRef(handlePresetSelection);
  handlePresetSelectionRef.current = handlePresetSelection;
  const handleShufflePresetRef = useRef(handleShufflePreset);
  handleShufflePresetRef.current = handleShufflePreset;
  const handlePreviousPresetRef = useRef(handlePreviousPreset);
  handlePreviousPresetRef.current = handlePreviousPreset;
  const handleAudioStopRef = useRef(handleAudioStop);
  handleAudioStopRef.current = handleAudioStop;
  const handleToggleFullscreenRef = useRef(handleToggleFullscreen);
  handleToggleFullscreenRef.current = handleToggleFullscreen;

  useEffect(() => {
    const shortcutOverrides = readShortcutOverrides();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement &&
          event.target.isContentEditable) ||
        (event.target instanceof HTMLElement &&
          event.target.closest('.cm-editor'))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (eventMatchesShortcut(event, 'audio', shortcutOverrides)) {
        event.preventDefault();
        if (liveMode) {
          handleAudioStopRef.current();
        } else if (engineReady) {
          updatePanelRef.current('settings');
        }
      } else if (eventMatchesShortcut(event, 'fullscreen', shortcutOverrides)) {
        event.preventDefault();
        handleToggleFullscreenRef.current();
      } else if (eventMatchesShortcut(event, 'browse', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'browse' ? null : 'browse');
      } else if (eventMatchesShortcut(event, 'settings', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'settings' ? null : 'settings');
      } else if (eventMatchesShortcut(event, 'editor', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'editor' ? null : 'editor');
      } else if (eventMatchesShortcut(event, 'shuffle', shortcutOverrides)) {
        event.preventDefault();
        void handleShufflePresetRef.current();
      } else if (eventMatchesShortcut(event, 'previous', shortcutOverrides)) {
        event.preventDefault();
        void handlePreviousPresetRef.current();
      } else if (/^[1-9]$/.test(key) && liveMode) {
        event.preventDefault();
        const index = Number.parseInt(key, 10) - 1;
        const preset = filteredCatalogRef.current[index];
        if (preset) {
          handlePresetSelectionRef.current(preset.id);
        }
      } else if (eventMatchesShortcut(event, 'help', shortcutOverrides)) {
        event.preventDefault();
        setShowShortcuts((s) => !s);
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (!touchStartX || !touchStartY) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      touchStartX = 0;
      touchStartY = 0;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) {
        void handlePreviousPresetRef.current();
      } else {
        void handleShufflePresetRef.current();
      }
    };

    document.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );
    document.addEventListener('touchstart', handleTouchStart, {
      passive: true,
    });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [liveMode, engineReady, panel, setShowShortcuts]);
}
