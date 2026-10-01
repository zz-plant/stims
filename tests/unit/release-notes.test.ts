import { describe, expect, test } from 'bun:test';
import pkg from '../../package.json';
import {
  buildReleaseNotes,
  extractReleaseSection,
  releaseNotesForTag,
} from '../../scripts/release-notes.ts';

const NOTES = `# Stims Release Notes

---

## Release v1.4.0 (2026-10-01)

### Highlights
- Pause.

---

## Release v1.3.0 (2026-07-29)

### Highlights
- Older.
`;

describe('release notes', () => {
  test('extracts the requested release and stops at the separator', () => {
    expect(extractReleaseSection(NOTES, '1.4.0')).toBe(
      '### Highlights\n- Pause.',
    );
    expect(extractReleaseSection(NOTES, '1.3.0')).toBe(
      '### Highlights\n- Older.',
    );
  });

  test('stops at the next release heading when no rule separates them', () => {
    const tight = '## Release v2.0.0\n- New.\n## Release v1.9.0\n- Old.\n';
    expect(extractReleaseSection(tight, '2.0.0')).toBe('- New.');
  });

  test('treats a missing or empty section as no notes', () => {
    expect(extractReleaseSection(NOTES, '9.9.9')).toBeNull();
    expect(extractReleaseSection('## Release v1.0.0\n\n---\n', '1.0.0')).toBe(
      null,
    );
    // A longer version that starts with the same digits is another release.
    expect(extractReleaseSection('## Release v1.4.01\n- x\n', '1.4.0')).toBe(
      null,
    );
  });

  test('builds notes with a link to the changelog at the tag', () => {
    const result = buildReleaseNotes({
      tag: 'v1.4.0',
      packageVersion: '1.4.0',
      releaseNotesMarkdown: NOTES,
    });
    expect(result).toEqual({
      notes:
        '### Highlights\n- Pause.\n\nFull changelog: https://github.com/zz-plant/stims/blob/v1.4.0/CHANGELOG.md\n',
    });
  });

  test('refuses a tag that is not vX.Y.Z', () => {
    for (const tag of ['1.4.0', 'v1.4', 'v1.4.0-rc1', 'release-1.4.0', '']) {
      const result = buildReleaseNotes({
        tag,
        packageVersion: '1.4.0',
        releaseNotesMarkdown: NOTES,
      });
      expect('error' in result).toBe(true);
    }
  });

  test('refuses a tag that disagrees with package.json', () => {
    const result = buildReleaseNotes({
      tag: 'v1.4.0',
      packageVersion: '1.3.0',
      releaseNotesMarkdown: NOTES,
    });
    expect(result).toEqual({
      error:
        'package.json says 1.3.0, but the tag is v1.4.0. Bump the version in the release PR, or tag the commit that did.',
    });
  });

  test('refuses a release with no notes written', () => {
    const result = buildReleaseNotes({
      tag: 'v9.9.9',
      packageVersion: '9.9.9',
      releaseNotesMarkdown: NOTES,
    });
    expect('error' in result && result.error).toContain('## Release v9.9.9');
  });

  test('the version package.json declares has notes ready to publish', () => {
    // Fails the release PR that bumps the version without writing its notes,
    // before anyone pushes a tag the Release workflow would then reject.
    const result = releaseNotesForTag(`v${pkg.version}`);
    expect('error' in result ? result.error : null).toBeNull();
  });
});
