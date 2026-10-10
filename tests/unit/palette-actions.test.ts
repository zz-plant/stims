import { describe, expect, mock, test } from 'bun:test';
import type { EngineContextValue } from '../../src/js/frontend/engine-context.tsx';
import { buildPaletteActions } from '../../src/js/frontend/palette-actions.ts';
import {
  paletteActionContext as context,
  makeEngineValue,
} from '../frontend-harness.tsx';

/**
 * The command palette's action list, built outside the app shell. Labels
 * follow the context's flags; handlers read the engine through the ref at
 * run time, which is why the list only rebuilds when a label changes.
 */

const label = (actions: ReturnType<typeof buildPaletteActions>, id: string) =>
  actions.find((action) => action.id === id)?.label;

describe('palette actions', () => {
  test('ids are unique', () => {
    const ids = buildPaletteActions(context()).map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('next-preset');
  });

  test('labels follow the flags they depend on', () => {
    const shareId = buildPaletteActions(context())
      .map((a) => a.id)
      .find((id) => id.includes('share')) as string;
    expect(label(buildPaletteActions(context()), shareId)).toBe('Share link');
    expect(
      label(buildPaletteActions(context({ editorDirty: true })), shareId),
    ).toBe('Share link (carries your edits)');
    const fullscreenId = buildPaletteActions(context())
      .map((a) => a.id)
      .find((id) => id.includes('fullscreen')) as string;
    expect(
      label(buildPaletteActions(context({ isFullscreen: true })), fullscreenId),
    ).toBe('Exit full screen');
  });

  test('a handler reaches the engine current at run time, not at build time', () => {
    const first = mock(() => {});
    const later = mock(() => {});
    const engineRef = {
      current: makeEngineValue({ handleShufflePreset: first }),
    } as { current: EngineContextValue };
    const actions = buildPaletteActions(context({ engineRef }));
    engineRef.current = makeEngineValue({ handleShufflePreset: later });
    actions.find((action) => action.id === 'next-preset')?.run();
    expect(first).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
  });

  test('the watch HUD action toggles against the stage read at run time', () => {
    const announce = mock(() => {});
    const stage = document.createElement('div');
    const uiRef = {
      current: {
        stageRef: { current: stage },
        setStatusMessage: announce,
      },
    } as unknown as Parameters<typeof buildPaletteActions>[0]['uiRef'];
    const actions = buildPaletteActions(context({ uiRef }));

    actions.find((action) => action.id === 'toggle-watcher-hud')?.run();
    expect(announce).toHaveBeenCalledWith(
      'Variable watch HUD on — it plots the variables you pin in Inspect.',
    );
    expect(stage.querySelector('.stims-watch-hud')).not.toBeNull();

    actions.find((action) => action.id === 'toggle-watcher-hud')?.run();
    expect(announce).toHaveBeenCalledWith('Variable watch HUD off.');
    expect(stage.querySelector('.stims-watch-hud')).toBeNull();

    // Without a running stage the action reports that rather than throwing.
    const noStageUiRef = {
      current: { stageRef: { current: null }, setStatusMessage: announce },
    } as unknown as Parameters<typeof buildPaletteActions>[0]['uiRef'];
    buildPaletteActions(context({ uiRef: noStageUiRef }))
      .find((action) => action.id === 'toggle-watcher-hud')
      ?.run();
    expect(announce).toHaveBeenCalledWith('The stage is not running yet.');
  });
});
