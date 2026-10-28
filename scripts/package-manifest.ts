/**
 * The one list of the standalone packages this repo publishes, and where each
 * one is developed.
 *
 * Every package surface derives from this list: check:ci-config validates the
 * mirror and publish workflow matrices, the packages/ directory and the
 * packages/README.md table against it; check:packages, split-package and
 * check:no-source-seams read it directly. Adding or promoting a package means
 * editing this file first — the guards fail when anything else disagrees.
 *
 * `standalone` means the source of truth lives in packages/<name>/ here.
 * `promoted` means the source of truth has moved to the package's own
 * repository (the path is docs/PACKAGE_PROMOTION.md): the directory is gone,
 * the app consumes a published version, and any workspace-protocol or src/
 * subpath reference left behind is a source seam that check:no-source-seams
 * fails on.
 */

export type PackageRole = 'standalone' | 'promoted';

export type PackageManifestEntry = {
  name: string;
  role: PackageRole;
  /**
   * Whether the package goes to npm. An unpublished package is still built,
   * tested and mirrored, but its package.json sets `"private": true` and the
   * publish workflow does not offer it; check:ci-config holds both to this.
   */
  published: boolean;
};

export const PACKAGE_MANIFEST: readonly PackageManifestEntry[] = [
  // Held 2026-10-13: Meyda and others cover most of it, and its tuning follows Stims.
  { name: 'audio-reactive', role: 'standalone', published: false },
  // Both names were free on npm on 2026-10-07 and again on 2026-10-28.
  { name: 'canvas-video-exporter', role: 'standalone', published: true },
  { name: 'eel-conformance', role: 'standalone', published: true },
  { name: 'flash-guard', role: 'standalone', published: true },
  { name: 'gamepad-navigation', role: 'standalone', published: true },
  { name: 'milkdrop-toolchain', role: 'standalone', published: true },
];

/** Where the read-only mirrors live (see .github/workflows/mirror-packages.yml). */
export const MIRROR_OWNER = 'zz-plant';

export const mirrorRepo = (name: string) => `${MIRROR_OWNER}/${name}`;

export const packageNames = (role: PackageRole): string[] =>
  PACKAGE_MANIFEST.filter((entry) => entry.role === role).map(
    (entry) => entry.name,
  );

/** Standalone packages that go to npm: the publish workflow's choices. */
export const publishedNames = (): string[] =>
  PACKAGE_MANIFEST.filter(
    (entry) => entry.role === 'standalone' && entry.published,
  ).map((entry) => entry.name);
