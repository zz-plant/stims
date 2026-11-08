/**
 * Turns a red CI run into the failing assertion, without the runner setup noise.
 *
 * `gh run view --log-failed` returns the job's setup lines and can miss the
 * step output entirely, so extracting one failure used to cost a jobs-API call
 * and a sed/grep pipeline. This does that pipeline once: it resolves the run,
 * finds the failing jobs, and prints only the test name, error, expected and
 * received values, the first stack frames, and the job link.
 *
 * Usage:
 *   bun run ci:why                 # latest CI run for the current branch
 *   bun run ci:why -- 42514407652  # a specific run id
 *   bun run ci:why -- --pr 1689    # the pull request's latest run
 *   bun run ci:why -- --json       # machine-readable output
 *   bun run ci:why -- --max-lines 80
 */
import { spawnSync } from 'node:child_process';

const DEFAULT_MAX_LINES = 40;
// Biome rejects a literal escape control character in a regex; build it.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;
const JOB_PREFIX = /^[^\t]*\t[^\t]*\t/;

/** Lines that say why a test failed, without the surrounding runner noise. */
const FAILURE_LINE =
  /^(?:\(fail\)|error:|Expected:|Received:|TimeoutError|Error:|Ran \d+ tests|\s+at |##\[error\])/;

export type CiWhyOptions = {
  runId?: string;
  pr?: string;
  json: boolean;
  maxLines: number;
};

export function parseCiWhyArgs(argv: string[]): CiWhyOptions {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const positional = argv.filter(
    (arg, index) =>
      !arg.startsWith('--') &&
      !['--pr', '--max-lines'].includes(argv[index - 1] ?? ''),
  );
  const maxLines = Number(value('--max-lines') ?? DEFAULT_MAX_LINES);
  return {
    runId: positional[0],
    pr: value('--pr'),
    json: argv.includes('--json'),
    maxLines:
      Number.isFinite(maxLines) && maxLines > 0 ? maxLines : DEFAULT_MAX_LINES,
  };
}

/**
 * Extracts the failure lines from one job log. Timestamps, ANSI, and the
 * `job<TAB>step<TAB>` prefix GitHub adds are stripped first; the result is
 * capped so one noisy assertion cannot fill an agent's context.
 */
export function extractFailureLines(
  log: string,
  maxLines = DEFAULT_MAX_LINES,
): string[] {
  const lines: string[] = [];
  for (const raw of log.split('\n')) {
    const line = raw
      .replace(ANSI, '')
      // GitHub prefixes API logs with `job<TAB>step<TAB>`; strip it before
      // the timestamp, which sits after the prefix.
      .replace(JOB_PREFIX, '')
      .replace(TIMESTAMP, '')
      .replace(/\r$/, '');
    if (!FAILURE_LINE.test(line)) continue;
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

type GhResult = { ok: boolean; out: string; err: string };

function gh(args: string[]): GhResult {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, out: '', err: result.error.message };
  }
  return {
    ok: result.status === 0,
    out: result.stdout ?? '',
    err: (result.stderr ?? '').trim(),
  };
}

type Run = {
  databaseId: number;
  conclusion: string | null;
  displayTitle: string;
  headBranch: string;
  url: string;
};

type Job = {
  databaseId: number;
  name: string;
  conclusion: string | null;
  url: string;
};

function resolveRun(options: CiWhyOptions): Run | { error: string } {
  if (options.runId) {
    const result = gh([
      'run',
      'view',
      options.runId,
      '--json',
      'databaseId,conclusion,displayTitle,headBranch,url',
    ]);
    if (!result.ok) {
      return { error: `could not read run ${options.runId}: ${result.err}` };
    }
    return JSON.parse(result.out) as Run;
  }

  let branch: string | undefined;
  if (options.pr) {
    const pr = gh(['pr', 'view', options.pr, '--json', 'headRefName']);
    if (!pr.ok) return { error: `could not read PR ${options.pr}: ${pr.err}` };
    branch = (JSON.parse(pr.out) as { headRefName: string }).headRefName;
  } else {
    const current = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    });
    if (current.status !== 0) {
      return { error: 'not a git checkout; pass a run id or --pr <number>' };
    }
    branch = current.stdout.trim();
  }

  const list = gh([
    'run',
    'list',
    '--workflow=ci.yml',
    '--branch',
    branch,
    '--limit',
    '1',
    '--json',
    'databaseId,conclusion,displayTitle,headBranch,url',
  ]);
  if (!list.ok) return { error: `could not list runs: ${list.err}` };
  const runs = JSON.parse(list.out) as Run[];
  if (runs.length === 0) {
    return { error: `no CI runs found for branch ${branch}` };
  }
  return runs[0] as Run;
}

function repoSlug(): string | null {
  const result = gh(['repo', 'view', '--json', 'nameWithOwner']);
  if (!result.ok) return null;
  return (JSON.parse(result.out) as { nameWithOwner: string }).nameWithOwner;
}

function jobLog(slug: string, jobId: number): string {
  const result = gh([
    'api',
    `repos/${slug}/actions/jobs/${jobId}/logs`,
    '--allow-escape-sequences',
  ]);
  return result.ok ? result.out : '';
}

export function formatReport(
  run: Run,
  failures: Array<{ job: Job; lines: string[] }>,
): string[] {
  const lines = [
    `CI run ${run.databaseId}: ${run.conclusion ?? 'running'} — ${run.displayTitle}`,
    run.url,
  ];
  if (failures.length === 0) {
    lines.push(
      '',
      `No failing jobs in this run (${run.conclusion ?? 'running'}).`,
    );
    return lines;
  }
  for (const { job, lines: failureLines } of failures) {
    lines.push('', `✖ ${job.name}`, `  ${job.url}`);
    if (failureLines.length === 0) {
      lines.push('  (no failure lines found; open the job link)');
    } else {
      for (const line of failureLines) lines.push(`  ${line.trimEnd()}`);
    }
  }
  return lines;
}

async function main(argv: string[]): Promise<number> {
  const options = parseCiWhyArgs(argv);
  const run = resolveRun(options);
  if ('error' in run) {
    console.error(`ci:why: ${run.error}`);
    return 2;
  }

  const view = gh(['run', 'view', String(run.databaseId), '--json', 'jobs']);
  if (!view.ok) {
    console.error(`ci:why: could not read jobs: ${view.err}`);
    return 2;
  }
  const jobs = (JSON.parse(view.out) as { jobs: Job[] }).jobs.filter(
    (job) => job.conclusion === 'failure',
  );

  const slug = jobs.length > 0 ? repoSlug() : null;
  const failures = jobs.map((job) => ({
    job,
    lines:
      slug === null
        ? []
        : extractFailureLines(jobLog(slug, job.databaseId), options.maxLines),
  }));

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          run,
          failures: failures.map(({ job, lines }) => ({
            name: job.name,
            url: job.url,
            lines,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  for (const line of formatReport(run, failures)) console.log(line);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
