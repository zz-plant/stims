import { describe, expect, test } from 'bun:test';
import { WorkspaceStagePanel } from '../../src/js/frontend/workspace-ui.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

const stageProps = {
  isFullscreen: false,
  launchPanel: null,
  liveMode: true,
  onToggleFullscreen: () => {},
};

describe('Workspace shell first-run and recovery regression', () => {
  test('a dead experience link names itself instead of failing silently', () => {
    // Renders the real stage panel with the route reporting an unknown
    // experience slug — the state a stale shared link produces — and asserts
    // the recovery surface the user actually sees. The old version of this
    // test grepped six source files for variable spellings
    // (`requestedPresetId`, `missingRequestedPreset = Boolean(...)`), which a
    // rename reddened and a broken flow with intact names would have passed.
    const rendered = renderWorkspace(<WorkspaceStagePanel {...stageProps} />, {
      ui: {
        routeState: {
          presetId: null,
          collectionTag: null,
          panel: null,
          audioSource: null,
          agentMode: false,
          invalidExperienceSlug: 'retired-experience',
        },
      },
    });
    try {
      expect(rendered.text()).toContain('Link no longer works');
      expect(rendered.text()).toContain('retired-experience');
    } finally {
      rendered.dispose();
    }
  });

  test('a preset missing from the build suppresses the live stage chrome', () => {
    // missingRequestedPreset is the engine-side half of the same recovery: a
    // ?preset= id the catalog cannot resolve must not present a live stage
    // (controls, gizmo, cue monitor) over a session that never started.
    const withMissing = renderWorkspace(
      <WorkspaceStagePanel {...stageProps} />,
      { engine: { missingRequestedPreset: true } },
    );
    const without = renderWorkspace(<WorkspaceStagePanel {...stageProps} />, {
      engine: { missingRequestedPreset: false },
    });
    try {
      // StageControls styles itself through CSS modules, so probe by a stable
      // aria-label from its transport cluster rather than a class name.
      const controls = (r: typeof withMissing) =>
        r.container.querySelectorAll('[aria-label="Previous preset"]').length;
      expect(controls(without)).toBeGreaterThan(0);
      expect(controls(withMissing)).toBe(0);
    } finally {
      withMissing.dispose();
      without.dispose();
    }
  });
});
