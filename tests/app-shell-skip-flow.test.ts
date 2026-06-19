import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontendSource = (fileName: string) =>
  readFileSync(
    join(import.meta.dir, '..', 'assets', 'js', 'frontend', fileName),
    'utf8',
  );

const cssSource = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('launch shell skip-to-visualizer flow', () => {
  test('targets the visualizer stage instead of looping focus to the shell container', () => {
    const appSource = frontendSource('App.tsx');
    const stageSource = frontendSource('StimsStageFrame.tsx');
    const accessibilityTestSource = readFileSync(
      join(import.meta.dir, 'accessibility-regression.test.ts'),
      'utf8',
    );

    expect(appSource).toContain(
      '<a href="#stims-visualizer" className="skip-link">',
    );
    expect(appSource).toContain('Skip to visualizer');
    expect(stageSource).toContain('id="stims-visualizer"');
    expect(stageSource).toContain('tabIndex={-1}');
    expect(accessibilityTestSource).toContain('href="#stims-visualizer"');
  });

  test('keeps launch hero dismissal tied to live data-mode transitions', () => {
    const appSource = frontendSource('App.tsx');
    const homeSource = frontendSource('NewHomePage.tsx');
    const workspaceSource = frontendSource('workspace-ui.tsx');
    const stageSource = frontendSource('StimsStageFrame.tsx');
    const shellCss = cssSource('assets/css/app-shell.css');

    expect(appSource).toContain("data-mode={liveMode ? 'live' : 'home'}");
    expect(workspaceSource).toContain("data-mode={liveMode ? 'live' : 'home'}");
    expect(stageSource).toContain("data-mode={liveMode ? 'live' : 'home'}");
    expect(homeSource).toContain("handleStartAudio('demo')");
    expect(shellCss).toContain(
      '.stims-shell__stage-frame[data-mode="live"] .stims-shell__launch',
    );
    expect(shellCss).toContain('pointer-events: none;');
  });

  test('only exposes the mobile control bar after the visualizer is live and hides it on tablet widths', () => {
    const appSource = frontendSource('App.tsx');
    const mobileBarCss = cssSource('assets/css/MobileControlBar.module.css');

    expect(appSource).toMatch(
      /\{liveMode \? \(\s*<MobileControlBar[\s\S]*?\) : null\}/u,
    );
    expect(mobileBarCss).toContain('.bar[data-visible="true"]');
    expect(mobileBarCss).toContain('@media (width >= 768px)');
    expect(mobileBarCss).toMatch(/\.bar\s*\{\s*display: none;/u);
  });
});
