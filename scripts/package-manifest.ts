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
};

export const PACKAGE_MANIFEST: readonly PackageManifestEntry[] = [
  { name: 'audio-reactive', role: 'standalone' },
  { name: 'eel-conformance', role: 'standalone' },
  { name: 'flash-guard', role: 'standalone' },
  { name: 'milkdrop-toolchain', role: 'standalone' },
];

/** Where the read-only mirrors live (see .github/workflows/mirror-packages.yml). */
export const MIRROR_OWNER = 'zz-plant';

export const mirrorRepo = (name: string) => `${MIRROR_OWNER}/${name}`;

export const packageNames = (role: PackageRole): string[] =>
  PACKAGE_MANIFEST.filter((entry) => entry.role === role).map(
    (entry) => entry.name,
  );
