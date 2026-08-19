import { useEffect } from 'react';
import type { PanelState } from '../contracts.ts';
import { getToolLabel } from '../workspace-helpers.ts';

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
      // getToolLabel is the one place panels are named, shared with the
      // palette and the dock. This used to be a second, shorter mapping that
      // fell through to "Inspector" for anything it didn't list — which was
      // invisible while only four panels were URL-addressable, and wrong for
      // refine/finder/synthesize/capture the moment they became linkable.
      title = `${getToolLabel(panel)} \u00B7 ${title}`;
    } else if (liveMode) {
      title = `Now Playing \u00B7 ${title}`;
    } else if (!engineReady) {
      title = `Loading\u2026 \u00B7 ${title}`;
    }
    document.title = title;
  }, [loadingPreset, selectedPresetTitle, panel, liveMode, engineReady]);
}
