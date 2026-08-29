import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('embedded player branding', () => {
  test('keeps a link back to Stims in the chromeless player', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const appShellCss = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(appSource).toContain('data-embed-brand-link');
    expect(appSource).toContain('Open Stims in a new tab');
    expect(appShellCss).toContain('.stims-shell__embed-brand');
  });
});
