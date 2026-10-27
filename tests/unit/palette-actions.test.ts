import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  resetStageUtilitiesForTests,
  stageUtilityMode,
} from '../../src/js/core/services/stage-utilities.ts';
import { buildPaletteResults } from '../../src/js/frontend/command-palette-registry.ts';
import type { EngineContextValue } from '../../src/js/frontend/engine-context.tsx';
import { buildPaletteActions } from '../../src/js/frontend/palette-actions.ts';
import { getPanelTitle } from '../../src/js/frontend/panel-registry.ts';
import {
  paletteActionContext as context,
  makeEngineValue,
  makePresetEntry,
  makeUiValue,
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

  test('routed panel actions derive their labels from the panel registry', () => {
    const actions = buildPaletteActions(context());
    expect(label(actions, 'open-browse')).toBe(getPanelTitle('browse'));
    expect(label(actions, 'open-editor')).toBe(getPanelTitle('editor'));
    expect(label(actions, 'open-refine')).toBe(getPanelTitle('refine'));
    expect(label(actions, 'open-generate')).toBe(getPanelTitle('synthesize'));
    expect(label(actions, 'open-settings')).toBe(getPanelTitle('settings'));
    // The finder's title names a thing; the row says what it finds.
    expect(label(actions, 'find-similar')).toBe(
      'Find presets that match the music or picture',
    );
  });

  test('a panel row that would close its open panel says so', () => {
    // togglePanel closes the panel that is already open. The row used to
    // keep saying "Browse presets" while it closed Browse.
    const uiRef = {
      current: makeUiValue({
        routeState: {
          presetId: null,
          collectionTag: null,
          panel: 'browse',
          audioSource: null,
          agentMode: false,
        },
      }),
    };
    const actions = buildPaletteActions(context({ uiRef }));
    expect(label(actions, 'open-browse')).toBe('Close Browse');
    expect(label(actions, 'open-editor')).toBe(getPanelTitle('editor'));

    // Read when the row renders, not when the list was built.
    uiRef.current = makeUiValue();
    expect(label(actions, 'open-browse')).toBe(getPanelTitle('browse'));
  });

  test('toggle rows name the way they will go', () => {
    const saved = makePresetEntry({ id: 'kept', bundledFile: 'kept.milk' });
    const engineBridgeRef = {
      current: makeEngineValue({
        selectedPreset: saved,
        favoritePresets: [saved],
      }),
    } as { current: EngineContextValue };
    const actions = buildPaletteActions(context({ engineBridgeRef }));
    expect(label(actions, 'save-preset')).toBe('Remove from saved');
    engineBridgeRef.current = makeEngineValue({
      selectedPreset: saved,
      favoritePresets: [],
    });
    expect(label(actions, 'save-preset')).toBe('Save preset');
  });

  test('clearing the queue takes a second run', () => {
    const clear = mock(() => {});
    const announce = mock(() => {});
    const uiRef = {
      current: makeUiValue({
        setStatusMessage: announce,
        presetQueue: {
          ...makeUiValue().presetQueue,
          presetIds: ['a', 'b'],
          clear,
        },
      }),
    };
    const actions = buildPaletteActions(context({ uiRef }));
    const run = () =>
      actions.find((action) => action.id === 'queue-clear')?.run();

    run();
    expect(clear).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'Run “Clear the queue” again to remove all 2 queued.',
    );
    run();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe('palette rows for commands that had no other route', () => {
  afterEach(() => {
    resetStageUtilitiesForTests();
    window.__stims_live = undefined;
  });

  test('the D blackout has a row once the stage is live, and it latches', () => {
    expect(
      buildPaletteActions(context()).some((a) => a.id === 'toggle-blackout'),
    ).toBe(false);
    const actions = buildPaletteActions(context({ liveMode: true }));
    const blackout = actions.find((a) => a.id === 'toggle-blackout');
    expect(blackout?.label).toBe('Black out the picture');
    blackout?.run();
    expect(stageUtilityMode()).toBe('blackout');
    expect(blackout?.label).toBe('End the blackout');
    blackout?.run();
    expect(stageUtilityMode()).toBe('normal');
  });

  test('the AI scene pick is offered only once two scenes exist', () => {
    const actions = buildPaletteActions(context({ liveMode: true }));
    const offered = () =>
      buildPaletteResults({ query: 'scene', actions }).some(
        (result) => result.id === 'action:auto-switch-scene',
      );
    expect(offered()).toBe(false);
    window.__stims_live = {
      listScenes: () => [
        { name: 'calm', positions: {}, modulators: [] },
        { name: 'peak', positions: {}, modulators: [] },
      ],
    } as unknown as typeof window.__stims_live;
    expect(offered()).toBe(true);
  });
});
