import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('shows a primary CTA for demo audio and collapsible alternative audio sources', () => {
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
    expect(homeSource).toContain('Play with demo audio');
    expect(homeSource).toContain('cta-button primary');
    expect(homeSource).toContain('<AudioSourcePanel');
    expect(audioSourceSource).toContain('Microphone');
    expect(audioSourceSource).toContain('Audio from this browser tab');
    expect(audioSourceSource).not.toContain('Advanced audio setup');
  });
});
