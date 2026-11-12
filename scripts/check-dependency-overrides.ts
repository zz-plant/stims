/**
 * Fails when `overrides` pins a package that `dependencies` or `devDependencies` also declares, at a different version.
 *
 * The overrides hold every copy of a package in the tree at one version: the
 * @codemirror packages share one @codemirror/state, whose instanceof checks
 * break with two copies, and zod carries a security floor (#1549). For a
 * package the root also declares, that version is the declared one. Overrides
 * win over the declaration, and Dependabot edits only the declaration, so a
 * bump that leaves the override behind installs the old version while
 * package.json names the new one. #1426 and #1557 did that to three
 * @codemirror packages, and the next Dependabot run failed with
 * `NoChangeError: No files were updated!`: it read the stale lockfile as
 * current and asked for the version package.json already named (#1732 raised
 * the overrides). #1272 and #1276 drifted the same way before #1281, and the
 * zod bump in #1604 needed its override moved by hand.
 *
 * The rule: an override of a declared package is the declared string exactly,
 * or `$<name>`, npm's reference to the declared version, which bun resolves at
 * install. A range the declared version satisfies is not enough: with 6.5.0
 * locked, declaring 6.5.2 under an override of `^6.5.0` leaves bun 1.4 at
 * 6.5.0, because the lock still matches the override. `resolutions` is read
 * too, since bun treats it as `overrides`. A package only the tree pulls in
 * (undici, nanoid) has no declaration to agree with and is not checked.
 *
 * In the quality gate, so a Dependabot pull request that moves a declaration
 * without its override fails CI and says which line to change.
 *
 *   bun run check:dependency-overrides [path/to/package.json]
 */
import { readFileSync } from 'node:fs';

/** The manifest to read; the unit test passes a fixture instead. */
const MANIFEST =
  process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? 'package.json';

type Specs = Record<string, unknown>;
type Manifest = {
  dependencies?: Specs;
  devDependencies?: Specs;
  overrides?: Specs;
  resolutions?: Specs;
};

const DECLARING_FIELDS = ['dependencies', 'devDependencies'] as const;
const OVERRIDING_FIELDS = ['overrides', 'resolutions'] as const;

/** An override's own version: the string, or npm's `"."` key of a nested one. */
function overrideSpec(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const self = (value as Specs)['.'];
    if (typeof self === 'string') return self.trim();
  }
  return null;
}

function declaredSpec(manifest: Manifest, name: string): string | null {
  for (const field of DECLARING_FIELDS) {
    const spec = manifest[field]?.[name];
    if (typeof spec === 'string') return spec.trim();
  }
  return null;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
const errors: string[] = [];
let agreeing = 0;

for (const overrideField of OVERRIDING_FIELDS) {
  for (const [name, value] of Object.entries(manifest[overrideField] ?? {})) {
    const pinned = overrideSpec(value);
    if (pinned === null) continue;
    for (const field of DECLARING_FIELDS) {
      const raw = manifest[field]?.[name];
      if (typeof raw !== 'string') continue;
      const declared = raw.trim();
      const fix = `fix: set "${name}": "${declared}" in ${overrideField}, then run \`bun install\``;

      let effective = pinned;
      if (pinned.startsWith('$')) {
        const target = pinned.slice(1);
        const referenced =
          target === name ? declared : declaredSpec(manifest, target);
        if (referenced === null) {
          errors.push(
            `${name}: ${overrideField} says ${pinned}, but no dependency is named ${target}.\n    ${fix}`,
          );
          continue;
        }
        effective = referenced;
      }

      if (effective === declared) {
        agreeing += 1;
        continue;
      }
      errors.push(
        `${name}: ${field} says ${declared}, ${overrideField} says ${pinned}; ` +
          `the override wins, so bun installs what ${overrideField} says.\n    ${fix}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(
    `✖ ${MANIFEST}: overrides disagree with the declared versions (${errors.length}):\n`,
  );
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `✔ ${MANIFEST}: ${agreeing} override${agreeing === 1 ? '' : 's'} of declared packages match their declarations`,
);
