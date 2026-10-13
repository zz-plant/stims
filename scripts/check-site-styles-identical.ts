/**
 * Fails when the package sites' shared stylesheet diverges.
 *
 * packages/README.md promises the four site/ directories "share one stylesheet
 * (site/styles.css, kept identical in each package)". Identical by hand is how
 * copies drift: a fix lands in one package's copy and the other three keep the
 * old rule until someone notices the sites look different. This compares the
 * copies byte for byte, so the promise is enforced instead of remembered.
 *
 *   bun run check:site-styles-identical
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/**
 * The divergence in a map of stylesheet copies. Up to one copy everything is
 * trivially identical; with more, the alphabetically first copy is the
 * reference and every other differing copy is named. Deterministic order so
 * two runs of the same state print the same thing.
 */
export function findStyleDivergence(styles: Record<string, string>): string[] {
  const paths = Object.keys(styles).sort();
  if (paths.length <= 1) return [];
  const referencePath = paths[0];
  const reference = styles[referencePath];
  const errors: string[] = [];
  for (const path of paths.slice(1)) {
    if (styles[path] !== reference) {
      errors.push(
        `${path} differs from ${referencePath} ` +
          `(${Buffer.byteLength(styles[path], 'utf8')} vs ` +
          `${Buffer.byteLength(reference, 'utf8')} bytes) — the package sites ` +
          `share one stylesheet; copy ${referencePath} over it or split them ` +
          `on purpose`,
      );
    }
  }
  return errors;
}

async function main() {
  const styles: Record<string, string> = {};
  const missing: string[] = [];
  let sites = 0;
  try {
    for (const entry of readdirSync(join(ROOT, 'packages'), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const siteDir = join(ROOT, 'packages', entry.name, 'site');
      if (!statSync(siteDir, { throwIfNoEntry: false })?.isDirectory()) {
        continue;
      }
      sites += 1;
      const stylesheet = join(siteDir, 'styles.css');
      if (!existsSync(stylesheet)) {
        missing.push(`packages/${entry.name}/site/styles.css`);
        continue;
      }
      styles[`packages/${entry.name}/site/styles.css`] = readFileSync(
        stylesheet,
        'utf8',
      );
    }
  } catch {
    // No packages directory: nothing to compare.
  }

  const errors = [
    ...missing.map(
      (path) =>
        `${path} is missing — a package site without the shared stylesheet`,
    ),
    ...findStyleDivergence(styles),
  ];
  if (errors.length > 0) {
    console.error(`✖ package site stylesheets diverged (${errors.length}):\n`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(
    `✔ ${sites} package site${sites === 1 ? '' : 's'} share one stylesheet`,
  );
}

if (import.meta.main) {
  await main();
}
