/**
 * A request to open the editor on the line that assigns a control, made
 * from outside the editor (the canvas inspector's Edit code). The editor is
 * code-split and mounts a moment after its panel opens, so the request
 * waits here until `EditorSurface` takes it.
 */

import type { CanvasInspectorHooks } from '../milkdrop/overlay/canvas-inspector.ts';

let pending: string | null = null;
const listeners = new Set<() => void>();

export function requestEditorReveal(control: string): void {
  pending = control;
  for (const listener of listeners) listener();
}

/** The waiting control, cleared as it is read so it is applied once. */
export function takeEditorReveal(): string | null {
  const control = pending;
  pending = null;
  return control;
}

export function subscribeEditorReveal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The canvas inspector's hooks, shared by the dock button and the palette
 * row so both open the editor on the line and scale the same way.
 */
export function buildCanvasInspectorHooks({
  openEditor,
  announce,
  readBase,
  setLive,
}: {
  openEditor: () => void;
  announce: (message: string) => void;
  readBase: (control: string) => number | undefined;
  setLive: (control: string, value: number) => void;
}): CanvasInspectorHooks {
  return {
    editCode: (control) => {
      requestEditorReveal(control);
      openEditor();
      announce(`Opening the editor at ${control}.`);
    },
    readBase,
    setLive,
  };
}
