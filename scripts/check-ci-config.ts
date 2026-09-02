/**
 * Guard against CI/build/config drift — the class of break that recurred
 * 14+ times in the last 400 commits: deleted workflows, npm→bun switches,
 * git hooks blocking deploys, build.mjs conflict markers, and scripts that
 * vanish while workflows still reference them.
 *
 * Checks:
 *  1. Every `bun run <script>` in workflow files resolves to a package.json
 *     script — catches deleted/renamed scripts before they break a deploy.
 *  2. `.bun-version` exists — workflows reference it via `bun-version-file`.
 *  3. No `npm `/`npx ` invocations in `.github/workflows/**` — the repo
 *     standardised on Bun; an npm command silently falls back to the npm
 *     registry and can re-introduce the hooks-in-CI and lockfile drift.
 *  4. No git conflict markers in build/config files — `build.mjs` shipped
 *     with `<<<<<<<` markers once (`5e4fb1df`).
 *  5. the lefthook config the postinstall hook installer expects exists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const errors: string[] = [];

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const pkg = JSON.parse(readText(join(ROOT, 'package.json'))) as {
  scripts?: Record<string, string>;
};

/* 1 + 3: workflow and action script references and npm leakage */
function getYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(
      (e) =>
        e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml')),
    )
    .map((e) =>
      join(
        e.parentPath || (e as unknown as { path: string }).path || dir,
        e.name,
      ),
    );
}

const yamlFiles = [
  ...getYamlFiles(join(ROOT, '.github/workflows')),
  ...getYamlFiles(join(ROOT, '.github/actions')),
];

const BUN_RUN = /\bbun run (?!--)([A-Za-z0-9:_-]+)/g;
const NPM_CMD = /(^|\s)(npm|npx) (?:run |ci |install |test )/;

for (const filePath of yamlFiles) {
  const relPath = filePath.replace(`${ROOT}/`, '');
  const text = readText(filePath);
  for (const match of text.matchAll(BUN_RUN)) {
    const script = match[1];
    if (!(script in (pkg.scripts ?? {}))) {
      errors.push(
        `${relPath}: references 'bun run ${script}' which is not a package.json script`,
      );
    }
  }
  if (NPM_CMD.test(text)) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (NPM_CMD.test(lines[i])) {
        errors.push(
          `${relPath}:${i + 1}: uses npm/npx instead of bun/bunx — ${lines[i].trim()}`,
        );
      }
    }
  }
}

/* 2: .bun-version */
if (!existsSync(join(ROOT, '.bun-version'))) {
  errors.push(
    '.bun-version is missing — GitHub Actions setup-bun uses bun-version-file',
  );
}

/* 4: conflict markers in build/config files */
const CONFLICT = /^(<{7}|={7}|>{7})(?: |$)/m;
const MARKER_FILES = [
  'scripts/build.mjs',
  'scripts/postinstall.mjs',
  'vite.config.js',
  'biome.json',
  'wrangler.site.jsonc',
  'wrangler.cron.jsonc',
  'wrangler.mcp.jsonc',
  'package.json',
];
for (const file of MARKER_FILES) {
  const text = readText(join(ROOT, file));
  if (CONFLICT.test(text)) {
    errors.push(
      `${file}: contains git conflict markers — resolve before committing`,
    );
  }
}

/* 5: lefthook config */
const postinstall = pkg.scripts?.postinstall ?? '';
if (
  (postinstall.includes('postinstall.mjs') ||
    postinstall.includes('lefthook')) &&
  !existsSync(join(ROOT, 'lefthook.yml'))
) {
  errors.push(
    'package.json postinstall installs lefthook hooks but lefthook.yml is missing',
  );
}

/*
 * 6: every test category reaches CI.
 *
 * `bun run check` only runs the `fast` profile, so for a long time nothing in
 * tests/corpus/ ran in CI at all — the parity certification corpus, the
 * compiler/codegen goldens and the pixel-diff suite were dead weight in the
 * build. That is invisible drift: the tests keep passing locally, so nobody
 * notices CI stopped looking at them. Assert the coverage instead of trusting
 * it, so dropping a category from CI has to be a deliberate edit here.
 */
const ciWorkflow = readText(join(ROOT, '.github/workflows/ci.yml'));
if (ciWorkflow) {
  const profileFor = (script: string) =>
    pkg.scripts?.[script]?.match(/--profile\s+([a-z]+)/)?.[1] ?? null;

  // Which npm scripts does ci.yml actually invoke?
  const invoked = new Set(
    [...ciWorkflow.matchAll(/\bbun run (?!--)([A-Za-z0-9:_-]+)/g)].map(
      (match) => match[1] as string,
    ),
  );

  // `check` runs the quality gate, which runs the `fast` profile.
  const coveredProfiles = new Set<string>();
  if (invoked.has('check')) coveredProfiles.add('fast');
  if (invoked.has('check:all')) coveredProfiles.add('all');
  for (const script of invoked) {
    const profile = profileFor(script);
    if (profile) coveredProfiles.add(profile);
  }

  // profile -> categories, mirroring PROFILES in scripts/run-tests.ts.
  const PROFILE_CATEGORIES: Record<string, string[]> = {
    all: ['unit', 'compat', 'corpus', 'e2e'],
    fast: ['unit', 'compat'],
    unit: ['unit'],
    compat: ['compat', 'corpus'],
    corpus: ['corpus'],
    e2e: ['e2e'],
  };

  const coveredCategories = new Set(
    [...coveredProfiles].flatMap(
      (profile) => PROFILE_CATEGORIES[profile] ?? [],
    ),
  );

  // e2e is covered by the integration matrix, which names files directly
  // rather than going through a profile.
  if (/tests\/e2e\//.test(ciWorkflow)) coveredCategories.add('e2e');

  for (const category of ['unit', 'compat', 'corpus', 'e2e']) {
    if (!coveredCategories.has(category)) {
      errors.push(
        `.github/workflows/ci.yml: no job runs the '${category}' test ` +
          `category — add a step invoking a profile that includes it ` +
          `(see PROFILES in scripts/run-tests.ts)`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`✖ CI config drift detected (${errors.length}):\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log('✔ CI config is consistent');
