import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell UI simplification regression', () => {
  test('keeps the stage as the canonical active-look summary and only shows actionable readiness cards', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(source).not.toContain('Current look');
    expect(source).not.toContain('Browse looks');
    expect(source).not.toContain(
      '\n                <p className="stims-shell__eyebrow">Tools</p>',
    );
    expect(source).toMatch(
      /const readinessAlerts = readinessItems\.filter\([\s\S]*?item\.state !== 'ready'/u,
    );
    expect(source).toMatch(
      /\{readinessAlerts\.length > 0 \? \([\s\S]*?readinessAlerts\.map/u,
    );
    expect(source).toMatch(
      /routeState\.panel === 'settings' \? null : 'settings'[\s\S]*?Settings/u,
    );
  });
});
