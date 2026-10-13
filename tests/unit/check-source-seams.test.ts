import { describe, expect, test } from 'bun:test';
/**
 * Tests for the promoted-package source-seam rules.
 *
 * The real-repo smoke run lives below (today every package is standalone, so
 * the script short-circuits); these cases exercise the rules against
 * synthetic dependencies and files, because the seams this guard exists to
 * catch only exist once a package is promoted — and then every one of them
 * must be named, not merely "something failed".
 */
import { findSourceSeams } from '../../scripts/check-source-seams.ts';

const PROMOTED = ['audio-reactive'];
const CLEAN_IMPORTS = [
  {
    path: 'src/js/core/audio-handler.ts',
    content: "import { fft } from 'audio-reactive';",
  },
  {
    path: 'src/js/core/audio-handler.ts',
    content: "import workletUrl from 'audio-reactive/worklet?worklet';",
  },
];

describe('findSourceSeams', () => {
  test('no promoted packages means nothing to check, regardless of content', () => {
    expect(
      findSourceSeams({
        promoted: [],
        dependencies: [
          {
            file: 'package.json',
            name: 'audio-reactive',
            version: 'workspace:*',
          },
        ],
        files: [
          { path: 'src/a.ts', content: "from 'audio-reactive/src/index'" },
        ],
      }),
    ).toEqual([]);
  });

  test('a workspace-protocol dependency on a promoted package is a seam', () => {
    // The seam Phase 1 of the promotion plan must remove: after the directory
    // moves to its own repo, the workspace link no longer exists and every
    // install of this repo fails to resolve the dependency.
    const errors = findSourceSeams({
      promoted: PROMOTED,
      dependencies: [
        {
          file: 'package.json',
          name: 'audio-reactive',
          version: 'workspace:*',
        },
      ],
      files: [],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('package.json: audio-reactive is promoted');
    expect(errors[0]).toContain('workspace:*');
  });

  test('a version-range dependency on a promoted package is fine', () => {
    expect(
      findSourceSeams({
        promoted: PROMOTED,
        dependencies: [
          { file: 'package.json', name: 'audio-reactive', version: '^0.1.0' },
        ],
        files: [],
      }),
    ).toEqual([]);
  });

  test('a src/ subpath import of a promoted package is a seam', () => {
    // The seam that makes milkdrop-toolchain the hard case: dozens of these,
    // each resolving to nothing once packages/ no longer holds the source.
    const errors = findSourceSeams({
      promoted: PROMOTED,
      dependencies: [],
      files: [
        {
          path: 'src/js/a.ts',
          content: "import { x } from 'audio-reactive/src/internal';",
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/js/a.ts');
    expect(errors[0]).toContain('subpath import');
  });

  test('a relative import reaching into packages/ is a seam', () => {
    const errors = findSourceSeams({
      promoted: PROMOTED,
      dependencies: [],
      files: [
        {
          path: 'scripts/lab.ts',
          content:
            "import { y } from '../packages/audio-reactive/src/index.ts';",
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('relative import');
  });

  test('bare and public-subpath imports of a promoted package are fine', () => {
    // `.` and `./worklet` are the published entry points; only src/ subpaths
    // and packages/ relative paths are seams.
    expect(
      findSourceSeams({
        promoted: PROMOTED,
        dependencies: [],
        files: CLEAN_IMPORTS,
      }),
    ).toEqual([]);
  });
});
