import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('shows first-class YouTube and user-audio choices without demo generation', () => {
    const homeSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'NewHomePage.tsx',
      ),
      'utf8',
    );

    const audioSourceSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'AudioSourcePanel.tsx',
      ),
      'utf8',
    );
    const appShellCss = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(homeSource).not.toContain('See visuals now');
    expect(homeSource).not.toContain('Play with demo audio');
    expect(homeSource).not.toContain('Start instantly with demo audio');
    expect(homeSource).toContain(
      "import { AudioSourcePanel } from './AudioSourcePanel.tsx';",
    );
    expect(homeSource).toContain('stims-shell__launch--minimal');
    expect(homeSource).toContain('stims-shell__launch-center');
    expect(homeSource).toContain('stims-shell__launch-source-minimal');
    expect(homeSource).toContain('<AudioSourcePanel showHelp={false} />');
    expect(homeSource).not.toContain('Create a visual preset');
    expect(homeSource).not.toContain('useGeneratePreset');
    expect(homeSource).toContain('Browse presets');
    expect(audioSourceSource).toContain('YouTube playback');
    expect(audioSourceSource).toContain('data-youtube-url-input');
    expect(audioSourceSource).toContain('stims-shell__youtube-primary');
    expect(audioSourceSource).toContain('stims-shell__youtube-recent-header');
    expect(audioSourceSource).not.toContain('style={{');
    expect(audioSourceSource).not.toContain('Use demo audio instead');
    expect(audioSourceSource).toContain('Microphone');
    expect(audioSourceSource).toContain('Audio from this browser tab');
    expect(audioSourceSource).not.toContain('Advanced audio setup');
    expect(appShellCss).toContain('.stims-shell__youtube-primary');
    // The two-column `.stims-shell__launch-layout` grid this used to pin is
    // gone: that class is applied by nothing, so its rules were removed as dead
    // CSS. The launch surface renders through these instead.
    expect(appShellCss).toContain('.stims-shell__launch-center');
    expect(appShellCss).toContain('.stims-shell__launch-actions-minimal');
    expect(appShellCss).toContain('align-content: start;');
    expect(appShellCss).toContain('align-items: start;');
  });
});
