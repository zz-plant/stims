import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('shows first-class YouTube and user-audio choices without demo generation', () => {
    const homeSource = readFileSync(
      join(
        import.meta.dir,
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
        'assets',
        'js',
        'frontend',
        'AudioSourcePanel.tsx',
      ),
      'utf8',
    );

    expect(homeSource).not.toContain('See visuals now');
    expect(homeSource).toContain('Visualize YouTube');
    expect(homeSource).not.toContain('Play with demo audio');
    expect(homeSource).not.toContain('Start instantly with demo audio');
    expect(homeSource).toContain('cta-button primary');
    expect(homeSource).toContain('<AudioSourcePanel');
    expect(audioSourceSource).toContain('YouTube playback');
    expect(audioSourceSource).not.toContain('Use demo audio instead');
    expect(audioSourceSource).toContain('Microphone');
    expect(audioSourceSource).toContain('Audio from this browser tab');
    expect(audioSourceSource).not.toContain('Advanced audio setup');
  });
});
