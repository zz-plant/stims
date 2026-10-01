/**
 * Prints the GitHub Release notes for a version tag, and refuses a tag that
 * does not match the release the repo says it is cutting.
 *
 * The release flow in docs/DEPLOYMENT.md tags the version after merging, but
 * a bare tag is not a GitHub Release: v1.1.0 through v1.3.0 were written up in
 * docs/RELEASE_NOTES.md and never appeared on the repo page. The Release
 * workflow (.github/workflows/release.yml) runs this on every `vX.Y.Z` tag
 * push, or when run by hand on main, and publishes what it prints, so the
 * notes are the ones reviewed in the PR that cut the release, not text
 * written at tag time.
 *
 * Exits 1 when the tag is not `vX.Y.Z`, when package.json's version is not
 * X.Y.Z, or when docs/RELEASE_NOTES.md has no non-empty `## Release vX.Y.Z`
 * section: each means the release was not cut, and publishing would ship a
 * Release with the wrong version or no notes.
 *
 * Usage:
 *   bun run release:notes -- v1.4.0   # notes to stdout, errors to stderr
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/u;
const REPO_URL = 'https://github.com/zz-plant/stims';

/**
 * The body of `## Release v<version> …`, up to the next `##` heading or the
 * `---` rule that separates releases. Null when the section is missing or
 * empty, so a heading with nothing under it cannot pass as notes.
 */
export function extractReleaseSection(
  markdown: string,
  version: string,
): string | null {
  const lines = markdown.split(/\r?\n/u);
  const heading = `## Release v${version}`;
  const start = lines.findIndex(
    (line) => line === heading || line.startsWith(`${heading} `),
  );
  if (start === -1) return null;

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ') || line.trim() === '---') break;
    body.push(line);
  }
  const text = body.join('\n').trim();
  return text.length > 0 ? text : null;
}

export type ReleaseNotesResult = { notes: string } | { error: string };

export function buildReleaseNotes({
  tag,
  packageVersion,
  releaseNotesMarkdown,
}: {
  tag: string;
  packageVersion: string;
  releaseNotesMarkdown: string;
}): ReleaseNotesResult {
  const match = TAG_PATTERN.exec(tag);
  if (!match) {
    return { error: `"${tag}" is not a vX.Y.Z release tag.` };
  }
  const version = match[1] as string;
  if (packageVersion !== version) {
    return {
      error: `package.json says ${packageVersion}, but the tag is ${tag}. Bump the version in the release PR, or tag the commit that did.`,
    };
  }
  const section = extractReleaseSection(releaseNotesMarkdown, version);
  if (!section) {
    return {
      error: `docs/RELEASE_NOTES.md has no "## Release v${version}" section with notes under it. Write it in the release PR before tagging.`,
    };
  }
  return {
    notes: `${section}\n\nFull changelog: ${REPO_URL}/blob/${tag}/CHANGELOG.md\n`,
  };
}

/** Reads package.json and docs/RELEASE_NOTES.md from `root` for `tag`. */
export function releaseNotesForTag(
  tag: string,
  root = process.cwd(),
): ReleaseNotesResult {
  const pkg = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { version?: string };
  return buildReleaseNotes({
    tag,
    packageVersion: pkg.version ?? '',
    releaseNotesMarkdown: readFileSync(
      path.join(root, 'docs/RELEASE_NOTES.md'),
      'utf8',
    ),
  });
}

if (import.meta.main) {
  const [tag = ''] = process.argv.slice(2).filter((arg) => arg !== '--');
  const result = releaseNotesForTag(tag);
  if ('error' in result) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(result.notes);
}
