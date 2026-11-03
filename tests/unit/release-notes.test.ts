import { describe, expect, test } from 'bun:test';
import pkg from '../../package.json';
import {
  auditReleaseRecords,
  auditReleaseRecordsAt,
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

const CHANGELOG = `# Changelog

_Latest release: **v1.1.0**._

## [Unreleased]

### Added

- Next.

## [1.1.0] - 2026-02-01

### Added

- Feature.

### Fixed

- Bug.

## [1.0.0] - 2026-01-01

### Added

- First.

[Unreleased]: https://example.test/compare/v1.1.0...HEAD
[1.1.0]: https://example.test/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.test/tree/v1.0.0
`;

const RELEASE_NOTES = `# Release notes

## Release v1.1.0 (2026-02-01)

### 🌟 Release Highlights

- Feature.

### ⚡ Engineering & Performance

- Faster.

### 🐛 Bug Fixes

- Bug.

---

## Release v1.0.0 (2026-01-01)

### 🌟 Release Highlights

- First.
`;

const audit = (
  overrides: Partial<Parameters<typeof auditReleaseRecords>[0]> = {},
) =>
  auditReleaseRecords({
    changelog: CHANGELOG,
    releaseNotes: RELEASE_NOTES,
    packageVersion: '1.1.0',
    ...overrides,
  });

describe('release record audit', () => {
  test('agreeing records have no problems', () => {
    expect(audit()).toEqual([]);
  });

  test('a change type repeated or out of order in a release', () => {
    const repeated = CHANGELOG.replace(
      '- Bug.',
      '- Bug.\n\n### Fixed\n\n- Again.',
    );
    expect(audit({ changelog: repeated })).toEqual([
      'CHANGELOG.md line 11: "### Fixed" is repeated or out of order (Added → Changed → Deprecated → Removed → Fixed → Security).',
    ]);
    const reordered = CHANGELOG.replace(
      '### Added\n\n- Feature.\n\n### Fixed\n\n- Bug.',
      '### Fixed\n\n- Bug.\n\n### Added\n\n- Feature.',
    );
    expect(audit({ changelog: reordered })).toHaveLength(1);
  });

  test('a heading outside the fixed lists', () => {
    const planned = CHANGELOG.replace(
      '### Added\n\n- Next.',
      '### Planned\n\n- Later.',
    );
    expect(audit({ changelog: planned })[0]).toContain(
      '"### Planned" is not one of',
    );
    const renamed = RELEASE_NOTES.replace(
      '🐛 Bug Fixes',
      '🐛 Bug Fixes & Polish',
    );
    expect(audit({ releaseNotes: renamed })[0]).toContain(
      '"### 🐛 Bug Fixes & Polish" is not one of',
    );
  });

  test('a release missing from either file, or dated differently', () => {
    const missing = RELEASE_NOTES.slice(0, RELEASE_NOTES.indexOf('---'));
    expect(audit({ releaseNotes: missing })).toEqual([
      'CHANGELOG.md lists 1.1.0 (2026-02-01), 1.0.0 (2026-01-01); docs/RELEASE_NOTES.md lists 1.1.0 (2026-02-01). Each release needs both, with the same date, in the same order.',
    ]);
    const redated = RELEASE_NOTES.replace('(2026-01-01)', '(2025-12-31)');
    expect(audit({ releaseNotes: redated })).toHaveLength(1);
  });

  test('release notes without highlights', () => {
    const noHighlights = RELEASE_NOTES.replace(
      '### 🌟 Release Highlights\n\n- First.',
      '### 🐛 Bug Fixes\n\n- First.',
    );
    expect(audit({ releaseNotes: noHighlights })).toEqual([
      'docs/RELEASE_NOTES.md line 19: v1.0.0 has no "### 🌟 Release Highlights".',
    ]);
  });

  test('a stale latest-release line or package.json version', () => {
    expect(audit({ packageVersion: '1.2.0' })).toEqual([
      "package.json says 1.2.0, but CHANGELOG.md's newest release is 1.1.0.",
    ]);
    const stale = CHANGELOG.replace('**v1.1.0**', '**v1.0.0**');
    expect(audit({ changelog: stale })[0]).toContain(
      'the "Latest release" line says 1.0.0',
    );
  });

  test('releases out of order or without a link reference', () => {
    const unlinked = CHANGELOG.replace(/^\[1\.0\.0\]: .*$/mu, '');
    expect(audit({ changelog: unlinked })).toEqual([
      'CHANGELOG.md: [1.0.0] has no link reference.',
    ]);
    const backdated = CHANGELOG.replace(
      '[1.1.0] - 2026-02-01',
      '[1.1.0] - 2025-12-01',
    );
    expect(audit({ changelog: backdated })).toContain(
      'CHANGELOG.md: 1.1.0 (2025-12-01) is dated before 1.0.0 (2026-01-01).',
    );
  });

  test('the checked-in changelog and release notes agree', () => {
    // `bun run release:notes -- --check` prints the same list.
    expect(auditReleaseRecordsAt()).toEqual([]);
  });
});
