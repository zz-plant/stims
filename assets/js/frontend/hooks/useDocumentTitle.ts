import { useEffect } from 'react';

export function useDocumentTitle({
  loadingPreset,
  selectedPresetTitle,
  panel,
  liveMode,
  engineReady,
}: {
  loadingPreset: boolean;
  selectedPresetTitle: string | null;
  panel: string | null;
  liveMode: boolean;
  engineReady: boolean;
}) {
  useEffect(() => {
    let title = 'Stims';
    console.log('useDocumentTitle state:', {
      loadingPreset,
      selectedPresetTitle,
      panel,
      liveMode,
      engineReady,
    });
    if (loadingPreset) {
      title = `Loading\u2026 \u00B7 ${title}`;
    } else if (selectedPresetTitle && liveMode) {
      title = `${selectedPresetTitle} \u00B7 ${title}`;
    } else if (panel) {
      const panelLabel =
        panel === 'browse'
          ? 'Browse'
          : panel === 'settings'
            ? 'Settings'
            : panel === 'editor'
              ? 'Editor'
              : 'Inspector';
      title = `${panelLabel} \u00B7 ${title}`;
    } else if (liveMode) {
      title = `Now Playing \u00B7 ${title}`;
    } else if (!engineReady) {
      title = `Loading\u2026 \u00B7 ${title}`;
    }
    console.log('Setting document.title to:', title);
    document.title = title;
  }, [loadingPreset, selectedPresetTitle, panel, liveMode, engineReady]);
}
