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
        'assets',
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
        'assets',
        'js',
        'frontend',
        'AudioSourcePanel.tsx',
      ),
      'utf8',
    );
    const appShellCss = readFileSync(
      join(import.meta.dir, '..', '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(homeSource).not.toContain('See visuals now');
    expect(homeSource).not.toContain('Play with demo audio');
    expect(homeSource).not.toContain('Start instantly with demo audio');
    expect(homeSource).toContain(
      "import { AudioSourcePanel } from './AudioSourcePanel.tsx';",
    );
    expect(homeSource).toContain('stims-shell__launch-layout');
    expect(homeSource).toContain('stims-shell__launch-rail');
    expect(homeSource).toContain('stims-shell__launch-source-dock');
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
    expect(appShellCss).toContain('.stims-shell__launch-layout');
    expect(appShellCss).toContain(
      'grid-template-columns: minmax(18rem, 0.78fr) minmax(26rem, 1fr);',
    );
    expect(appShellCss).toContain(
      '@media (min-width: 1121px) and (max-width: 1280px)',
    );
    expect(appShellCss).toMatch(
      /\.stims-shell__launch-layout\s*>\s*\.stims-shell__launch-source-dock\s*\{[\s\S]*?align-self:\s*start;/u,
    );
    expect(appShellCss).toContain('align-content: start;');
    expect(appShellCss).toContain('align-items: start;');
  });
});
