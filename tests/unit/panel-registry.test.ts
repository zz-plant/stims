import { describe, expect, test } from 'bun:test';
import { ALL_PANEL_IDS } from '../../src/js/frontend/contracts.ts';
import {
  getPanelDescriptor,
  getPanelTitle,
  isPanelStageAnchored,
  PANEL_REGISTRY,
} from '../../src/js/frontend/panel-registry.ts';

const panelsWhere = (
  flag: 'stageAnchored' | 'fillBody' | 'wide' | 'prefetchOnMenu',
) => ALL_PANEL_IDS.filter((id) => PANEL_REGISTRY[id][flag]);

describe('panel registry', () => {
  test('every routed panel has a titled descriptor keyed by its own id', () => {
    for (const id of ALL_PANEL_IDS) {
      expect(getPanelDescriptor(id)?.id).toBe(id);
      expect(getPanelTitle(id)).not.toBe('');
    }
  });

  test('unknown or empty panel ids resolve to no descriptor and no title', () => {
    for (const panel of [null, undefined, '', 'inspector']) {
      expect(getPanelDescriptor(panel)).toBeNull();
      expect(getPanelTitle(panel)).toBe('');
      expect(isPanelStageAnchored(panel)).toBe(false);
    }
  });

  test('the editor is the only stage-anchored panel', () => {
    expect(panelsWhere('stageAnchored')).toEqual(['editor']);
  });

  test('browse and the editor manage their own scrolling; only browse is wide', () => {
    expect(panelsWhere('fillBody')).toEqual(['browse', 'editor']);
    expect(panelsWhere('wide')).toEqual(['browse']);
    expect(PANEL_REGISTRY.browse.loadingShape).toBe('browse');
  });

  test('opening the stage menu prefetches every menu panel except the editor', () => {
    // The editor chunk carries CodeMirror and the toolchain and has its own
    // gated idle prewarm; refine was missing from the old hand-written list.
    expect(panelsWhere('prefetchOnMenu')).toEqual([
      'browse',
      'capture',
      'finder',
      'refine',
      'settings',
      'synthesize',
    ]);
  });
});
