/**
 * Live frame-cost profiler: boots each preset by URL in headless Chromium,
 * lets a REAL requestAnimationFrame loop run (never synthetic stepping — see
 * the 2026-08-12 correction in the perf notes: synthetic pumps report costs
 * users don't experience), reads the runtime's own per-stage tracker, and
 * takes a CDP CPU profile to rank self-time by function.
 *
 * Complement to scripts/profile-frame.ts, which steps synthetic frames for
 * tightly controlled A/B micro-comparisons; THIS script is the one that
 * reflects what a user's frame actually costs, and the only one whose
 * numbers may be compared against the checked-in baseline.
 *
 * Usage:
 *   bun run lab:profile                          # witness trio vs baseline
 *   bun run lab:profile -- --preset <id> [...]   # ad-hoc presets, no gate
 *   bun run lab:profile -- --update-baseline     # rewrite baseline file
 *   bun run lab:profile -- --renderer webgl      # force backend
 *
 * With no --preset args it runs the checked-in witness presets and compares
 * average frame time against performance/frame-profile-baseline.json,
 * exiting 1 on a regression beyond the threshold. Numbers are same-machine
 * A/B quality only — the baseline stores the machine's identifier and the
 * gate is skipped (with a warning) when it doesn't match.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const DEFAULT_PORT = 5198;
const WARMUP_MS = 4000;
const PROFILE_MS = 6000;
const BASELINE_PATH = 'performance/frame-profile-baseline.json';
/** Frame-time regression tolerance vs baseline; sampling noise on a loaded
 * dev machine runs ~10%, so the gate only trips on real structural change. */
const REGRESSION_RATIO = 1.25;

/** Witness trio: light+blur-rule (geiss-game-of-life), shape-instance-heavy
 * (khazad-dum, ~786 shape instances), wave/mesh-heavy classic. */
const WITNESS_PRESETS = [
  'geiss-game-of-life',
  'martin-the-bridge-of-khazad-dum',
  'flexi-mindblob-2-0',
];

type PresetProfile = {
  presetId: string;
  backend: string;
  averageFrameMs: number | null;
  averageSimulationMs: number | null;
  averageRenderMs: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  topSelfTime: Array<{ label: string; pct: number }>;
  pageErrors: string[];
};

type BaselineFile = {
  version: 1;
  machine: string;
  renderer: string;
  capturedAt: string;
  presets: Record<
    string,
    {
      averageFrameMs: number;
      averageSimulationMs: number;
      averageRenderMs: number;
    }
  >;
};

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function readMultiArg(argv: string[], name: string) {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) {
      values.push(argv[i + 1] as string);
    }
  }
  return values;
}

async function profilePreset(
  baseUrl: string,
  presetId: string,
  renderer: string,
): Promise<PresetProfile | null> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const rendererParam = renderer === 'auto' ? '' : `&renderer=${renderer}`;
    await page.goto(
      `${baseUrl}/?agent=true&preset=${encodeURIComponent(presetId)}${rendererParam}`,
      { waitUntil: 'domcontentloaded' },
    );
    try {
      await page.waitForFunction(
        () =>
          (
            window as unknown as {
              __milkdropRuntimeDebug?: { getPerformance?: () => unknown };
            }
          ).__milkdropRuntimeDebug?.getPerformance?.() != null,
        undefined,
        { timeout: 45000 },
      );
    } catch {
      console.error(`  ${presetId}: engine never mounted`);
      return null;
    }
    await page.waitForTimeout(WARMUP_MS);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await page.waitForTimeout(PROFILE_MS);
    const { profile } = await cdp.send('Profiler.stop');

    const snapshot = (await page.evaluate(() =>
      (
        window as unknown as {
          __milkdropRuntimeDebug: { getPerformance: () => unknown };
        }
      ).__milkdropRuntimeDebug.getPerformance(),
    )) as {
      averageFrameMs: number | null;
      averageSimulationMs: number | null;
      averageRenderMs: number | null;
      p95FrameMs: number | null;
      maxFrameMs: number | null;
    };
    const state = (await page.evaluate(() =>
      (
        window as unknown as {
          __milkdropRuntimeDebug: { getState: () => { backend: string } };
        }
      ).__milkdropRuntimeDebug.getState(),
    )) as { backend: string };

    const hits = new Map<number, number>();
    for (const sample of profile.samples ?? []) {
      hits.set(sample, (hits.get(sample) ?? 0) + 1);
    }
    const byFn = new Map<string, number>();
    for (const node of profile.nodes) {
      const hitCount = hits.get(node.id) ?? 0;
      if (!hitCount) continue;
      const frame = node.callFrame;
      const file = (frame.url ?? '').split('/').slice(-1)[0]?.split('?')[0];
      const label = `${frame.functionName || '(anon)'} @ ${file}:${frame.lineNumber}`;
      byFn.set(label, (byFn.get(label) ?? 0) + hitCount);
    }
    const totalSamples = profile.samples?.length ?? 1;
    const topSelfTime = [...byFn]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([label, count]) => ({
        label,
        pct: Math.round((1000 * count) / totalSamples) / 10,
      }))
      .filter((entry) => entry.pct >= 1);

    return {
      presetId,
      backend: state.backend,
      averageFrameMs: snapshot.averageFrameMs,
      averageSimulationMs: snapshot.averageSimulationMs,
      averageRenderMs: snapshot.averageRenderMs,
      p95FrameMs: snapshot.p95FrameMs,
      maxFrameMs: snapshot.maxFrameMs,
      topSelfTime,
      pageErrors: pageErrors.slice(0, 3),
    };
  } finally {
    await browser.close();
  }
}

function printProfile(result: PresetProfile) {
  console.log(`\n=== ${result.presetId} [backend=${result.backend}]`);
  console.log(
    `frame avg ${result.averageFrameMs?.toFixed(2)}ms  sim ${result.averageSimulationMs?.toFixed(2)}ms  render ${result.averageRenderMs?.toFixed(2)}ms  p95 ${result.p95FrameMs?.toFixed(2)}ms  max ${result.maxFrameMs?.toFixed(2)}ms`,
  );
  for (const entry of result.topSelfTime) {
    console.log(`  ${String(entry.pct).padStart(5)}%  ${entry.label}`);
  }
  if (result.pageErrors.length) {
    console.log(`  page errors: ${result.pageErrors.join(' | ')}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const port = Number.parseInt(readArg(argv, '--port', `${DEFAULT_PORT}`), 10);
  const renderer = readArg(argv, '--renderer', 'auto');
  const updateBaseline = argv.includes('--update-baseline');
  const adHocPresets = readMultiArg(argv, '--preset');
  const presets = adHocPresets.length ? adHocPresets : WITNESS_PRESETS;
  const gated = adHocPresets.length === 0 && !updateBaseline;

  const server = await ensureDevServer(port, process.cwd());
  const results: PresetProfile[] = [];
  try {
    for (const presetId of presets) {
      const result = await profilePreset(
        `http://127.0.0.1:${port}`,
        presetId,
        renderer,
      );
      if (result) {
        results.push(result);
        printProfile(result);
      }
    }
  } finally {
    server.close();
  }

  if (updateBaseline) {
    const baseline: BaselineFile = {
      version: 1,
      machine: hostname(),
      renderer,
      capturedAt: new Date().toISOString(),
      presets: Object.fromEntries(
        results.map((result) => [
          result.presetId,
          {
            averageFrameMs: result.averageFrameMs ?? 0,
            averageSimulationMs: result.averageSimulationMs ?? 0,
            averageRenderMs: result.averageRenderMs ?? 0,
          },
        ]),
      ),
    };
    mkdirSync(dirname(join(process.cwd(), BASELINE_PATH)), { recursive: true });
    writeFileSync(
      join(process.cwd(), BASELINE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
    return;
  }

  if (!gated) {
    return;
  }
  const baselinePath = join(process.cwd(), BASELINE_PATH);
  if (!existsSync(baselinePath)) {
    console.log(
      `\nNo baseline at ${BASELINE_PATH}; run with --update-baseline to create one.`,
    );
    return;
  }
  const baseline = JSON.parse(
    readFileSync(baselinePath, 'utf8'),
  ) as BaselineFile;
  if (baseline.machine !== hostname() || baseline.renderer !== renderer) {
    console.log(
      `\nBaseline is from machine "${baseline.machine}" (renderer=${baseline.renderer}); ` +
        'frame times are not comparable across machines — gate skipped.',
    );
    return;
  }
  let failed = false;
  for (const result of results) {
    const expected = baseline.presets[result.presetId];
    if (!expected || result.averageFrameMs == null) continue;
    const ratio =
      result.averageFrameMs / Math.max(0.01, expected.averageFrameMs);
    const verdict =
      ratio > REGRESSION_RATIO
        ? '✖ REGRESSION'
        : ratio < 1 / REGRESSION_RATIO
          ? '✔ improved'
          : '✔ within tolerance';
    console.log(
      `${verdict}: ${result.presetId} ${expected.averageFrameMs.toFixed(2)}ms → ${result.averageFrameMs.toFixed(2)}ms (${ratio.toFixed(2)}x)`,
    );
    if (ratio > REGRESSION_RATIO) failed = true;
  }
  if (failed) {
    console.error(
      '\nFrame-time regression vs baseline. If intentional, rerun with --update-baseline.',
    );
    process.exitCode = 1;
  }
}

await main();
