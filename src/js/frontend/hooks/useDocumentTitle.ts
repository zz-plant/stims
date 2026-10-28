import { useEffect } from 'react';
import type { PanelState } from '../contracts.ts';
import { getPanelTitle } from '../panel-registry.ts';

export function useDocumentTitle({
  loadingPreset,
  selectedPresetTitle,
  panel,
  liveMode,
  engineReady,
}: {
  loadingPreset: boolean;
  selectedPresetTitle: string | null;
  panel: PanelState;
  liveMode: boolean;
  engineReady: boolean;
}) {
  useEffect(() => {
    let title = 'Stims';
    if (loadingPreset) {
      title = `Loading\u2026 \u00B7 ${title}`;
    } else if (selectedPresetTitle && liveMode) {
      title = `${selectedPresetTitle} \u00B7 ${title}`;
    } else if (panel) {
      // The panel registry is the one place panels are named. This used to be
      // a second, shorter mapping that fell through to "Inspector" for
      // anything it didn't list, which was wrong for refine/finder/synthesize/
      // capture the moment they became linkable.
      title = `${getPanelTitle(panel)} \u00B7 ${title}`;
    } else if (liveMode) {
      title = `Now Playing \u00B7 ${title}`;
    } else if (!engineReady) {
      title = `Loading\u2026 \u00B7 ${title}`;
    }
    document.title = title;
  }, [loadingPreset, selectedPresetTitle, panel, liveMode, engineReady]);
}
