/**
 * Categorize recent fix/revert commits by subsystem, so the "Why this exists"
 * numbers in the `review-*` skills can be re-derived instead of re-guessed.
 *
 * Those percentages set review priority — an agent reads "the #1 category" and
 * spends its attention there — so an undated, unreproducible number is worse
 * than none. The 2026-08-27 run found two claims had gone stale by a wide
 * margin: module-loading fixes had fallen from ~11% to 3%, and the fallback
 * chain from ~8% to two commits in 400, while deploy/tooling had climbed from
 * ~16% to 25% and overtaken workspace UI for second place.
 *
 * Method, and why it is this one: each commit is assigned exactly ONE category,
 * the one holding most of its changed files. Counting a commit once per
 * matching category sounds more thorough and is actively misleading — nearly
 * every fix ships with its own regression test, so `tests/` shows up in 50% of
 * fix commits by that method against 16% when the question is "is this commit
 * mostly a test change?". Subject-line keywords are not used at all: they
 * describe what the author was thinking about, not what the change touched.
 *
 * Usage:
 *   bun run audit:fix-categories -- [--limit 400] [--json]
 */
import { execFileSync } from 'node:child_process';

/** Ordered so the first match wins when a file could belong to two. */
const CATEGORIES: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: 'fallback chain',
    patterns: [
      /backend-fallback/,
      /renderer-capabilities/,
      /renderer-fallback/,
      /renderer-retry/,
    ],
  },
  {
    name: 'parity (render/shader)',
    patterns: [
      /^src\/js\/milkdrop\/feedback-manager/,
      /^src\/js\/milkdrop\/renderer-adapter/,
      /^src\/js\/milkdrop\/renderer-helpers\//,
      /^src\/js\/milkdrop\/compiler\//,
      /^src\/js\/milkdrop\/vm/,
    ],
  },
  {
    name: 'module loading / boot',
    patterns: [
      /^index\.html$/,
      /^src\/js\/core\/renderer-setup/,
      /^src\/js\/core\/toy-runtime/,
      /^src\/js\/core\/web-toy/,
    ],
  },
  {
    name: 'workspace UI / state',
    patterns: [/^src\/js\/frontend\//, /^src\/css\//],
  },
  { name: 'test harness', patterns: [/^tests\//] },
  {
    name: 'deploy / tooling',
    patterns: [/^scripts\//, /^\.github\//, /wrangler/, /^package\.json$/],
  },
  {
    name: 'docs / agent surface',
    patterns: [/^docs\//, /^\.agent\//, /^\.claude\//, /^AGENTS\.md$/],
  },
];

function arg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const limit = Number.parseInt(arg('--limit', '400'), 10);
const asJson = process.argv.includes('--json');

const log = execFileSync('git', ['log', `--format=%H%s`, `-${limit}`], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const counts = new Map<string, number>();
let fixCommits = 0;
let unclassified = 0;

for (const line of log) {
  const [hash, subject] = line.split('');
  if (!hash || !/^(fix|revert)/i.test(subject ?? '')) continue;
  fixCommits += 1;

  const files = execFileSync(
    'git',
    ['show', '--name-only', '--format=', '-1', hash],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);

  const share = new Map<string, number>();
  for (const file of files) {
    const category = CATEGORIES.find((candidate) =>
      candidate.patterns.some((pattern) => pattern.test(file)),
    );
    if (category) share.set(category.name, (share.get(category.name) ?? 0) + 1);
  }
  if (share.size === 0) {
    unclassified += 1;
    continue;
  }
  const dominant = [...share.entries()].sort((a, b) => b[1] - a[1])[0][0];
  counts.set(dominant, (counts.get(dominant) ?? 0) + 1);
}

const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        sampledCommits: limit,
        fixCommits,
        unclassified,
        categories: ranked.map(([name, n], index) => ({
          rank: index + 1,
          name,
          commits: n,
          share: Number(((100 * n) / fixCommits).toFixed(1)),
        })),
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `${fixCommits} fix/revert commits in the last ${limit} (${unclassified} unclassified)\n`,
  );
  console.log(
    `${'#'.padEnd(3)}${'category'.padEnd(26)}${'commits'.padStart(8)}${'share'.padStart(9)}`,
  );
  ranked.forEach(([name, n], index) => {
    const share = `${((100 * n) / fixCommits).toFixed(1)}%`;
    console.log(
      `${String(index + 1).padEnd(3)}${name.padEnd(26)}${String(n).padStart(8)}${share.padStart(9)}`,
    );
  });
  console.log(
    `\nRe-stamp the review-* skills you update with today's date and this sample size.`,
  );
}
