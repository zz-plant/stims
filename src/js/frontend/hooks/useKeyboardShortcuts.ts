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
  handleVisualSearch,
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
  handleVisualSearch: () => Promise<void>;
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
  const handleVisualSearchRef = useRef(handleVisualSearch);
  handleVisualSearchRef.current = handleVisualSearch;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcutOverrides = readShortcutOverrides();
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
      } else if (eventMatchesShortcut(event, 'refine', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'refine' ? null : 'refine');
      } else if (
        eventMatchesShortcut(event, 'visualsearch', shortcutOverrides)
      ) {
        event.preventDefault();
        void handleVisualSearchRef.current();
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

    document.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
    };
  }, [liveMode, engineReady, panel, setShowShortcuts]);
}
