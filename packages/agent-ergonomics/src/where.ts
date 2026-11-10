/**
 * `where <symbol>`: where a name is declared, which functions use it, and
 * which tests touch it, in one answer.
 *
 * Nearly every code search is asking one of those three questions, and
 * answering by hand takes a search and then a window around each hit to see
 * what the hit sits inside. This does the search with `git grep`, parses each
 * file that matched with the `outline` parser, and reports every hit by the
 * declaration that contains it. The declarations come back with line ranges,
 * so the next step is one read of exactly those lines.
 *
 * The match is on the whole word and is textual: it is not scope-aware, so
 * two unrelated things with one name are reported together. Tracked and
 * untracked files are searched; ignored ones are not.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from './context.ts';
import {
  OUTLINE_EXTENSIONS,
  type OutlineEntry,
  outlineSource,
} from './outline.ts';

export type SymbolDefinition = {
  file: string;
  /** First and last line of the declaration, 1-based and inclusive. */
  start: number;
  end: number;
  label: string;
  /** Names of the declarations this one sits inside, outermost first. */
  within: string[];
};

export type SymbolFile = {
  file: string;
  test: boolean;
  /** Each line that uses the name, with the declaration it sits inside. */
  uses: Array<{ line: number; within: string | null }>;
};

export type SymbolReport = {
  symbol: string;
  definitions: SymbolDefinition[];
  /** Files that use the name: source first, then tests, most uses first. */
  files: SymbolFile[];
  /** Files that matched but did not parse; their uses carry no enclosing declaration. */
  unparsed: string[];
};

const TEST_FILE =
  /(?:^|\/)(?:tests?|__tests__|e2e|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** A name common enough to match more files than this is not worth parsing them all for. */
const PARSE_LIMIT = 400;

const NOT_A_DEFINITION = new Set(['imports', 'exports', 'test', 'block']);

/**
 * Nested declarations of these kinds are not reported as what a use sits in:
 * "used in `const ok = check(x)`" says less than the function around it.
 */
const TOO_SMALL_TO_NAME = new Set(['variable', 'property', 'member']);

type Scope = { entry: OutlineEntry; chain: string[] };

function flatten(entries: OutlineEntry[], chain: string[], out: Scope[]) {
  for (const entry of entries) {
    out.push({ entry, chain });
    flatten(entry.children, entry.name ? [...chain, entry.name] : chain, out);
  }
  return out;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** What a use sits inside, as a reader would name it. */
function scopeName({ kind, name, label }: OutlineEntry): string {
  if (kind === 'imports') return 'import';
  if (kind === 'exports') return 're-export';
  if (kind === 'test') return name === label ? name : `"${clip(name, 48)}"`;
  if (kind === 'block') return name ? `${name}()` : 'return';
  return name;
}

/** Finds every whole-word occurrence of a name and sorts it into declarations and uses. */
export async function findSymbol(
  symbol: string,
  { cwd, paths = [] }: { cwd: string; paths?: string[] },
): Promise<SymbolReport> {
  const grep = spawnSync(
    'git',
    [
      'grep',
      '-n',
      '-w',
      '-F',
      '-I',
      '-z',
      '--untracked',
      '--no-color',
      '-e',
      symbol,
      '--',
      ...OUTLINE_EXTENSIONS.map((ext) => `*.${ext}`),
    ],
    { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  // git grep exits 1 for "no match", which is an answer rather than a failure.
  if (grep.status !== 0 && grep.status !== 1) {
    const reason = (grep.stderr || grep.error?.message || '').trim();
    throw new Error(`git grep failed: ${reason || `exit ${grep.status}`}`);
  }

  const prefixes = paths.map((path) => path.replace(/^\.\//u, ''));
  const hits = new Map<string, Set<number>>();
  for (const record of (grep.stdout ?? '').split('\n')) {
    const [file, line] = record.split('\0');
    if (!file || !line) continue;
    if (
      prefixes.length > 0 &&
      !prefixes.some((prefix) => file.startsWith(prefix))
    ) {
      continue;
    }
    const lines = hits.get(file) ?? new Set<number>();
    lines.add(Number(line));
    hits.set(file, lines);
  }

  const definitions: SymbolDefinition[] = [];
  const files: SymbolFile[] = [];
  const unparsed: string[] = [];
  for (const [index, [file, lines]] of [...hits].entries()) {
    let scopes: Scope[] = [];
    if (index < PARSE_LIMIT) {
      try {
        const outline = await outlineSource(
          readFileSync(join(cwd, file), 'utf8'),
          file,
        );
        scopes = flatten(outline.entries, [], []);
      } catch {
        unparsed.push(file);
      }
    } else {
      unparsed.push(file);
    }

    const declared = new Set<number>();
    for (const { entry, chain } of scopes) {
      if (entry.name !== symbol || NOT_A_DEFINITION.has(entry.kind)) continue;
      declared.add(entry.start);
      definitions.push({
        file,
        start: entry.start,
        end: entry.end,
        label: entry.label,
        within: chain,
      });
    }

    const uses: SymbolFile['uses'] = [];
    for (const line of [...lines].sort((a, b) => a - b)) {
      if (declared.has(line)) continue;
      // The innermost declaration around the line.
      let best: OutlineEntry | null = null;
      for (const { entry, chain } of scopes) {
        if (line < entry.start || line > entry.end) continue;
        if (chain.length > 0 && TOO_SMALL_TO_NAME.has(entry.kind)) continue;
        if (!best || entry.end - entry.start <= best.end - best.start) {
          best = entry;
        }
      }
      uses.push({ line, within: best ? scopeName(best) : null });
    }
    if (uses.length > 0) {
      files.push({ file, test: TEST_FILE.test(file), uses });
    }
  }

  definitions.sort(
    (a, b) =>
      a.within.length - b.within.length ||
      a.file.localeCompare(b.file) ||
      a.start - b.start,
  );
  files.sort(
    (a, b) =>
      Number(a.test) - Number(b.test) ||
      b.uses.length - a.uses.length ||
      a.file.localeCompare(b.file),
  );
  return { symbol, definitions, files, unparsed };
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

const LIMITS = { definitions: 12, source: 20, tests: 10, groups: 6, lines: 4 };

/** One file's uses as `declaration:line,line · declaration:line`. */
function describeUses(uses: SymbolFile['uses'], all: boolean): string {
  const groups = new Map<string, number[]>();
  for (const { line, within } of uses) {
    const key = within ?? 'top level';
    const lines = groups.get(key) ?? [];
    lines.push(line);
    groups.set(key, lines);
  }
  const parts = [...groups].map(([within, lines]) => {
    const shown = all ? lines : lines.slice(0, LIMITS.lines);
    const more = lines.length - shown.length;
    return `${within}:${shown.join(',')}${more > 0 ? `,+${more}` : ''}`;
  });
  const shown = all ? parts : parts.slice(0, LIMITS.groups);
  const more = parts.length - shown.length;
  return `${shown.join(' · ')}${more > 0 ? ` · +${more} more` : ''}`;
}

/** The report as lines: a count, then `defined`, `used in` and `tests` sections. */
export function renderReport(
  report: SymbolReport,
  { all = false }: { all?: boolean } = {},
): string[] {
  const source = report.files.filter((file) => !file.test);
  const tests = report.files.filter((file) => file.test);
  const total = (list: SymbolFile[]) =>
    list.reduce((sum, file) => sum + file.uses.length, 0);
  const lines = [
    `${report.symbol} — ${plural(report.definitions.length, 'definition')} · ${plural(total(source), 'use')} in ${plural(source.length, 'file')} · ${plural(total(tests), 'use')} in ${plural(tests.length, 'test file')}`,
  ];

  const section = <T>(
    title: string,
    items: T[],
    limit: number,
    row: (item: T) => string,
  ) => {
    if (items.length === 0) return;
    const shown = all ? items : items.slice(0, limit);
    lines.push('', title, ...shown.map((item) => `  ${row(item)}`));
    if (shown.length < items.length) {
      lines.push(`  +${items.length - shown.length} more (--all)`);
    }
  };

  if (report.definitions.length === 0) {
    lines.push(
      '',
      'defined',
      '  nothing is declared under this name in the files searched: it may be a parameter, a plain property, or come from a dependency',
    );
  }
  section(
    'defined',
    report.definitions,
    LIMITS.definitions,
    ({ file, start, end, label, within }) =>
      `${file}:${start === end ? start : `${start}-${end}`}  ${label}${within.length > 0 ? `  (in ${within.join(' > ')})` : ''}`,
  );
  const usesRow = ({ file, uses }: SymbolFile) =>
    `${file}  ${uses.length}×  ${describeUses(uses, all)}`;
  section('used in', source, LIMITS.source, usesRow);
  section('tests', tests, LIMITS.tests, usesRow);
  if (report.unparsed.length > 0) {
    lines.push(
      '',
      `${plural(report.unparsed.length, 'matching file')} not parsed, so declarations in ${report.unparsed.length === 1 ? 'it' : 'them'} are listed as uses: ${clip(report.unparsed.join(', '), 200)}`,
    );
  }
  return lines;
}

/** `where <symbol> [--path <prefix>]… [--all] [--json]` */
export const runWhere: Command = async (args, { cwd, io }) => {
  const usage = 'Usage: where <symbol> [--path <prefix>]… [--all] [--json]';
  const paths: string[] = [];
  const names: string[] = [];
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--path') {
      index += 1;
      const value = args[index];
      if (!value || value.startsWith('--')) {
        io.error(`--path takes a directory or file prefix\n${usage}`);
        return 2;
      }
      paths.push(value);
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      names.push(arg);
    }
  }
  const [symbol] = names;
  if (names.length !== 1 || !symbol) {
    io.error(usage);
    return 2;
  }
  if (!/^[\w$]+$/u.test(symbol)) {
    io.error(
      `where looks up one identifier, and ${JSON.stringify(symbol)} is not one. For \`Foo.bar\`, ask for \`bar\`.`,
    );
    return 2;
  }

  const report = await findSymbol(symbol, { cwd, paths });
  if (flags.has('--json')) {
    io.log(JSON.stringify(report, null, 2));
    return report.files.length + report.definitions.length > 0 ? 0 : 1;
  }
  if (report.files.length + report.definitions.length === 0) {
    io.error(
      `${symbol}: no whole-word match in ${OUTLINE_EXTENSIONS.map((ext) => `.${ext}`).join(' ')} files${paths.length > 0 ? ` under ${paths.join(', ')}` : ''}.`,
    );
    return 1;
  }
  for (const line of renderReport(report, { all: flags.has('--all') })) {
    io.log(line);
  }
  return 0;
};
