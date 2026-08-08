/**
 * Bound the parity capture directory.
 *
 * Captures are regenerable (scripts/capture-*.ts), but the manifest appended
 * every run without ever pruning, so screenshots/parity/ grew to 566 tracked
 * files / 174MB before it was untracked. This trims each
 * (kind, slug, preset) group to its newest N captures and deletes the
 * superseded files.
 *
 * Reports only by default; pass --apply to actually delete.
 *
 *   bun run parity:prune                 # report
 *   bun run parity:prune -- --apply      # delete
 *   bun run parity:prune -- --keep 1 --apply
 */
import path from 'node:path';
import {
  DEFAULT_KEEP_PER_PRESET,
  loadParityArtifactManifest,
  pruneParityArtifacts,
  readProtectedCapturePaths,
  reconcileParityArtifactManifest,
  saveParityArtifactManifest,
} from './parity-artifacts.ts';

function readFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const argv = process.argv.slice(2);
const apply = readFlag(argv, '--apply');
const outputDir = readArg(argv, '--dir', 'screenshots/parity');
const keepPerPreset = Number.parseInt(
  readArg(argv, '--keep', String(DEFAULT_KEEP_PER_PRESET)),
  10,
);

const loaded = loadParityArtifactManifest(outputDir);
const { manifest: reconciled, dropped } = reconcileParityArtifactManifest(
  outputDir,
  loaded,
);
const protectedFiles = readProtectedCapturePaths();
const { manifest, pruned, removedFiles } = pruneParityArtifacts(
  outputDir,
  reconciled,
  { keepPerPreset, dryRun: !apply, keepFiles: protectedFiles },
);

// Guard the invariant rather than trusting it: cited evidence must survive.
const violations = removedFiles.filter((file) =>
  protectedFiles.has(path.resolve(file)),
);
if (violations.length > 0) {
  console.error(
    `✖ refusing to prune: ${violations.length} file(s) are cited as evidence`,
  );
  for (const file of violations) {
    console.error(`   ${file}`);
  }
  process.exit(1);
}

console.log(`Parity artifacts in ${outputDir}`);
console.log(
  `  manifest entries : ${loaded.artifacts.length} → ${manifest.artifacts.length}`,
);
console.log(`  dangling dropped : ${dropped.length}`);
console.log(
  `  over retention   : ${pruned.length} (keeping ${keepPerPreset} per preset)`,
);
console.log(
  `  protected        : ${protectedFiles.size} cited capture(s), never pruned`,
);
console.log(
  `  files ${apply ? 'deleted' : 'that would be deleted'} : ${removedFiles.length}`,
);

if (apply) {
  saveParityArtifactManifest(outputDir, manifest);
  console.log('✔ pruned and manifest rewritten');
} else if (removedFiles.length > 0) {
  console.log('\nRe-run with --apply to delete.');
}
