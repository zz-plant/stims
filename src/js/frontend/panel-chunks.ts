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
 */

/** Panel route ids, as they appear in `routeState.panel`. Internal: callers
 * pass a plain string, which is what the route state actually holds. */
type PanelChunkId =
  | 'browse'
  | 'capture'
  | 'editor'
  | 'finder'
  | 'refine'
  | 'settings'
  | 'synthesize';

const PANEL_CHUNKS: Record<PanelChunkId, () => void> = {
  browse: () => void import('./BrowseSheetPanel.tsx'),
  capture: () => void import('./CapturePanel.tsx'),
  editor: () => {
    void import('./EditorPanel.tsx');
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
  PANEL_CHUNKS[panel as PanelChunkId]?.();
}

/**
 * The panels reachable from the stage dock's menu.
 *
 * Opening that menu is the clearest statement of intent the UI gets short of
 * a click, and by then the download is on the critical path. The editor chain
 * is deliberately absent: it is by far the heaviest prefetch in the app, and
 * it already has its own gated prewarm (desktop, runtime up, real idle) that
 * knows things this call site does not.
 */
const MENU_PANELS: PanelChunkId[] = [
  'browse',
  'settings',
  'capture',
  'finder',
  'synthesize',
];

/** Prefetch every panel the stage menu can launch. */
export function prefetchMenuPanelChunks(): void {
  for (const panel of MENU_PANELS) PANEL_CHUNKS[panel]();
}
