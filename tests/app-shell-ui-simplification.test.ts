import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell UI simplification regression', () => {
  test('keeps the shell copy centered on the launch path, featured looks, and quick tuning', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(source).toContain(
      'Start with a featured vibe or dive into the full preset library.',
    );
    expect(source).toContain(
      'Start demo for the quickest payoff. Mic reacts to your room. Tab capture is best when music is already playing in the browser.',
    );
    expect(source).toContain(
      'Start with a featured vibe or search the full library.',
    );
    expect(source).toContain('Shuffle a look');
    expect(source).toContain(
      'Stay on Balanced unless the picture feels rough.',
    );
    expect(source).toContain(
      'Use these only when you want a sharper image or need to calm',
    );
    expect(source).toMatch(
      /const launchEyebrow = missingRequestedPreset\s*\? 'Recover your session'/u,
    );
    expect(source).toMatch(/<p>\s*\{launchSummary\}\s*<\/p>/u);
    expect(source).toMatch(
      /className="stims-shell__meta-copy stims-shell__stage-summary">\s*\{stageSummary\}\s*<\/p>/u,
    );
  });
});
