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
 * `--check` audits CHANGELOG.md against docs/RELEASE_NOTES.md instead: the
 * same releases with the same dates, newest first, each with a link
 * reference; the "Latest release" line and package.json naming the newest;
 * and each release's `###` headings drawn once, in order, from a fixed list.
 * The two files drifted apart for months before this existed (two post-1.5.0
 * changes filed under 1.5.0, a 1.5.0 section with two `### Fixed` headings),
 * and tests/unit/release-notes.test.ts runs the audit in the gate.
 *
 * Usage:
 *   bun run release:notes -- v1.4.0   # notes to stdout, errors to stderr
 *   bun run release:notes -- --check  # list drift between the two files
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/u;
const REPO_URL = 'https://github.com/zz-plant/stims';

/** Keep a Changelog's change types, in the order a CHANGELOG.md release lists them. */
export const CHANGE_TYPES = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
] as const;

/** A RELEASE_NOTES.md release's headings, in order; only the first is required. */
export const NOTE_HEADINGS = [
  '🌟 Release Highlights',
  '⚡ Engineering & Performance',
  '🐛 Bug Fixes',
] as const;

const CHANGELOG_RELEASE = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/u;
const NOTES_RELEASE = /^## Release v(\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/u;
const LATEST_RELEASE = /Latest release: \*\*v(\d+\.\d+\.\d+)\*\*/u;
const LINK_REFERENCE = /^\[(Unreleased|\d+\.\d+\.\d+)\]: https:\/\/\S+$/u;

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

type LevelTwoSection = { heading: string; line: number; subheadings: string[] };

function levelTwoSections(markdown: string): LevelTwoSection[] {
  const sections: LevelTwoSection[] = [];
  markdown.split(/\r?\n/u).forEach((line, index) => {
    if (line.startsWith('## ')) {
      sections.push({ heading: line, line: index + 1, subheadings: [] });
    } else if (line.startsWith('### ')) {
      sections.at(-1)?.subheadings.push(line.slice(4).trim());
    }
  });
  return sections;
}

function headingProblems(
  where: string,
  headings: string[],
  allowed: readonly string[],
): string[] {
  const problems: string[] = [];
  let lastRank = -1;
  for (const heading of headings) {
    const rank = allowed.indexOf(heading);
    if (rank === -1) {
      problems.push(
        `${where}: "### ${heading}" is not one of ${allowed.join(', ')}.`,
      );
    } else if (rank <= lastRank) {
      problems.push(
        `${where}: "### ${heading}" is repeated or out of order (${allowed.join(' → ')}).`,
      );
    } else {
      lastRank = rank;
    }
  }
  return problems;
}

function compareVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) =>
    version.split('.').map(Number),
  ) as [number[], number[]];
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

type DatedRelease = { version: string; date: string };

/**
 * Every way CHANGELOG.md and docs/RELEASE_NOTES.md disagree with each other,
 * with package.json, or with their own heading rules. Empty when they agree.
 */
export function auditReleaseRecords({
  changelog,
  releaseNotes,
  packageVersion,
}: {
  changelog: string;
  releaseNotes: string;
  packageVersion: string;
}): string[] {
  const problems: string[] = [];

  const changelogReleases: DatedRelease[] = [];
  const changelogSections = levelTwoSections(changelog);
  changelogSections.forEach((section, index) => {
    const where = `CHANGELOG.md line ${section.line}`;
    if (index === 0 && section.heading === '## [Unreleased]') {
      problems.push(
        ...headingProblems(where, section.subheadings, CHANGE_TYPES),
      );
      return;
    }
    const match = CHANGELOG_RELEASE.exec(section.heading);
    if (!match) {
      problems.push(
        index === 0
          ? `${where}: the first section must be "## [Unreleased]".`
          : `${where}: "${section.heading}" is not "## [X.Y.Z] - YYYY-MM-DD".`,
      );
      return;
    }
    changelogReleases.push({
      version: match[1],
      date: match[2],
    } as DatedRelease);
    problems.push(...headingProblems(where, section.subheadings, CHANGE_TYPES));
  });

  for (let index = 1; index < changelogReleases.length; index += 1) {
    const newer = changelogReleases[index - 1] as DatedRelease;
    const older = changelogReleases[index] as DatedRelease;
    if (compareVersions(newer.version, older.version) <= 0) {
      problems.push(
        `CHANGELOG.md: ${newer.version} is listed above ${older.version}; releases go newest first.`,
      );
    }
    if (newer.date < older.date) {
      problems.push(
        `CHANGELOG.md: ${newer.version} (${newer.date}) is dated before ${older.version} (${older.date}).`,
      );
    }
  }

  const latest = changelogReleases[0]?.version;
  const latestLine = LATEST_RELEASE.exec(changelog)?.[1];
  if (latestLine !== latest) {
    problems.push(
      `CHANGELOG.md: the "Latest release" line says ${latestLine ?? 'nothing'}, but the newest section is ${latest ?? 'missing'}.`,
    );
  }
  if (latest && packageVersion !== latest) {
    problems.push(
      `package.json says ${packageVersion}, but CHANGELOG.md's newest release is ${latest}.`,
    );
  }

  const linked = new Set(
    changelog
      .split(/\r?\n/u)
      .map((line) => LINK_REFERENCE.exec(line)?.[1])
      .filter((label): label is string => label !== undefined),
  );
  for (const label of [
    'Unreleased',
    ...changelogReleases.map(({ version }) => version),
  ]) {
    if (!linked.has(label)) {
      problems.push(`CHANGELOG.md: [${label}] has no link reference.`);
    }
  }

  const noteReleases: DatedRelease[] = [];
  for (const section of levelTwoSections(releaseNotes)) {
    const where = `docs/RELEASE_NOTES.md line ${section.line}`;
    const match = NOTES_RELEASE.exec(section.heading);
    if (!match) {
      problems.push(
        `${where}: "${section.heading}" is not "## Release vX.Y.Z (YYYY-MM-DD)".`,
      );
      continue;
    }
    noteReleases.push({ version: match[1], date: match[2] } as DatedRelease);
    problems.push(
      ...headingProblems(where, section.subheadings, NOTE_HEADINGS),
    );
    if (section.subheadings[0] !== NOTE_HEADINGS[0]) {
      problems.push(`${where}: v${match[1]} has no "### ${NOTE_HEADINGS[0]}".`);
    }
  }

  const listed = (releases: DatedRelease[]) =>
    releases.map(({ version, date }) => `${version} (${date})`).join(', ');
  if (listed(changelogReleases) !== listed(noteReleases)) {
    problems.push(
      `CHANGELOG.md lists ${listed(changelogReleases)}; docs/RELEASE_NOTES.md lists ${listed(noteReleases)}. Each release needs both, with the same date, in the same order.`,
    );
  }

  return problems;
}

function readRoot(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

/** Audits the release records checked in under `root`. */
export function auditReleaseRecordsAt(root = process.cwd()): string[] {
  const pkg = JSON.parse(readRoot(root, 'package.json')) as {
    version?: string;
  };
  return auditReleaseRecords({
    changelog: readRoot(root, 'CHANGELOG.md'),
    releaseNotes: readRoot(root, 'docs/RELEASE_NOTES.md'),
    packageVersion: pkg.version ?? '',
  });
}

/** Reads package.json and docs/RELEASE_NOTES.md from `root` for `tag`. */
export function releaseNotesForTag(
  tag: string,
  root = process.cwd(),
): ReleaseNotesResult {
  const pkg = JSON.parse(readRoot(root, 'package.json')) as {
    version?: string;
  };
  return buildReleaseNotes({
    tag,
    packageVersion: pkg.version ?? '',
    releaseNotesMarkdown: readRoot(root, 'docs/RELEASE_NOTES.md'),
  });
}

if (import.meta.main) {
  const [tag = ''] = process.argv.slice(2).filter((arg) => arg !== '--');
  if (tag === '--check') {
    const problems = auditReleaseRecordsAt();
    for (const problem of problems) console.error(problem);
    process.exit(problems.length > 0 ? 1 : 0);
  }
  const result = releaseNotesForTag(tag);
  if ('error' in result) {
    console.error(result.error);
    process.exit(1);
  }
  process.stdout.write(result.notes);
}
