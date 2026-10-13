import { describe, expect, test } from 'bun:test';
/**
 * Tests for the package-surface agreement rules in check-ci-config.
 *
 * The real-repo smoke run lives in check-ci-config.test.ts; these exercise
 * the rules against synthetic states, because the drift this guard exists to
 * catch (a workflow matrix that forgot a package, a promoted directory that
 * never got deleted) cannot be reproduced by asserting today's tree is clean.
 */
import {
  readmeTableNames,
  verifyPackageSurfaces,
  yamlBlockList,
} from '../../scripts/check-ci-config.ts';
import { PACKAGE_MANIFEST } from '../../scripts/package-manifest.ts';

const agree = {
  standalone: ['audio-reactive', 'flash-guard'],
  promoted: [],
  onDisk: ['audio-reactive', 'flash-guard'],
  mirrorMatrix: ['audio-reactive', 'flash-guard'],
  publishChoices: ['audio-reactive', 'flash-guard'],
  readmeTable: ['audio-reactive', 'flash-guard'],
};

describe('verifyPackageSurfaces', () => {
  test('agreeing surfaces produce no errors', () => {
    expect(verifyPackageSurfaces(agree)).toEqual([]);
  });

  test('a workflow matrix that forgot a package is named', () => {
    // The drift that motivated the manifest: mirror-packages.yml's matrix is
    // hand-maintained, and a package added everywhere but there would be
    // silently unmirrored.
    const errors = verifyPackageSurfaces({
      ...agree,
      mirrorMatrix: ['audio-reactive'],
    });
    expect(errors).toEqual([
      'mirror-packages.yml matrix is missing: flash-guard',
    ]);
  });

  test('a publish choice for an unmanifested package is named', () => {
    const errors = verifyPackageSurfaces({
      ...agree,
      publishChoices: ['audio-reactive', 'flash-guard', 'ghost-package'],
    });
    expect(errors).toEqual([
      'publish-packages.yml choices lists unmanifested packages: ghost-package',
    ]);
  });

  test('an on-disk package missing from the manifest is named', () => {
    const errors = verifyPackageSurfaces({
      ...agree,
      onDisk: ['audio-reactive', 'flash-guard', 'mystery'],
    });
    expect(errors).toEqual([
      'packages/ directory lists unmanifested packages: mystery',
    ]);
  });

  test('a standalone manifest entry with no directory is named', () => {
    const errors = verifyPackageSurfaces({
      ...agree,
      onDisk: ['audio-reactive'],
    });
    expect(errors).toEqual(['packages/ directory is missing: flash-guard']);
  });

  test('a promoted package whose directory still exists is named', () => {
    // Half-finished promotion: the manifest says the source moved out, the
    // directory says it did not. Either resolution is fine; ambiguity is not.
    const errors = verifyPackageSurfaces({
      ...agree,
      promoted: ['audio-reactive'],
    });
    expect(errors).toEqual([
      'audio-reactive is promoted but packages/audio-reactive/ still exists — ' +
        'delete the directory or move it back to standalone in package-manifest.ts',
    ]);
  });

  test('the README table is checked like any other surface', () => {
    const errors = verifyPackageSurfaces({
      ...agree,
      readmeTable: ['audio-reactive'],
    });
    expect(errors).toEqual([
      'packages/README.md table is missing: flash-guard',
    ]);
  });

  test('the current manifest is all-standalone, matching its directory', () => {
    expect(PACKAGE_MANIFEST.every((entry) => entry.role === 'standalone')).toBe(
      true,
    );
  });
});

describe('yamlBlockList', () => {
  test('reads the block list under a key and stops at its indentation', () => {
    const workflow = [
      'jobs:',
      '  mirror:',
      '    strategy:',
      '      matrix:',
      '        package:',
      '          - eel-conformance',
      '          - flash-guard',
      '',
      '    steps:',
      '      - name: Split',
    ].join('\n');

    expect(yamlBlockList(workflow, 'package')).toEqual([
      'eel-conformance',
      'flash-guard',
    ]);
  });

  test('a missing key yields an empty list', () => {
    expect(yamlBlockList('jobs: []\n', 'options')).toEqual([]);
  });
});

describe('readmeTableNames', () => {
  test('reads package links from the README table, not the mirror table', () => {
    const readme = [
      '| Package | What it is |',
      '| --- | --- |',
      '| [`audio-reactive`](./audio-reactive) | Audio analysis. |',
      '',
      '## Mirrors',
      '',
      '| Package | Mirror |',
      '| --- | --- |',
      '| `audio-reactive` | [zz-plant/audio-reactive](https://github.com/zz-plant/audio-reactive) |',
    ].join('\n');

    expect(readmeTableNames(readme)).toEqual(['audio-reactive']);
  });
});
