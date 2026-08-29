/**
 * Makes a container's pre-installed Chromium usable by the pinned Playwright.
 *
 * Cloud agent containers ship a Chromium build under PLAYWRIGHT_BROWSERS_PATH
 * and forbid `playwright install`, but Playwright only looks for the exact
 * revision its own version pins. When the two disagree every browser tool
 * (`lab:visual`, `ui:diff`, `ctl`, `mcp`, e2e) dies with "Executable doesn't
 * exist", which reads like a broken repo rather than an environment mismatch.
 * This links the shipped build into the directory layout the pinned Playwright
 * expects. Use --check to report without writing.
 */
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SHIM_MARKER = '.stims-browser-shim';

type Target = {
  /** Playwright's directory prefix for this browser under the browsers root. */
  dirPrefix: string;
  /** Directory name Playwright expects inside the revision directory. */
  innerDir: string;
  /** Executable name Playwright expects inside that directory. */
  binary: string;
  /** Executable names older shipped builds use for the same browser. */
  sourceBinaries: string[];
};

type Resolution = {
  target: Target;
  expectedExecutable: string;
  /** Absolute path of the shipped build's payload directory, when one exists. */
  sourceInner?: string;
  sourceBinary?: string;
  sourceRevision?: string;
};

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isDirectory(candidate: string): boolean {
  try {
    return lstatSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Playwright's revision directories are the browser name with dashes swapped
 * for underscores (`chromium-headless-shell` -> `chromium_headless_shell-123`).
 */
const TARGETS: Target[] = [
  {
    dirPrefix: 'chromium',
    innerDir: 'chrome-linux64',
    binary: 'chrome',
    sourceBinaries: ['chrome'],
  },
  {
    dirPrefix: 'chromium_headless_shell',
    innerDir: 'chrome-headless-shell-linux64',
    binary: 'chrome-headless-shell',
    // Builds before the Chrome-for-Testing rename shipped `headless_shell`.
    sourceBinaries: ['chrome-headless-shell', 'headless_shell'],
  },
];

/**
 * Derives the layout Playwright expects from Playwright itself rather than
 * hardcoding a revision, so a dependency bump cannot silently invalidate this.
 */
async function resolveExpectedLayout(): Promise<{
  browsersRoot: string;
  revision: string;
}> {
  const { chromium } = await import('playwright');
  const executable = chromium.executablePath();
  const innerDir = path.dirname(executable);
  const revisionDir = path.dirname(innerDir);
  const browsersRoot = path.dirname(revisionDir);
  const revision = path.basename(revisionDir).split('-').pop() ?? '';

  if (!revision || !path.basename(innerDir).endsWith('linux64')) {
    fail(
      `unrecognised Playwright browser layout at ${executable}; this script only understands the Linux layout used by cloud containers.`,
    );
  }

  return { browsersRoot, revision };
}

/** Finds the newest shipped build of a browser that is not the pinned revision. */
function findShippedBuild(
  browsersRoot: string,
  target: Target,
  expectedRevision: string,
): Pick<Resolution, 'sourceInner' | 'sourceBinary' | 'sourceRevision'> {
  const pattern = new RegExp(`^${target.dirPrefix}-(\\d+)$`);
  const candidates = readdirSync(browsersRoot)
    .map((entry) => ({ entry, match: pattern.exec(entry) }))
    .flatMap(({ entry, match }) => (match ? [{ entry, rev: match[1] }] : []))
    .filter(({ rev }) => rev !== expectedRevision)
    .sort((a, b) => Number(b.rev) - Number(a.rev));

  for (const { entry, rev } of candidates) {
    const revisionDir = path.join(browsersRoot, entry);
    if (!isDirectory(revisionDir)) continue;

    for (const inner of readdirSync(revisionDir)) {
      const innerDir = path.join(revisionDir, inner);
      if (!/^chrome(-headless-shell)?-linux/.test(inner)) continue;
      if (!isDirectory(innerDir)) continue;

      const binary = target.sourceBinaries.find((name) =>
        existsSync(path.join(innerDir, name)),
      );
      if (binary) {
        return {
          sourceInner: innerDir,
          sourceBinary: binary,
          sourceRevision: rev,
        };
      }
    }
  }

  return {};
}

/**
 * Builds a real directory of symlinks rather than symlinking the revision
 * directory itself: the shipped payload keeps pre-rename directory and binary
 * names, and the source tree is never mutated.
 */
async function buildShim(resolution: Resolution): Promise<void> {
  const { target, expectedExecutable, sourceInner, sourceBinary } = resolution;
  if (!sourceInner || !sourceBinary) return;

  const innerDir = path.dirname(expectedExecutable);
  const revisionDir = path.dirname(innerDir);

  // Only ever remove a directory this script created.
  if (existsSync(revisionDir)) {
    if (!existsSync(path.join(revisionDir, SHIM_MARKER))) {
      fail(
        `${revisionDir} exists but was not created by this script; refusing to replace a real Playwright install.`,
      );
    }
    rmSync(revisionDir, { recursive: true, force: true });
  }

  await mkdir(innerDir, { recursive: true });

  for (const entry of readdirSync(sourceInner)) {
    await symlink(path.join(sourceInner, entry), path.join(innerDir, entry));
  }

  if (sourceBinary !== target.binary) {
    await symlink(
      path.join(sourceInner, sourceBinary),
      path.join(innerDir, target.binary),
    );
  }

  // Playwright treats a revision directory without this marker as a partial
  // download and refuses to use it.
  await writeFile(path.join(revisionDir, 'INSTALLATION_COMPLETE'), '');
  await writeFile(
    path.join(revisionDir, SHIM_MARKER),
    `${sourceInner}\n`,
    'utf8',
  );
}

const checkOnly = process.argv.includes('--check');

if (process.platform !== 'linux') {
  console.log(
    `Skipping browser linking: only the Linux container layout is supported (found ${process.platform}).`,
  );
  process.exit(0);
}

const { browsersRoot, revision } = await resolveExpectedLayout();

const resolutions: Resolution[] = TARGETS.map((target) => {
  const expectedExecutable = path.join(
    browsersRoot,
    `${target.dirPrefix}-${revision}`,
    target.innerDir,
    target.binary,
  );
  return {
    target,
    expectedExecutable,
    ...(existsSync(expectedExecutable)
      ? {}
      : findShippedBuild(browsersRoot, target, revision)),
  };
});

const missing = resolutions.filter(
  (resolution) => !existsSync(resolution.expectedExecutable),
);

if (missing.length === 0) {
  console.log(
    `Playwright browsers for revision ${revision} are present under ${browsersRoot}; nothing to link.`,
  );
  process.exit(0);
}

const linkable = missing.filter((resolution) => resolution.sourceInner);
const unlinkable = missing.filter((resolution) => !resolution.sourceInner);

for (const resolution of unlinkable) {
  console.warn(
    `Warning: no shipped build found for ${resolution.target.dirPrefix}; ${resolution.expectedExecutable} stays missing.`,
  );
}

if (linkable.length === 0) {
  console.log(
    `No pre-installed Chromium under ${browsersRoot} can stand in for revision ${revision}. Browser tooling is unavailable; text-only instruments (lab:reactivity, lab:nan-sweep) still work.`,
  );
  process.exit(0);
}

if (checkOnly) {
  for (const resolution of linkable) {
    console.log(
      `Would link ${resolution.target.dirPrefix}-${revision} -> shipped revision ${resolution.sourceRevision}.`,
    );
  }
  process.exit(0);
}

try {
  await mkdir(browsersRoot, { recursive: true });
  const probe = path.join(browsersRoot, `.stims-write-probe-${process.pid}`);
  await writeFile(probe, '');
  rmSync(probe, { force: true });
} catch (error) {
  fail(
    `${browsersRoot} is not writable (${(error as Error).message}), so the shipped Chromium cannot be linked into the layout Playwright expects. Point PLAYWRIGHT_BROWSERS_PATH at a writable directory, or run browser tooling on a host with a matching Playwright install.`,
  );
}

for (const resolution of linkable) {
  await buildShim(resolution);
  console.log(
    `Linked ${resolution.target.dirPrefix}-${revision} -> shipped revision ${resolution.sourceRevision} (${resolution.sourceInner}).`,
  );
}

const stillMissing = resolutions.filter(
  (resolution) => !existsSync(resolution.expectedExecutable),
);

if (stillMissing.length > 0) {
  console.warn(
    'Warning: some browsers are still missing; run bun run doctor to see which tooling that leaves available.',
  );
} else {
  console.log(
    'Playwright can now launch the pre-installed Chromium. Note the build differs from the one this Playwright pins — treat unexplained protocol errors as version skew, not repo breakage.',
  );
}
