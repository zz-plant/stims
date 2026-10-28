/**
 * Declarative registry of routed side panels.
 *
 * Stims renders secondary surfaces (Browse catalog, Code editor, Preset finder,
 * AI refine/synthesize, Video capture, Settings) inside a single SidePanel shell.
 * Panel metadata used to be scattered: titles in workspace-helpers.ts, the menu
 * prefetch list in panel-chunks.ts, and layout flags (stageAnchored, fillBody,
 * wide) as id comparisons in App.tsx and the workspace hooks. The menu prefetch
 * list had also drifted from the menu and left out the refine panel.
 *
 * This module is the single source of truth for panel descriptors, layout flags,
 * titles, and menu inclusion. Dynamic chunk fetching lives in ./panel-chunks.ts
 * to avoid circular dependencies between panel implementations and workspace utilities.
 */

import type { RoutedPanelId } from './contracts.ts';

export type PanelLoadingShape = 'browse' | 'default';

export type PanelDescriptor = {
  readonly id: RoutedPanelId;
  /** Human-readable panel title shown in the SidePanel header and document title. */
  readonly title: string;
  /**
   * Whether the panel is stage-anchored: no full-screen backdrop is rendered,
   * so the live stage and transport dock stay visible and interactive beside it.
   */
  readonly stageAnchored: boolean;
  /**
   * Whether the body stops being a scroll container and becomes a fixed-height
   * flex column, so the panel manages its own scrolling regions (e.g. CodeMirror,
   * virtualized browse grid).
   */
  readonly fillBody: boolean;
  /**
   * Whether the panel takes most of a desktop viewport instead of a standard rail.
   */
  readonly wide: boolean;
  /**
   * Whether this panel is reachable from the stage dock's ☰ menu and should be
   * prefetched when the visitor opens that menu.
   */
  readonly prefetchOnMenu: boolean;
  /**
   * Skeleton loading shape while the lazy chunk is downloading.
   */
  readonly loadingShape: PanelLoadingShape;
};

export const PANEL_REGISTRY: Readonly<Record<RoutedPanelId, PanelDescriptor>> =
  {
    browse: {
      id: 'browse',
      title: 'Browse presets',
      stageAnchored: false,
      fillBody: true,
      wide: true,
      prefetchOnMenu: true,
      loadingShape: 'browse',
    },
    capture: {
      id: 'capture',
      title: 'Record video',
      stageAnchored: false,
      fillBody: false,
      wide: false,
      prefetchOnMenu: true,
      loadingShape: 'default',
    },
    editor: {
      id: 'editor',
      title: 'Edit preset code',
      stageAnchored: true,
      fillBody: true,
      wide: false,
      // The editor is by far the heaviest prefetch in the app (carries CodeMirror
      // and the toolchain/compiler graph), and has its own gated idle prewarm
      // (desktop, runtime up, real idle), so it is not prefetched on mere menu open.
      prefetchOnMenu: false,
      loadingShape: 'default',
    },
    finder: {
      id: 'finder',
      title: 'Find a preset',
      stageAnchored: false,
      fillBody: false,
      wide: false,
      prefetchOnMenu: true,
      loadingShape: 'default',
    },
    refine: {
      id: 'refine',
      title: 'Refine with AI',
      stageAnchored: false,
      fillBody: false,
      wide: false,
      prefetchOnMenu: true,
      loadingShape: 'default',
    },
    settings: {
      id: 'settings',
      title: 'Settings',
      stageAnchored: false,
      fillBody: false,
      wide: false,
      prefetchOnMenu: true,
      loadingShape: 'default',
    },
    synthesize: {
      id: 'synthesize',
      title: 'Generate with AI',
      stageAnchored: false,
      fillBody: false,
      wide: false,
      prefetchOnMenu: true,
      loadingShape: 'default',
    },
  };

/**
 * Return the descriptor for the specified panel id, or null if null/undefined/unrecognized.
 */
export function getPanelDescriptor(
  panel: string | null | undefined,
): PanelDescriptor | null {
  if (!panel) return null;
  return (
    (PANEL_REGISTRY as Record<string, PanelDescriptor | undefined>)[panel] ??
    null
  );
}

/**
 * Return the human-readable title for a panel.
 */
export function getPanelTitle(panel: string | null | undefined): string {
  return getPanelDescriptor(panel)?.title ?? '';
}

/**
 * Check whether a panel is stage-anchored (no backdrop, resizable seam, non-modal).
 */
export function isPanelStageAnchored(
  panel: string | null | undefined,
): boolean {
  return getPanelDescriptor(panel)?.stageAnchored ?? false;
}
