/**
 * Guard against docs that point at files and commands which no longer exist.
 *
 * `check-stale-paths.ts` catches one specific migration (`assets/` → `src/`).
 * This guard is the general case: a doc that names `tests/foo.test.ts` after
 * the file moved to `tests/unit/`, or tells an agent to run
 * `bun run test:legacy-frontend` after that script was deleted, sends the
 * reader somewhere that does not exist. Agents follow the routing tables in
 * `.claude/CLAUDE.md` and `.github/AGENTS.md` literally, so a dangling
 * reference costs a failed command and a wrong mental model of the tree.
 *
 * Two reference kinds are checked:
 *   - repo paths (`src/…`, `tests/…`, `scripts/…`, …) in backticks or links
 *   - `bun run <script>` invocations, checked against package.json
 *
 * Exemptions, all deliberate:
 *   - historical records (audits, critiques, dated status docs, `docs/archive`,
 *     `docs/evidence`) describe a tree as it was; rewriting them would
 *     misrepresent the record
 *   - glob-ish references (`renderer-adapter*.ts`, `compiler/**`) — only the
 *     literal directory prefix is verified
 *   - documented placeholders (`tests/path/to/spec.test.ts`) and proposal docs
 *     that name files a plan would create (marked `(NEW)` or "New follow-up")
 *   - generated docs (`docs/GUARDRAILS.md`), whose prose is copied verbatim
 *     from guard docblocks. Those docblocks cite illustrative non-existent
 *     paths on purpose — `check-doc-references.ts` itself names
 *     `tests/foo.test.ts` to explain what it catches. The references are
 *     already verified where they are authored, in `scripts/`, so checking the
 *     copy would force the explanations to be written worse.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['docs', '.agent'];
const EXTRA_FILES = [
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  '.github/AGENTS.md',
];
/**
 * Docs generated from source that is itself checked. See the docblock above for
 * why the copy is exempt while the original is not.
 */
const GENERATED_DOCS = new Set(['docs/GUARDRAILS.md']);

const SKIP_DIRS = new Set([
  'archive',
  'evidence',
  'node_modules',
  '.git',
  'dist',
  'screenshots',
]);

/** Point-in-time findings rather than live instruction. */
const HISTORICAL_RECORD =
  /(AUDIT|CRITIQUE|ANTI_PATTERNS|RESEARCH|_REPORT_|assessment|STATUS_|critiques)/i;

/** Placeholders that stand in for "whatever file you are working on". */
const PLACEHOLDER = /path\/to|your-file|YYYY-MM|<[a-z-]+>/;

/**
 * A path named at a historical commit — `git show <sha>:src/js/…` — is
 * deliberately about a file that no longer exists. Recovering deleted code is
 * the whole point of writing one down, so requiring it to resolve against the
 * working tree would force docs to drop exactly the pointer that makes a
 * removal recoverable.
 */
const HISTORICAL_PATH = /\b[0-9a-f]{7,40}:$/;

const PATH_PREFIX =
  '(?:src|tests|scripts|docs|\\.agent|\\.github|functions|public)';
/**
 * Matches a path after a link target, a backtick, or plain whitespace. The
 * whitespace case matters: `bun run test tests/foo.test.ts` puts the path
 * inside a code span but not at its start, and prose names files bare.
 */
const PATH_RE = new RegExp(
  `(?:\\]\\(\\.{0,2}\\/?|[\`\\s(])(${PATH_PREFIX}\\/[A-Za-z0-9_\\-./*]*[A-Za-z0-9_\\-*])`,
  'g',
);
const COMMAND_RE = /bun run ([a-z0-9:-]+)/g;

const scripts = new Set(
  Object.keys(
    JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >,
  ),
);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (full.endsWith('.md')) out.push(full);
  }
  return out;
}

/** A glob resolves if its literal prefix directory exists. */
function referenceResolves(ref: string): boolean {
  if (!ref.includes('*')) return existsSync(ref);
  const prefix = ref.slice(0, ref.indexOf('*'));
  const dir = prefix.slice(0, prefix.lastIndexOf('/'));
  return dir.length > 0 && existsSync(dir);
}

const offenders: Array<{ file: string; line: number; problem: string }> = [];

for (const file of [...ROOTS.flatMap((root) => walk(root)), ...EXTRA_FILES]) {
  const name = file.split('/').pop() ?? '';
  if (HISTORICAL_RECORD.test(name)) continue;
  if (GENERATED_DOCS.has(file.replaceAll('\\', '/'))) continue;

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  text.split('\n').forEach((line, index) => {
    // Proposal docs legitimately name files the plan would create.
    if (/\(NEW\)|New follow-up/.test(line)) return;

    for (const match of line.matchAll(PATH_RE)) {
      const ref = match[1];
      if (PLACEHOLDER.test(ref) || referenceResolves(ref)) continue;
      // What precedes the path decides whether it is a live reference.
      const before =
        line.slice(0, match.index ?? 0) + match[0].slice(0, -ref.length);
      if (HISTORICAL_PATH.test(before)) continue;
      offenders.push({ file, line: index + 1, problem: `missing path ${ref}` });
    }
    for (const match of line.matchAll(COMMAND_RE)) {
      if (scripts.has(match[1])) continue;
      offenders.push({
        file,
        line: index + 1,
        problem: `unknown script bun run ${match[1]}`,
      });
    }
  });
}

if (offenders.length > 0) {
  console.error(
    `Found ${offenders.length} dangling reference(s) in agent-facing docs.\n` +
      'Point them at the current file or script, or delete the claim.\n',
  );
  for (const offender of offenders) {
    console.error(`  ${offender.file}:${offender.line} — ${offender.problem}`);
  }
  process.exit(1);
}

console.log('✔ doc references resolve to real paths and scripts');
