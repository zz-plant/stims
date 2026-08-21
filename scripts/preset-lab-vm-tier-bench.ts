/**
 * Measure what the GPU compute VM actually costs per frame, against the CPU JIT.
 *
 * The compute VM (src/js/milkdrop/vm-gpu.ts) runs a preset's per_frame block
 * as a WebGPU compute dispatch, and `gpuComputeVM` defaults ON for WebGPU
 * sessions. But `vm.ts stepAsync` needs the resulting state back on the CPU
 * to build geometry, so every frame pays an upload, a dispatch, and a
 * readback — for a program whose median size is 21 scalar statements.
 *
 * This harness times the REAL modules (imported in-page through Vite, not
 * reimplemented here) over real preset per_frame blocks:
 *   - `gpu`: syncState + dispatch + readback, exactly what stepAsync does
 *   - `cpu`: the compiled JIT program, same block, same state
 *
 * Reports per-iteration median/p95 microseconds for each tier and the ratio,
 * so "is the GPU tier worth it" is a measurement rather than an argument.
 *
 *   bun run lab:vm-tier-bench
 *   bun run lab:vm-tier-bench -- --iterations 300
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const PORT = 5198;

const args = process.argv.slice(2);
function flag(name: string, fallback: number) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) return Number(args[index + 1]);
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? Number(inline.split('=')[1]) : fallback;
}
const ITERATIONS = flag('iterations', 200);

type Sample = {
  id: string;
  statements: number;
  usesGuestMemory: boolean;
  lines: string[];
};

function collectPresets(): Sample[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.milk')) files.push(path);
    }
  })('public/milkdrop-presets');
  files.sort();

  const parsed = files
    .map((file) => {
      const lines = readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^per_frame_[0-9]+=/i.test(line))
        .map((line) => line.replace(/^[^=]*=/, '').trim())
        .filter(Boolean);
      const source = lines.join('\n');
      return {
        id:
          file
            .split('/')
            .pop()
            ?.replace(/\.milk$/, '') ?? file,
        statements: lines.length,
        usesGuestMemory: /\bg?megabuf\b/i.test(source),
        lines,
      };
    })
    .filter((entry) => entry.statements > 0);

  const bySize = [...parsed].sort((a, b) => a.statements - b.statements);
  const at = (p: number) =>
    bySize[
      Math.min(bySize.length - 1, Math.floor(bySize.length * p))
    ] as Sample;
  const guest = parsed.find((entry) => entry.usesGuestMemory);

  // Median / p90 / p99 by program size, plus one guest-memory user (2.3% of
  // the corpus, but the only case that moves 8 MiB per frame).
  const picks = [at(0.5), at(0.9), at(0.99), ...(guest ? [guest] : [])];
  const seen = new Set<string>();
  return picks.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

const samples = collectPresets();
console.log(
  `Benchmarking ${samples.length} per_frame blocks x ${ITERATIONS} iterations:\n` +
    samples
      .map(
        (s) =>
          `  ${s.id} — ${s.statements} statements${s.usesGuestMemory ? ', uses guest memory' : ''}`,
      )
      .join('\n'),
);

const server = await ensureDevServer(PORT, process.cwd());
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`  [page] ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?agent=true`, {
    waitUntil: 'domcontentloaded',
  });
  if (!(await page.evaluate(() => 'gpu' in navigator))) {
    throw new Error('navigator.gpu unavailable in this Chromium.');
  }

  const results = await page.evaluate(
    async ({ pageSamples, iterations }) => {
      // Vite serves these from the dev server; the specifiers are URLs, not
      // paths tsc can resolve, so they go through a variable to keep the
      // module graph out of the typecheck.
      const load = (specifier: string) =>
        import(/* @vite-ignore */ specifier) as Promise<any>;
      const [
        { parseMilkdropStatement },
        { compileMilkdropProgram },
        { createGpuVmRunner },
      ] = await Promise.all([
        load('/src/js/milkdrop/expression.ts'),
        load('/src/js/milkdrop/expression-jit.ts'),
        load('/src/js/milkdrop/vm-gpu.ts'),
      ]);

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { error: 'no WebGPU adapter' };
      const device = await adapter.requestDevice();

      const stats = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        const pick = (p: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        return { median: pick(0.5), p95: pick(0.95) };
      };

      const parseBlock = (lines: string[]) => {
        const statements: any[] = [];
        for (const [index, line] of lines.entries()) {
          const parsed = parseMilkdropStatement(line, index + 1);
          if (
            parsed.value &&
            !parsed.diagnostics.some(
              (d: { severity: string }) => d.severity === 'error',
            )
          ) {
            statements.push(parsed.value);
          }
        }
        return { statements, sourceLines: lines };
      };

      const signals = {
        time: 1,
        frame: 1,
        fps: 60,
        bass: 1,
        mid: 1,
        treb: 1,
        vol: 1,
      };
      const out: any[] = [];

      for (const sample of pageSamples) {
        const state: Record<string, number> = {
          zoom: 1,
          rot: 0,
          warp: 1,
          decay: 0.98,
        };
        const registers: Record<string, number> = {};

        // ── CPU tier ────────────────────────────────────────────────────
        const cpuBlock = parseBlock(sample.lines);
        const cpuFn = compileMilkdropProgram(cpuBlock);
        const megabuf = new Float32Array(1048576);
        const gmegabuf = new Float32Array(1048576);
        const cpuEnv = { ...state };
        const cpuState = { ...state };
        const rnd = () => 0.5;
        for (let i = 0; i < 200; i += 1)
          cpuFn(cpuEnv, cpuState, {}, null, megabuf, gmegabuf, rnd);
        // performance.now() is clamped to ~100us in Chromium, which is far
        // coarser than one CPU-tier call. Time a BATCH and divide, then take
        // the median across batches.
        const BATCH = 2000;
        const cpuTimes: number[] = [];
        for (let batch = 0; batch < 20; batch += 1) {
          const t0 = performance.now();
          for (let i = 0; i < BATCH; i += 1) {
            cpuFn(cpuEnv, cpuState, {}, null, megabuf, gmegabuf, rnd);
          }
          cpuTimes.push(((performance.now() - t0) * 1000) / BATCH);
        }

        // ── GPU tier ────────────────────────────────────────────────────
        const runner = createGpuVmRunner();
        const gpuBlock = parseBlock(sample.lines);
        const gpuTimes: number[] = [];
        let initialized = false;
        try {
          initialized = runner.init(device, gpuBlock, state, 1, registers, {});
          if (initialized) {
            for (let i = 0; i < 5; i += 1) {
              runner.syncState(state, registers, 1);
              await runner.dispatch(signals);
            }
            for (let i = 0; i < iterations; i += 1) {
              const t0 = performance.now();
              runner.syncState(state, registers, 1);
              await runner.dispatch(signals);
              gpuTimes.push((performance.now() - t0) * 1000);
            }
          }
        } catch (error) {
          out.push({
            id: sample.id,
            statements: sample.statements,
            error: String(error),
          });
          runner.dispose?.();
          continue;
        }
        runner.dispose?.();

        out.push({
          id: sample.id,
          statements: sample.statements,
          usesGuestMemory: sample.usesGuestMemory,
          gpuExecutable: initialized,
          cpu: stats(cpuTimes),
          gpu: initialized ? stats(gpuTimes) : null,
        });
      }
      return { results: out };
    },
    { pageSamples: samples, iterations: ITERATIONS },
  );

  if ('error' in results && results.error) {
    throw new Error(results.error as string);
  }

  console.log(
    '\n  program                                     stmts   CPU µs   GPU µs    ratio',
  );
  console.log('  ' + '-'.repeat(78));
  for (const row of (results as { results: any[] }).results) {
    const name = String(row.id).slice(0, 40).padEnd(42);
    if (row.error) {
      console.log(
        `  ${name}${String(row.statements).padStart(5)}   ERROR: ${row.error}`,
      );
      continue;
    }
    if (!row.gpuExecutable) {
      console.log(
        `  ${name}${String(row.statements).padStart(5)}   ${row.cpu.median.toFixed(2).padStart(7)}   (not GPU-executable)`,
      );
      continue;
    }
    const ratio = row.gpu.median / Math.max(row.cpu.median, 1e-6);
    console.log(
      `  ${name}${String(row.statements).padStart(5)}   ${row.cpu.median.toFixed(3).padStart(7)}   ${row.gpu.median.toFixed(1).padStart(7)}   ${ratio.toFixed(0).padStart(6)}x`,
    );
  }
  console.log(
    '\n  (median per iteration; GPU = syncState + dispatch + readback, as stepAsync does)',
  );
} finally {
  await browser.close();
  server?.close?.();
}
