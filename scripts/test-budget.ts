#!/usr/bin/env bun
/**
 * Test budget audit: lists gate tests that lean on bun's 5 s default timeout, before load turns one into a red gate.
 *
 * A CPU-bound test that takes 2 s alone can take 5+ s when the gate runs it
 * in parallel on a loaded machine, and then fails as a timeout rather than on
 * anything it measured (calibrateLive in #1360, the memory probe in #1361).
 * Bun prints no duration for a passing test, so nothing shows that coming.
 *
 * This reruns the suite with the default per-test timeout lowered to the
 * budget (half the default unless told otherwise). Tests that pass their own
 * timeout keep it, so the only ones that time out are tests relying on the
 * default that used more than the budget. Each needs its work shrunk or a
 * justified timeout of its own. Other failures in the run are counted but not
 * listed: they are not budget findings.
 *
 *   bun run test:budget                          # gate profile, 2500 ms budget
 *   bun run test:budget -- --budget-ms 1500
 *   bun run test:budget -- --profile unit
 *   bun run test:budget -- tests/unit/foo.test.ts
 *
 * Exits 1 when any test overran the budget. Durations depend on load, so run
 * it when the machine is as busy as the gate usually is. A failing pass stops
 * run-tests before its later ones, so the browser-backed pass is audited only
 * when the parallel pass is clean; its tests set their own timeouts today.
 */
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_BUDGET_MS = 2500;

/** A test that timed out at the budget. Its recorded time is the budget
 * itself, not how long it would have run, so none is kept. */
export type BudgetOverrun = { file: string; line: string; name: string };

const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attribute = (attributes: string, key: string) =>
  decode(attributes.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '');

/**
 * Reads one bun junit report: the tests that timed out, and how many failed
 * any other way. The describe path comes from the nested <testsuite> elements
 * (the outermost is the file); bun's `classname` lists them innermost first.
 */
export function readJunitReport(xml: string): {
  overruns: BudgetOverrun[];
  otherFailures: number;
} {
  const overruns: BudgetOverrun[] = [];
  let otherFailures = 0;
  const suites: string[] = [];
  let open: BudgetOverrun | null = null;
  const tags = /<(\/?)(testsuite|testcase|failure)\b([^>]*?)(\/?)>/g;
  for (const [, closing, kind, attributes = '', selfClosing] of xml.matchAll(
    tags,
  )) {
    if (kind === 'testsuite') {
      // A self-closing suite (a file with no tests) never opens a level.
      if (closing) suites.pop();
      else if (!selfClosing) suites.push(attribute(attributes, 'name'));
    } else if (kind === 'testcase') {
      // A <failure> belongs to the testcase element most recently opened.
      open = closing
        ? null
        : {
            file: attribute(attributes, 'file'),
            line: attribute(attributes, 'line'),
            name: [...suites.slice(1), attribute(attributes, 'name')].join(
              ' > ',
            ),
          };
    } else if (open) {
      if (attribute(attributes, 'type') === 'TimeoutError') overruns.push(open);
      else otherFailures += 1;
      open = null;
    }
  }
  return { overruns, otherFailures };
}

function parseArgs(argv: string[]) {
  let budgetMs = DEFAULT_BUDGET_MS;
  let profile = 'gate';
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--') continue;
    if (arg === '--budget-ms') {
      index += 1;
      budgetMs = Number(argv[index]);
    } else if (arg === '--profile') {
      index += 1;
      profile = argv[index] ?? profile;
    } else {
      files.push(arg);
    }
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('--budget-ms must be a positive number of milliseconds');
  }
  return { budgetMs, profile, files };
}

async function main() {
  const { budgetMs, profile, files } = parseArgs(process.argv.slice(2));
  const reports = mkdtempSync(join(tmpdir(), 'stims-test-budget-'));
  const log = join(reports, 'run.log');
  const target = files.length > 0 ? files.join(' ') : `the ${profile} profile`;
  console.log(`Running ${target} with a ${budgetMs} ms default timeout…`);

  const output = openSync(log, 'w');
  const run = Bun.spawn({
    cmd: [
      'bun',
      'run',
      'scripts/run-tests.ts',
      ...(files.length > 0 ? files : ['--profile', profile]),
      '--no-bail',
      '--timeout',
      String(budgetMs),
      '--junit-dir',
      reports,
    ],
    stdout: output,
    stderr: output,
  });
  await run.exited;
  closeSync(output);

  const reportFiles = readdirSync(reports).filter((file) =>
    file.endsWith('.xml'),
  );
  // No report means the runner failed before any test ran; saying "nothing
  // overran" would be a clean bill of health with no evidence behind it.
  if (reportFiles.length === 0) {
    console.error(`The test run wrote no reports; its output is in ${log}`);
    process.exit(2);
  }
  const overruns: BudgetOverrun[] = [];
  let otherFailures = 0;
  for (const report of reportFiles) {
    const read = readJunitReport(readFileSync(join(reports, report), 'utf8'));
    overruns.push(...read.overruns);
    otherFailures += read.otherFailures;
  }
  overruns.sort(
    (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name),
  );

  if (overruns.length === 0) {
    console.log(
      `No test relying on the default timeout took over ${budgetMs} ms.`,
    );
  } else {
    console.log(
      `\n${overruns.length} test(s) rely on bun's default timeout and took over ${budgetMs} ms:\n`,
    );
    for (const overrun of overruns) {
      // bun omits `line` when the run uses --parallel, as the gate does.
      const at = overrun.line
        ? `${overrun.file}:${overrun.line}`
        : overrun.file;
      console.log(`  ${at}\n    ${overrun.name}`);
    }
    console.log(
      '\nShrink the work each one does, or give it a justified timeout of its own.',
    );
  }
  if (otherFailures > 0) {
    console.log(
      `\n${otherFailures} test(s) failed for other reasons; full output: ${log}`,
    );
  } else {
    rmSync(reports, { recursive: true, force: true });
  }
  process.exit(overruns.length > 0 ? 1 : 0);
}

if (import.meta.main) await main();
