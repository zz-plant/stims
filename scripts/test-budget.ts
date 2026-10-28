#!/usr/bin/env bun
/**
 * Test budget audit: ranks gate and package tests by the CPU they burn, and flags those that machine load can push past their timeout.
 *
 * A timeout measures wall time, and wall time stretches with load. On
 * 2026-10-13 a no-bail gate at load 100-200 on 10 cores timed out 23 tests,
 * most of them 100-300 ms of CPU stretched 7-87x; the median stretch was ~1.7x
 * the run queue per core (load / cores), and the worst few ran past 5x. The
 * old audit lowered the default timeout and listed what overran, so its answer
 * depended on how busy the machine was while it ran. This one measures what
 * load does not change much: each test's CPU time, its subprocesses' included
 * (scripts/test-cost-recorder.ts). It then predicts the wall time at a target
 * load as
 *
 *   wall = wait + cpu × max(1, INFLATION × load / cores)
 *
 * where `wait` is the test's measured wall time minus its CPU (sleeps, I/O),
 * and INFLATION = 3 sits above nearly every stretch seen on 2026-10-13. A
 * test's survivable load is where that crosses its timeout: bun's 5 s default,
 * or the explicit timeout read from its call site. Run it at any load; the
 * ranking and the verdict come out the same.
 *
 *   bun run test:budget                         # gate profile + every package
 *   bun run test:budget -- --load 100           # target load (default 4 × cores)
 *   bun run test:budget -- --changed            # only tests the diff can affect
 *   bun run test:budget -- tests/unit/foo.test.ts packages/flash-guard/tests/governor.test.ts
 *
 * Exits 1 when a test relying on the default timeout would overrun it below
 * the target load. Explicit timeouts are reported, not failed: someone chose
 * them. Every test also runs with the default lifted to 120 s, so none is cut
 * short before its cost is recorded.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { TestCostRecord } from './test-cost-recorder.ts';

const ROOT = resolve(import.meta.dirname, '..');
const RECORDER = join(ROOT, 'scripts', 'test-cost-recorder.ts');
/** bun's default per-test timeout. */
export const DEFAULT_TIMEOUT_MS = 5000;
/** The default while measuring: long enough that no test is cut short. */
const MEASURE_TIMEOUT_MS = 120_000;
/** Wall stretch per unit of load per core; see the docblock. */
export const INFLATION = 3;
/** Loads, as multiples of the core count, the summary counts tests at. */
const SWEEP = [2, 4, 10, 20];

const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attribute = (attributes: string, key: string) =>
  decode(attributes.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '');

export type JunitCase = {
  file: string;
  line: string;
  /** Describe path and test name, outermost first, joined with ' > '. */
  name: string;
  wallMs: number;
  status: 'pass' | 'timeout' | 'fail' | 'skip';
};

/**
 * Reads one bun junit report in the order its tests ran. The describe path
 * comes from the nested <testsuite> elements (the outermost is the file).
 */
export function readJunitCases(xml: string): JunitCase[] {
  const cases: JunitCase[] = [];
  const suites: string[] = [];
  let open: JunitCase | null = null;
  const tags = /<(\/?)(testsuite|testcase|failure|skipped)\b([^>]*?)(\/?)>/g;
  for (const [, closing, kind, attributes = '', selfClosing] of xml.matchAll(
    tags,
  )) {
    if (kind === 'testsuite') {
      // A self-closing suite (a file with no tests) never opens a level.
      if (closing) suites.pop();
      else if (!selfClosing) suites.push(attribute(attributes, 'name'));
    } else if (kind === 'testcase') {
      if (closing) {
        open = null;
        continue;
      }
      const testCase: JunitCase = {
        file: attribute(attributes, 'file'),
        line: attribute(attributes, 'line'),
        name: [...suites.slice(1), attribute(attributes, 'name')].join(' > '),
        wallMs: Number(attribute(attributes, 'time')) * 1000,
        status: 'pass',
      };
      cases.push(testCase);
      open = selfClosing ? null : testCase;
    } else if (open && !closing) {
      // A <failure> or <skipped> belongs to the testcase most recently opened.
      open.status =
        kind === 'skipped'
          ? 'skip'
          : attribute(attributes, 'type') === 'TimeoutError'
            ? 'timeout'
            : 'fail';
    }
  }
  return cases;
}

export type CostedTest = JunitCase & {
  selfCpuMs: number;
  childCpuMs: number;
  /** The recorder's wall time: the same window as its CPU figures. */
  measuredWallMs: number;
};

/**
 * Pairs each test that ran with its cost record. Hooks see no test name, so
 * the nth record of a file is its nth test to run; skipped tests have none.
 * A file whose counts disagree is left unpaired rather than guessed at. Both
 * sides must name files the same way (see `repoPath`).
 */
export function pairCosts(
  cases: JunitCase[],
  records: TestCostRecord[],
): {
  tests: CostedTest[];
  setupCpuMs: Map<string, number>;
  unpaired: string[];
} {
  const byFile = new Map<string, TestCostRecord[]>();
  const setupCpuMs = new Map<string, number>();
  for (const record of records) {
    const file = record.file;
    const list = byFile.get(file) ?? [];
    list.push(record);
    byFile.set(file, list);
    if (record.setupCpuMs !== undefined) {
      setupCpuMs.set(file, (setupCpuMs.get(file) ?? 0) + record.setupCpuMs);
    }
  }
  const ranByFile = new Map<string, JunitCase[]>();
  for (const testCase of cases) {
    if (testCase.status === 'skip') continue;
    const file = testCase.file;
    const list = ranByFile.get(file) ?? [];
    list.push(testCase);
    ranByFile.set(file, list);
  }
  const tests: CostedTest[] = [];
  const unpaired: string[] = [];
  for (const [file, ran] of ranByFile) {
    const costs = (byFile.get(file) ?? []).sort((a, b) => a.index - b.index);
    if (costs.length !== ran.length) {
      unpaired.push(file);
      continue;
    }
    ran.forEach((testCase, index) => {
      const cost = costs[index] as TestCostRecord;
      tests.push({
        ...testCase,
        file,
        selfCpuMs: cost.selfCpuMs,
        childCpuMs: cost.childCpuMs,
        measuredWallMs: cost.wallMs,
      });
    });
  }
  return { tests, setupCpuMs, unpaired: unpaired.sort() };
}

/**
 * The top-level arguments of the call whose `(` is at `open`, as source
 * text, or null when the text does not balance. Skips strings, template
 * literals, comments and (heuristically) regex literals.
 */
export function callArguments(source: string, open: number): string[] | null {
  const args: string[] = [];
  const stack: string[] = [];
  const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let start = open + 1;
  let index = open;
  let previous = '(';
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      index = source.indexOf('\n', index);
      if (index === -1) return null;
      continue;
    }
    if (char === '/' && next === '*') {
      index = source.indexOf('*/', index + 2);
      if (index === -1) return null;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(source, index);
      if (index === -1) return null;
      previous = char;
      continue;
    }
    // `}` is left out: in JSX it precedes `/>`, and a regex after a block is
    // rare. `>` stays for `=> /re/`.
    if (char === '/' && /[(,=:[!&|?{;>]/.test(previous)) {
      index = skipRegex(source, index);
      if (index === -1) return null;
      previous = '/';
      continue;
    }
    if (closers[char]) {
      stack.push(closers[char] as string);
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== char) return null;
      if (stack.length === 0) {
        const last = source.slice(start, index).trim();
        if (last) args.push(last);
        return args;
      }
    } else if (char === ',' && stack.length === 1) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return null;
}

/** Index just past the string or template literal starting at `index`. */
function skipQuoted(source: string, index: number): number {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    if (quote === '`' && char === '$' && source[cursor + 1] === '{') {
      // Hand the substitution to callArguments' balancer, then resume.
      let depth = 0;
      for (; cursor < source.length; cursor += 1) {
        const inner = source[cursor];
        if (inner === "'" || inner === '"' || inner === '`') {
          const after = skipQuoted(source, cursor);
          if (after === -1) return -1;
          cursor = after - 1;
        } else if (inner === '{') depth += 1;
        else if (inner === '}' && --depth === 0) break;
      }
    }
    cursor += 1;
  }
  return -1;
}

/** Index just past the regex literal starting at `index`. */
function skipRegex(source: string, index: number): number {
  let inClass = false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '\\') cursor += 1;
    else if (char === '\n') return -1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      while (/[a-z]/i.test(source[cursor + 1] ?? '')) cursor += 1;
      return cursor + 1;
    }
  }
  return -1;
}

/** A timeout argument's value: a number, `{ timeout }`, a const, or a product/sum of those. */
function resolveTimeoutArg(
  text: string,
  source: string,
  depth = 0,
): number | null {
  if (depth > 4) return null;
  const option = text.match(/^\{[\s\S]*\btimeout\s*:\s*([^,}]+)[\s\S]*\}$/);
  if (option) return resolveTimeoutArg(option[1] as string, source, depth + 1);
  if (/^[\w$\s*+._]+$/.test(text)) {
    let sum = 0;
    for (const term of text.split('+')) {
      let product = 1;
      for (const factor of term.split('*')) {
        const token = factor.trim();
        if (/^\d[\d_]*(\.\d+)?$/.test(token)) {
          product *= Number(token.replace(/_/g, ''));
        } else if (/^[A-Za-z_$][\w$]*$/.test(token)) {
          const declared = source.match(
            new RegExp(
              `\\b(?:const|let)\\s+${token}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`,
            ),
          );
          const value = declared
            ? resolveTimeoutArg(
                (declared[1] as string).trim(),
                source,
                depth + 1,
              )
            : null;
          if (value === null) return null;
          product *= value;
        } else {
          return null;
        }
      }
      sum += product;
    }
    return sum;
  }
  return null;
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type TestTimeout = number | 'default' | 'unknown';

type TestCall = {
  /** Matches the junit name of every test this call can produce. */
  matches: (name: string) => boolean;
  /** True when the name is a plain literal, so `matches` is equality. */
  exact: boolean;
  timeout: TestTimeout;
  line: number;
};

/**
 * Every test(…) / it(…) call in a file: their .only/.skip/… forms and the
 * curried test.each(table)(…) / test.if(cond)(…) included. A name built from
 * a template literal, or a .each name with %s/$field placeholders, becomes a
 * pattern, so a loop of tests maps back to its one call.
 */
export function testCalls(source: string): TestCall[] {
  const calls: TestCall[] = [];
  const head = /(?:\b(?:test|it)(?:\.\w+)*|\))\s*\(\s*(['"`])/g;
  for (const match of source.matchAll(head)) {
    const quoteAt = match.index + match[0].length - 1;
    const nameEnd = skipQuoted(source, quoteAt);
    if (nameEnd === -1) continue;
    const quote = source[quoteAt] as string;
    const body = source.slice(quoteAt + 1, nameEnd - 1);
    let pattern: RegExp | null = null;
    let text = body.replace(/\\(.)/g, '$1');
    if (quote === '`' && body.includes('${')) {
      // Static text stays literal; each ${…} substitution matches anything.
      let regex = '';
      let cursor = 0;
      while (cursor < body.length) {
        if (body.startsWith('${', cursor)) {
          let depth = 0;
          let end = cursor + 1;
          for (; end < body.length; end += 1) {
            if (body[end] === '{') depth += 1;
            else if (body[end] === '}' && --depth === 0) break;
          }
          regex += '.+?';
          cursor = end + 1;
        } else {
          regex += escapeRegExp(body[cursor] as string);
          cursor += 1;
        }
      }
      pattern = new RegExp(`^${regex}$`);
      text = '';
    } else if (
      /%[sdifjop#]|\$[A-Za-z_]/.test(text) &&
      match[0].startsWith(')')
    ) {
      pattern = new RegExp(
        `^${escapeRegExp(text).replace(/%[sdifjop#]|\\\$[A-Za-z_][\w.]*/g, '.+?')}$`,
      );
    }
    const open = match.index + match[0].lastIndexOf('(');
    const args = callArguments(source, open);
    const timeout: TestTimeout = !args
      ? 'unknown'
      : args.length < 3
        ? 'default'
        : (resolveTimeoutArg(args[2] as string, source) ?? 'unknown');
    calls.push({
      matches: pattern
        ? (name) => (pattern as RegExp).test(name)
        : (name) => name === text,
      exact: !pattern,
      timeout,
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return calls;
}

/**
 * The timeout a test passes bun, read from its call site: a number of ms,
 * 'default' when the call passes none, or 'unknown' when the source does not
 * say plainly (no call matches, an argument it cannot resolve, or matching
 * calls that disagree). Also the call's line, which bun's junit omits under
 * --parallel. A literal name wins over a pattern that also matches it.
 */
export function testCallSite(
  calls: TestCall[],
  testName: string,
): { timeout: TestTimeout; line?: number } {
  const exact = calls.filter((call) => call.exact && call.matches(testName));
  const matched =
    exact.length > 0
      ? exact
      : calls.filter((call) => !call.exact && call.matches(testName));
  const timeouts = new Set(matched.map((call) => call.timeout));
  return {
    timeout:
      timeouts.size === 1 ? ([...timeouts][0] as TestTimeout) : 'unknown',
    line: matched[0]?.line,
  };
}

/**
 * The load at which a test's predicted wall time reaches its timeout:
 * wall = wait + cpu × max(1, inflation × load / cores). Infinity when the
 * test burns no CPU; 0 when it overruns even on an idle machine.
 */
export function survivableLoad({
  cpuMs,
  waitMs,
  timeoutMs,
  cores,
  inflation = INFLATION,
}: {
  cpuMs: number;
  waitMs: number;
  timeoutMs: number;
  cores: number;
  inflation?: number;
}): number {
  const headroom = timeoutMs - waitMs;
  if (cpuMs <= 0) return headroom > 0 ? Number.POSITIVE_INFINITY : 0;
  if (cpuMs > headroom) return 0;
  return (headroom / cpuMs) * (cores / inflation);
}

type Options = {
  profile: string;
  files: string[];
  changed: boolean;
  load: number;
  top: number;
};

function parseArgs(argv: string[], cores: number): Options {
  const options: Options = {
    profile: 'gate',
    files: [],
    changed: false,
    load: 4 * cores,
    top: 12,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--') continue;
    if (arg === '--changed') options.changed = true;
    else if (arg === '--profile') options.profile = argv[++index] ?? 'gate';
    else if (arg === '--load') options.load = Number(argv[++index]);
    else if (arg === '--top') options.top = Number(argv[++index]);
    else options.files.push(arg);
  }
  if (!Number.isFinite(options.load) || options.load <= 0) {
    throw new Error('--load must be a positive load average');
  }
  return options;
}

const PACKAGE_FILE = /^packages\/([^/]+)\/(.+)$/;

/** Packages under packages/ that carry a tests directory. */
const testedPackages = () =>
  readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(ROOT, 'packages', entry.name, 'tests')),
    )
    .map((entry) => entry.name)
    .sort();

type Run = { label: string; cwd: string; cmd: string[] };

/**
 * A test file as a path from the repo root. junit names a file relative to
 * the directory bun ran in, or absolutely when it lies outside it; the
 * recorder always relativizes Bun.main, the real path. Resolving both against
 * the run's directory and the real filesystem makes them agree.
 */
function repoPath(cwd: string, file: string): string {
  const absolute = resolve(cwd, file);
  let real = absolute;
  try {
    real = realpathSync(absolute);
  } catch {
    // A file deleted since the run keeps its resolved path.
  }
  return relative(realpathSync(ROOT), real);
}

function planRuns(options: Options, reports: string): Run[] {
  const rootFiles = options.files.filter((file) => !PACKAGE_FILE.test(file));
  const packageFiles = new Map<string, string[]>();
  for (const file of options.files) {
    const match = file.match(PACKAGE_FILE);
    if (!match) continue;
    const list = packageFiles.get(match[1] as string) ?? [];
    // `./` makes bun read it as a path rather than a name filter.
    list.push(`./${match[2]}`);
    packageFiles.set(match[1] as string, list);
  }
  const runs: Run[] = [];
  if (options.files.length === 0 || rootFiles.length > 0) {
    runs.push({
      label: 'root',
      cwd: ROOT,
      cmd: [
        'bun',
        'run',
        'scripts/run-tests.ts',
        ...(rootFiles.length > 0 ? rootFiles : ['--profile', options.profile]),
        ...(options.changed ? ['--changed'] : []),
        '--no-bail',
        '--timeout',
        String(MEASURE_TIMEOUT_MS),
        '--junit-dir',
        join(reports, 'root'),
        '--cost-dir',
        join(reports, 'root-cost'),
      ],
    });
  }
  // --changed scopes the root suite to the diff; packages have no such map.
  const packages =
    options.files.length > 0
      ? [...packageFiles.keys()]
      : options.changed
        ? []
        : testedPackages();
  for (const name of packages) {
    runs.push({
      label: name,
      cwd: join(ROOT, 'packages', name),
      cmd: [
        'bun',
        'test',
        `--preload=${RECORDER}`,
        `--timeout=${MEASURE_TIMEOUT_MS}`,
        '--reporter=junit',
        `--reporter-outfile=${join(reports, name, 'report.xml')}`,
        ...(packageFiles.get(name) ?? []),
      ],
    });
  }
  return runs;
}

const readRecords = (dir: string): TestCostRecord[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.jsonl'))
        .flatMap((file) =>
          readFileSync(join(dir, file), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as TestCostRecord),
        )
    : [];

const formatMs = (ms: number) => Math.round(ms).toLocaleString('en-US');
const formatLoad = (load: number) =>
  load === Number.POSITIVE_INFINITY ? '∞' : Math.floor(load).toString();

async function main() {
  const cores = availableParallelism();
  const options = parseArgs(process.argv.slice(2), cores);
  const reports = mkdtempSync(join(tmpdir(), 'stims-test-budget-'));
  const log = join(reports, 'run.log');
  const startLoad = loadavg()[0] ?? 0;
  const target =
    options.files.length > 0
      ? options.files.join(' ')
      : `the ${options.profile} profile${options.changed ? ' (changed only)' : ' and every package'}`;
  console.log(
    `Measuring ${target} at load ${startLoad.toFixed(0)} on ${cores} cores…`,
  );

  const output = openSync(log, 'w');
  const started = performance.now();
  const runs = planRuns(options, reports);
  for (const run of runs) {
    const costDir =
      run.label === 'root'
        ? join(reports, 'root-cost')
        : join(reports, `${run.label}-cost`);
    mkdirSync(costDir, { recursive: true });
    mkdirSync(join(reports, run.label), { recursive: true });
    const proc = Bun.spawn({
      cmd: run.cmd,
      cwd: run.cwd,
      env: { ...process.env, STIMS_TEST_COST_DIR: costDir },
      stdout: output,
      stderr: output,
    });
    await proc.exited;
  }
  closeSync(output);
  const elapsedS = (performance.now() - started) / 1000;

  const tests: CostedTest[] = [];
  const setupCpuMs = new Map<string, number>();
  const unpaired: string[] = [];
  let otherFailures = 0;
  let reportCount = 0;
  for (const run of runs) {
    const dir = join(reports, run.label);
    const cases = readdirSync(dir)
      .filter((file) => file.endsWith('.xml'))
      .flatMap((file) => {
        reportCount += 1;
        return readJunitCases(readFileSync(join(dir, file), 'utf8'));
      });
    otherFailures += cases.filter((c) => c.status === 'fail').length;
    const costDir =
      run.label === 'root'
        ? join(reports, 'root-cost')
        : join(reports, `${run.label}-cost`);
    const paired = pairCosts(
      cases.map((c) => ({ ...c, file: repoPath(run.cwd, c.file) })),
      readRecords(costDir).map((r) => ({
        ...r,
        file: repoPath(run.cwd, r.file),
      })),
    );
    tests.push(...paired.tests);
    for (const [file, ms] of paired.setupCpuMs) setupCpuMs.set(file, ms);
    unpaired.push(...paired.unpaired);
  }
  // No report means the runner failed before any test ran; saying "nothing
  // is at risk" would be a clean bill of health with no evidence behind it.
  if (reportCount === 0) {
    console.error(`The test run wrote no reports; its output is in ${log}`);
    process.exit(2);
  }

  const cpu = (test: CostedTest) => test.selfCpuMs + test.childCpuMs;
  const wait = (test: CostedTest) =>
    Math.max(0, test.measuredWallMs - cpu(test));
  const callsByFile = new Map<string, TestCall[]>();
  const callSiteOf = (test: CostedTest) => {
    const path = join(ROOT, test.file);
    if (!callsByFile.has(path)) {
      callsByFile.set(
        path,
        existsSync(path) ? testCalls(readFileSync(path, 'utf8')) : [],
      );
    }
    const leaf = test.name.split(' > ').at(-1) ?? test.name;
    const site = testCallSite(callsByFile.get(path) as TestCall[], leaf);
    if (!test.line && site.line) test.line = String(site.line);
    return site.timeout;
  };
  // Reading call sites is only worth it where a timeout could matter: tests
  // the largest swept load could push past bun's default.
  const maxLoad = Math.max(options.load, (SWEEP.at(-1) ?? 20) * cores);
  const assessed = tests.map((test) => {
    const atDefault = survivableLoad({
      cpuMs: cpu(test),
      waitMs: wait(test),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cores,
    });
    const timeout: TestTimeout =
      atDefault < maxLoad ? callSiteOf(test) : 'default';
    const timeoutMs =
      typeof timeout === 'number' ? timeout : DEFAULT_TIMEOUT_MS;
    return {
      test,
      timeout,
      survives:
        timeoutMs === DEFAULT_TIMEOUT_MS
          ? atDefault
          : survivableLoad({
              cpuMs: cpu(test),
              waitMs: wait(test),
              timeoutMs,
              cores,
            }),
    };
  });
  assessed.sort((a, b) => cpu(b.test) - cpu(a.test));

  const totalCpu = tests.reduce((sum, test) => sum + cpu(test), 0);
  const totalSetup = [...setupCpuMs.values()].reduce((a, b) => a + b, 0);
  console.log(
    `\n${tests.length} tests in ${elapsedS.toFixed(0)} s: ${formatMs(totalCpu / 1000)} s of CPU in tests, ${formatMs(totalSetup / 1000)} s loading files.`,
  );

  const where = (test: CostedTest) =>
    test.line ? `${test.file}:${test.line}` : test.file;
  const timeoutLabel = (timeout: TestTimeout) =>
    typeof timeout === 'number' ? formatMs(timeout) : timeout;
  console.log(
    '\nMost CPU (subprocesses included):\n\n   cpu ms   wall ms   timeout  survives load  test',
  );
  for (const { test, timeout, survives } of assessed.slice(0, options.top)) {
    console.log(
      `${formatMs(cpu(test)).padStart(9)} ${formatMs(test.measuredWallMs).padStart(9)} ${timeoutLabel(timeout).padStart(9)} ${formatLoad(survives).padStart(14)}  ${where(test)}\n${' '.repeat(46)}${test.name}`,
    );
  }

  const setupRanked = [...setupCpuMs].sort((a, b) => b[1] - a[1]);
  console.log(
    '\nMost CPU loading a file (imports and beforeAll, before its first test):\n',
  );
  for (const [file, ms] of setupRanked.slice(0, 5)) {
    console.log(`${formatMs(ms).padStart(9)}  ${file}`);
  }

  const atRisk = (load: number) =>
    assessed.filter((entry) => entry.survives < load);
  console.log(
    `\nTests whose predicted wall time passes their timeout (cores: ${cores}, stretch ${INFLATION}× per unit of load per core):\n`,
  );
  for (const multiple of SWEEP) {
    const load = multiple * cores;
    const risky = atRisk(load);
    const onDefault = risky.filter((entry) => entry.timeout === 'default');
    console.log(
      `  load ${String(load).padStart(4)}: ${String(onDefault.length).padStart(4)} on the 5 s default, ${String(risky.length - onDefault.length).padStart(3)} with their own or an unread timeout`,
    );
  }

  const failing = atRisk(options.load).filter(
    (entry) => entry.timeout === 'default',
  );
  const flagged = atRisk(options.load).filter(
    (entry) => entry.timeout !== 'default',
  );
  if (failing.length > 0) {
    console.log(
      `\n${failing.length} test(s) on bun's 5 s default would overrun it below load ${options.load}:\n`,
    );
    for (const { test, survives } of failing) {
      console.log(
        `  ${where(test)}  (${formatMs(cpu(test))} ms CPU, survives load ${formatLoad(survives)})\n    ${test.name}`,
      );
    }
    console.log(
      '\nShrink the work each one does, or give it a justified timeout of its own.',
    );
  } else {
    console.log(
      `\nNo test on bun's 5 s default would overrun it below load ${options.load}.`,
    );
  }
  if (flagged.length > 0) {
    console.log(
      `\n${flagged.length} test(s) with their own or an unread timeout would also overrun below load ${options.load}:`,
    );
    for (const { test, timeout, survives } of flagged) {
      console.log(
        `  ${where(test)}  (${formatMs(cpu(test))} ms CPU, timeout ${timeoutLabel(timeout)}, survives load ${formatLoad(survives)})\n    ${test.name}`,
      );
    }
  }
  if (unpaired.length > 0) {
    console.log(
      `\nNo cost for ${unpaired.length} file(s) whose tests and records did not line up: ${unpaired.join(', ')}`,
    );
  }
  const timedOut = tests.filter((test) => test.status === 'timeout');
  if (timedOut.length > 0) {
    console.log(
      `\n${timedOut.length} test(s) hit their own timeout while measuring, so their cost is a lower bound: ${timedOut.map(where).join(', ')}`,
    );
  }
  if (otherFailures > 0) {
    console.log(`\n${otherFailures} test(s) failed; full output: ${log}`);
  } else {
    rmSync(reports, { recursive: true, force: true });
  }
  process.exit(failing.length > 0 ? 1 : 0);
}

if (import.meta.main) await main();
