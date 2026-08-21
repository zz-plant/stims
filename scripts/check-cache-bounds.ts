/**
 * Detect new unbounded growth containers — the "map/set that only ever grows"
 * pattern the #1105–#1111 bounding series kept chasing (compiled-preset
 * warmup, preview caches, idle renderer pools, source-diff memory, offscreen
 * identicons all shipped unbounded and had to be bounded reactively).
 *
 * Diff-scoped, mirroring check-unused-exports.ts: only flags NEW runtime
 * `new Map(` / `new Set(` / `new WeakMap(` constructions added in the current
 * uncommitted change. A new container must share its file with an explicit
 * bound mechanism (a MAX_* / *_LIMIT / capacity / maxSize constant or an
 * evict/clear call) or the check flags it for review.
 *
 * Limitations (by design): a new unbounded container in a file that already
 * contains some other bound signal passes, and `Map`/`Set` used as pure types
 * are ignored. It is an advisory tripwire, not proof of boundedness — the
 * author either adds a bound or allowlists the container with a reason.
 *
 * Advisory by default; pass `--strict` to fail the gate. Run via
 * `bun run check:cache-bounds`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STRICT = process.argv.includes('--strict');

// Only application code is scanned; tooling keeps its own bounds.
const SCAN_PREFIX = 'src/';
const CONTAINER_RE = /\bnew\s+(?:Map|Set|WeakMap)\s*\(/;
// Bound evidence shared with the file that declares a new container.
const BOUND_RE = /MAX_[A-Z0-9_]+|_LIMIT\b|maxSize|capacity|evict\(|\.clear\(/i;
const COMMENT_START_RE = /^\s*(?:\/\/|\*|\/\*)/;

// Allowlist entries: `path: reason`. A container listed here is presumed
// bounded for a documented reason and never flagged.
const ALLOWED: Record<string, string> = {
  'src/js/milkdrop/compiler/eel-function-table.ts':
    'GPU_FIELD_FUNCTION_NAMES is derived once from the fixed, finite EEL_FUNCTIONS table at module load — it never grows at runtime.',
  'src/js/frontend/perform-pins.ts':
    'PINNABLE_BY_TARGET is a lookup index over the fixed PINNABLE_FIELDS literal, built once at module load — it is a table, not a cache.',
  'src/js/frontend/PerformSurface.tsx':
    'The only container is a Set derived inside a render/poll callback to de-duplicate the current modulator targets; it is rebuilt from scratch each time and never accumulates.',
  'src/js/milkdrop/compiler/shader-analysis-glsl.ts':
    'TEMPLATE_OWNED_TARGETS is a two-element literal fixed at module load, and declaredLocals is a per-call Set scoped to one shader program — both are bounded by the source they read, not by runtime accumulation.',
};

type DiffLine = { kind: 'file' | 'hunk' | 'added' | 'other'; text: string };

function parseDiff(output: string): DiffLine[] {
  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): DiffLine => {
      if (line.startsWith('+++')) {
        return { kind: 'file', text: line };
      }
      if (line.startsWith('@@')) {
        return { kind: 'hunk', text: line };
      }
      if (line.startsWith('+')) {
        return { kind: 'added', text: line.slice(1) };
      }
      return { kind: 'other', text: line };
    });
}

function getDiff(): DiffLine[] {
  let output = '';
  try {
    output = execSync('git diff --no-color --unified=0', { encoding: 'utf8' });
  } catch {}
  try {
    output +=
      '\n' +
      execSync('git diff --cached --no-color --unified=0', {
        encoding: 'utf8',
      });
  } catch {}
  return parseDiff(output);
}

function fileHasBoundEvidence(absPath: string): boolean {
  try {
    return BOUND_RE.test(readFileSync(absPath, 'utf8'));
  } catch {
    return false;
  }
}

const flags: string[] = [];
let currentFile: string | null = null;

for (const line of getDiff()) {
  if (line.kind === 'file') {
    const match = line.text.match(/^\+{3}\s+b\/(.+)$/);
    currentFile = match ? match[1].trim() : null;
    continue;
  }
  if (line.kind !== 'added' || currentFile === null) continue;
  if (!currentFile.startsWith(SCAN_PREFIX)) continue;
  if (!/\.(?:ts|tsx|js|jsx)$/.test(currentFile)) continue;
  if (COMMENT_START_RE.test(line.text)) continue;
  if (!CONTAINER_RE.test(line.text)) continue;

  if (ALLOWED[currentFile]) continue;

  const absPath = `${process.cwd()}/${currentFile}`;
  if (fileHasBoundEvidence(absPath)) continue;

  flags.push(
    `  ${currentFile}: ${line.text.trim()}\n` +
      `    New growth container without a bound in the same file. Add a ` +
      `MAX_* / *_LIMIT / capacity / maxSize constant with eviction, or an ` +
      `allowlist entry with a reason in scripts/check-cache-bounds.ts.`,
  );
}

if (flags.length === 0) {
  console.log('✔ No new unbounded growth containers in the current diff');
  process.exit(0);
}

console.error(
  `✖ ${flags.length} new growth container(s) without a visible bound:\n`,
);
for (const flag of flags) console.error(`${flag}\n`);
console.error(
  '  Bounding rule: every cache/pool gets a key, an eviction path, and a ' +
    'limit at write time — see the #1105–#1111 bounding series.',
);
if (STRICT) process.exit(1);
process.exit(0);
