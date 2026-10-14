/**
 * A recording made with Reduce flashing on carries the governor's dimming
 * (stage-presentation.ts). Without a word from the record panel, a video
 * that darkens wherever the preset strobes reads as a broken export.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { CapturePanel } from '../../src/js/frontend/CapturePanel.tsx';
import {
  type RenderedWorkspace,
  renderWorkspace,
} from '../frontend-harness.tsx';

let view: RenderedWorkspace | null = null;
const restore: Array<() => void> = [];

beforeEach(() => {
  resetAccessibilityPreferenceState();
  // The panel checks for a stage canvas by constructor, which the test DOM
  // keeps on `window` only.
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals.HTMLCanvasElement === undefined) {
    globals.HTMLCanvasElement = (
      window as unknown as Record<string, unknown>
    ).HTMLCanvasElement;
    restore.push(() => {
      Reflect.deleteProperty(globals, 'HTMLCanvasElement');
    });
  }
});

afterEach(() => {
  view?.dispose();
  view = null;
  while (restore.length) restore.pop()?.();
  resetAccessibilityPreferenceState();
  localStorage.clear();
});

test('says the recording is dimmed where it strobes, for as long as Reduce flashing is on', () => {
  setAccessibilityPreference({ reduceFlashing: true });
  view = renderWorkspace(<CapturePanel />);
  expect(view.text()).toMatch(/reduce flashing is on/i);

  act(() => {
    setAccessibilityPreference({ reduceFlashing: false });
  });
  expect(view.text()).not.toMatch(/reduce flashing/i);
});
