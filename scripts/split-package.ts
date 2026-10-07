/**
 * Split one package under packages/ into a branch whose history holds only that directory, for its mirror repository.
 *
 * `git subtree split` does this by walking every commit on main (3,585 of
 * them, about five minutes per package) to find the handful that touched
 * the directory. This asks git for exactly those commits on main's
 * first-parent line and rewrites each with the package directory as its
 * root tree, copying the author, committer and message byte for byte. The
 * result is deterministic: running it again later, locally or in CI,
 * reproduces the same commit ids and appends only the new ones, so a push to
 * the mirror is always a fast-forward.
 *
 * Writes the branch `split/<name>` and prints its head.
 *
 *   bun run packages:split -- flash-guard
 *   bun run packages:split -- flash-guard --ref origin/main
 */
import { existsSync } from 'node:fs';

function git(args: string[], input?: string): string {
  const result = Bun.spawnSync(['git', ...args], {
    stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

function tryGit(args: string[]): string | null {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

/**
 * The commit object for `sha` with its tree swapped for `tree` and its
 * parents for `parent`. Only the author, committer and encoding headers are
 * kept: a signature would no longer verify against the new content, and the
 * mirror has no use for mergetags.
 */
function rewriteCommit(sha: string, tree: string, parent: string | null) {
  const raw = git(['cat-file', 'commit', sha]);
  const split = raw.indexOf('\n\n');
  const headerBlock = split === -1 ? raw : raw.slice(0, split);
  const message = split === -1 ? '' : raw.slice(split + 2);
  const kept = headerBlock
    .split('\n')
    .filter((line) => /^(author|committer|encoding) /.test(line));
  const lines = [`tree ${tree}`];
  if (parent) lines.push(`parent ${parent}`);
  lines.push(...kept);
  return `${lines.join('\n')}\n\n${message}`;
}

function main() {
  const args = process.argv.slice(2);
  const name = args.find((arg) => !arg.startsWith('--'));
  const refIndex = args.indexOf('--ref');
  const ref = refIndex >= 0 ? (args[refIndex + 1] ?? 'HEAD') : 'HEAD';
  if (!name || !existsSync(`packages/${name}/package.json`)) {
    console.error('usage: bun run packages:split -- <package> [--ref <ref>]');
    process.exit(1);
  }
  const prefix = `packages/${name}`;
  const commits = git([
    'rev-list',
    '--reverse',
    '--first-parent',
    ref,
    '--',
    prefix,
  ])
    .split('\n')
    .filter(Boolean);

  let head: string | null = null;
  let lastTree: string | null = null;
  let written = 0;
  for (const sha of commits) {
    const tree = tryGit(['rev-parse', `${sha}:${prefix}`]);
    // The directory is absent (deleted) or unchanged on this commit.
    if (!tree || tree === lastTree) continue;
    head = git(
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      rewriteCommit(sha, tree, head),
    ).trim();
    lastTree = tree;
    written += 1;
  }
  if (!head) {
    console.error(`no commits on ${ref} touch ${prefix}`);
    process.exit(1);
  }
  git(['update-ref', `refs/heads/split/${name}`, head]);
  console.log(`split/${name} ${head} (${written} commits)`);
}

main();
