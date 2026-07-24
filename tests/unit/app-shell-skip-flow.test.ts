import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontendSource = (fileName: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', 'assets', 'js', 'frontend', fileName),
    'utf8',
  );

const cssSource = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', '..', relativePath), 'utf8');

describe('launch shell skip-to-visualizer flow', () => {
  test('targets the visualizer stage instead of looping focus to the shell container', () => {
    const appSource = frontendSource('App.tsx');
    const uiSource = frontendSource('workspace-ui.tsx');
    const stageSource = frontendSource('StimsStageFrame.tsx');
    const accessibilityTestSource = readFileSync(
      join(import.meta.dir, 'accessibility-regression.test.ts'),
      'utf8',
    );

    expect(appSource).toContain(
      '<a href="#stims-visualizer" className="skip-link">',
    );
    expect(appSource).toContain('Skip to visualizer');
    expect(uiSource).toContain('#preset-search, .milkdrop-overlay__search');
    expect(stageSource).toContain('id="stims-visualizer"');
    expect(stageSource).toContain('tabIndex={-1}');
    expect(accessibilityTestSource).toContain('href="#stims-visualizer"');
  });

  test('keeps launch hero dismissal tied to live data-mode transitions', () => {
    const workspaceSource = frontendSource('workspace-ui.tsx');
    const stageSource = frontendSource('StimsStageFrame.tsx');
    const shellCss = cssSource('src/css/app-shell.css');

    expect(workspaceSource).toContain("data-mode={liveMode ? 'live' : 'home'}");
    expect(stageSource).toContain("data-mode={liveMode ? 'live' : 'home'}");
    expect(shellCss).toContain(
      '.stims-shell__stage-frame[data-mode="live"] .stims-shell__launch',
    );
    expect(shellCss).toContain('pointer-events: none;');
    expect(shellCss).toContain('visibility: hidden;');
  });
});
