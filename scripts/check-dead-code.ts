/**
 * Report unused files, exports, and dependencies across the whole tree with
 * knip (config: knip.jsonc).
 *
 * The diff-scoped `check:unused-exports` guard only sees exports a change
 * adds; this is the whole-repo view — files nothing imports, dependencies
 * nothing requires, binaries nothing declares. Unused files and dependency
 * findings exit non-zero; unused exports and types are reported as warnings
 * (the codebase exports test seams and public-surface barrels on purpose),
 * so treat that section as a review aid rather than a gate.
 *
 *   bun run check:dead-code            # full report
 *   bun run check:dead-code -- --fix   # let knip delete unused exports/files
 */

export {};

const args = process.argv.slice(2);
const proc = Bun.spawn(
  ['bunx', 'knip', '--no-progress', '--reporter', 'compact', ...args],
  { stdio: ['inherit', 'inherit', 'inherit'] },
);
process.exit(await proc.exited);
