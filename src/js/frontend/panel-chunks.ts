/**
 * Where every routed panel's lazy chunk lives, and the one place that starts
 * one downloading.
 *
 * Panels are code-split, so the first open of one pays a network round trip
 * before anything can render — seconds on a cold cache, during which the sheet
 * is a stack of grey bars. The app already prewarms the two or three panels a
 * visitor is statistically likely to want; this module adds the case that is
 * not a guess at all: the visitor has told us where they are going, by opening
 * the menu that launches these panels or by routing to one directly.
 *
 * Import cost is nil — the map holds thunks, so nothing is fetched until
 * something calls `prefetchPanelChunk`. Repeat calls are free: the module
 * registry dedupes, and a chunk already in flight or resolved is not refetched.
 *
 * Panel descriptors and metadata live in ./panel-registry.ts.
 */

import { ALL_PANEL_IDS, type RoutedPanelId } from './contracts.ts';
import { PANEL_REGISTRY } from './panel-registry.ts';

const PANEL_CHUNKS: Record<RoutedPanelId, () => void> = {
  browse: () => void import('./BrowseSheetPanel.tsx'),
  capture: () => void import('./CapturePanel.tsx'),
  editor: () => {
    void import('./EditorSurface.tsx');
    // The editor is the one panel whose chunk is not the whole cost: the
    // overlay carries the CodeMirror/compiler graph behind it.
    void import('../milkdrop/overlay/editor-panel.ts');
  },
  finder: () => void import('./PresetFinderPanel.tsx'),
  refine: () => void import('./RefinePanel.tsx'),
  settings: () => void import('./SettingsSheetPanel.tsx'),
  synthesize: () => void import('./SynthesizePanel.tsx'),
};

/** Start one panel's chunk downloading. Unknown ids are ignored. */
export function prefetchPanelChunk(panel: string | null | undefined): void {
  if (!panel) return;
  PANEL_CHUNKS[panel as RoutedPanelId]?.();
}

/**
 * Prefetch every panel reachable from the stage dock's ☰ menu.
 * Menu inclusion is driven by the declarative PANEL_REGISTRY.
 */
export function prefetchMenuPanelChunks(): void {
  for (const panelId of ALL_PANEL_IDS) {
    if (PANEL_REGISTRY[panelId].prefetchOnMenu) {
      PANEL_CHUNKS[panelId]();
    }
  }
}
