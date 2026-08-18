/**
 * Preset lab — real-GPU differential for the compute-VM WGSL generator.
 *
 * The tier-differential fuzz suites compare the CPU tiers against
 * hand-written JS *mirrors* of the WGSL — the mirrors themselves can drift.
 * This harness closes that gap for the compute VM: seeded random EEL
 * programs are compiled with compileProgramToWgsl, executed on an ACTUAL
 * GPU (headless Chromium WebGPU compute dispatch), and the read-back
 * VmState is diffed against the CPU JIT within f32 tolerance.
 *
 *   bun run lab:gpu-differential                 # 200 seeded programs
 *   bun run lab:gpu-differential -- --count 500
 *
 * Exit 1 on any hard divergence. rand()-using programs are skipped (the
 * CPU and GPU random streams are different by design); megabuf programs
 * are skipped (classified gpuExecutable: false until the guest-memory
 * model lands). Tolerance is loose-ish (f32 vs f64 through transcendental
 * chains); the divergences this exists to catch — wrong guard semantics —
 * are orders of magnitude, not ulps.
 */

import { chromium } from 'playwright';
import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from '../src/js/milkdrop/common-types.ts';
import { compileProgramToWgsl } from '../src/js/milkdrop/compiler/wgsl-generator.ts';
import { parseMilkdropStatement } from '../src/js/milkdrop/expression.ts';
import { compileMilkdropProgram } from '../src/js/milkdrop/expression-jit.ts';
import { MILKDROP_WGSL_SIGNAL_FIELDS } from '../src/js/milkdrop/wgsl-signal-layout.ts';
import { ensureDevServer } from './dev-server.ts';

const PORT = 5196;
const DEFAULT_PROGRAM_COUNT = 200;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARS = ['a', 'b', 'c', 'd', 'x', 'y', 'zoom', 'rot'];
const SIGNALS = ['bass', 'mid', 'treb', 'vol', 'time'];
const UNARY_FNS = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'sqr',
  'abs',
  'exp',
  'log',
  'log10',
  'sign',
  'int',
  'floor',
  'ceil',
  'frac',
];
const BINARY_FNS = ['pow', 'min', 'max', 'atan2', 'above', 'below', 'equal'];
const BIN_OPS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '&&',
  '||',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
  '|',
  '&',
];

function genExpr(rnd: () => number, depth: number): string {
  const roll = rnd();
  if (depth <= 0 || roll < 0.28) {
    const pick = rnd();
    if (pick < 0.4) return (rnd() * 20 - 10).toFixed(4);
    if (pick < 0.8) return VARS[Math.floor(rnd() * VARS.length)] as string;
    return SIGNALS[Math.floor(rnd() * SIGNALS.length)] as string;
  }
  if (roll < 0.5) {
    const fn = UNARY_FNS[Math.floor(rnd() * UNARY_FNS.length)];
    return `${fn}(${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.62) {
    const fn = BINARY_FNS[Math.floor(rnd() * BINARY_FNS.length)];
    return `${fn}(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.72) {
    return `if(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  const op = BIN_OPS[Math.floor(rnd() * BIN_OPS.length)];
  return `(${genExpr(rnd, depth - 1)} ${op} ${genExpr(rnd, depth - 1)})`;
}

function genProgram(rnd: () => number): string[] {
  const lines: string[] = [];
  const count = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < count; i++) {
    const target = VARS[Math.floor(rnd() * VARS.length)];
    lines.push(`${target} = ${genExpr(rnd, 3)}`);
  }
  return lines;
}

function parseProgram(lines: string[]): MilkdropProgramBlock | null {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [i, line] of lines.entries()) {
    const parsed = parseMilkdropStatement(line, i + 1);
    if (!parsed.value) return null;
    if (parsed.diagnostics.some((d) => d.severity === 'error')) return null;
    statements.push(parsed.value);
  }
  return { statements, sourceLines: lines };
}

type GpuJob = {
  seed: number;
  lines: string[];
  wgslCode: string;
  /** Sorted state-struct field order; f32 each, rand_state u32. */
  fieldKeys: string[];
  initialState: number[];
  signalValues: number[];
};

/** Loose f32-vs-f64 comparison: hard failures only. Guard-semantics bugs
 * (the target class) produce order-of-magnitude differences. */
function closeEnough(cpu: number, gpu: number): boolean {
  if (!Number.isFinite(cpu) || !Number.isFinite(gpu)) {
    return cpu === gpu;
  }
  const diff = Math.abs(cpu - gpu);
  return diff <= 1e-3 + 5e-3 * Math.max(Math.abs(cpu), Math.abs(gpu));
}

async function main() {
  const args = process.argv.slice(2);
  const countIndex = args.indexOf('--count');
  const programCount =
    countIndex >= 0 ? Number(args[countIndex + 1]) : DEFAULT_PROGRAM_COUNT;

  // ── Build jobs: compile WGSL + run CPU reference ────────────────────────
  const jobs: GpuJob[] = [];
  const cpuResults: Array<Record<string, number>> = [];
  let skipped = 0;
  for (
    let seed = 1;
    jobs.length < programCount && seed < programCount * 4;
    seed++
  ) {
    const rnd = mulberry32(seed);
    const lines = genProgram(rnd);
    const block = parseProgram(lines);
    if (!block) {
      skipped++;
      continue;
    }
    const compilation = compileProgramToWgsl(block);
    if (!compilation.gpuExecutable || compilation.usesRandom) {
      skipped++;
      continue;
    }

    const inputRnd = mulberry32(seed * 7919);
    const env: Record<string, number> = {};
    for (const v of VARS) {
      // Quantize inputs to f32 so both tiers start from identical values.
      env[v] = Math.fround(inputRnd() * 4 - 2);
    }
    const signalEnv: Record<string, number> = {};
    for (const s of MILKDROP_WGSL_SIGNAL_FIELDS) {
      signalEnv[s] = 0;
    }
    signalEnv.bass = Math.fround(0.7);
    signalEnv.mid = Math.fround(0.5);
    signalEnv.treb = Math.fround(0.4);
    signalEnv.vol = Math.fround(0.55);
    signalEnv.time = Math.fround(3.25);

    // CPU reference: JIT over env + signals merged (signals resolve as plain
    // identifiers on the CPU tier).
    const cpuEnv = { ...env, ...signalEnv };
    compileMilkdropProgram(block)(
      cpuEnv,
      {},
      {},
      null,
      new Float32Array(16),
      new Float32Array(16),
      () => 0.5,
    );
    cpuResults.push(cpuEnv);

    const initialState = compilation.fieldKeys.map((key) =>
      key === 'rand_state' ? 0 : Math.fround((env[key] ?? 0) as number),
    );
    jobs.push({
      seed,
      lines,
      wgslCode: compilation.wgslCode,
      fieldKeys: compilation.fieldKeys,
      initialState,
      signalValues: MILKDROP_WGSL_SIGNAL_FIELDS.map((key) =>
        Math.fround(signalEnv[key] ?? 0),
      ),
    });
  }
  console.log(
    `Prepared ${jobs.length} GPU-executable programs (${skipped} skipped: parse/rand/megabuf).`,
  );

  // ── Execute on a real GPU ───────────────────────────────────────────────
  const server = await ensureDevServer(PORT, process.cwd());
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  let failures: string[] = [];
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/?agent=true`, {
      waitUntil: 'domcontentloaded',
    });
    const gpuAvailable = await page.evaluate(() => 'gpu' in navigator);
    if (!gpuAvailable) {
      throw new Error('navigator.gpu unavailable in this Chromium.');
    }

    const gpuResults = (await page.evaluate(async (pageJobs) => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { error: 'no WebGPU adapter' };
      const device = await adapter.requestDevice();
      // Explicit layout: 'auto' prunes bindings a program doesn't statically
      // use (e.g. signals in a signal-free program), which invalidates the
      // bind group and silently zeroes the whole dispatch.
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage' },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });
      const results: Array<{
        seed: number;
        state?: number[];
        error?: string;
      }> = [];
      for (const job of pageJobs) {
        try {
          device.pushErrorScope('validation');
          const module = device.createShaderModule({ code: job.wgslCode });
          const pipeline = await device.createComputePipelineAsync({
            layout: pipelineLayout,
            compute: { module, entryPoint: 'main' },
          });
          const stateBytes = job.initialState.length * 4;
          const stateBuffer = device.createBuffer({
            size: stateBytes,
            usage:
              GPUBufferUsage.STORAGE |
              GPUBufferUsage.COPY_DST |
              GPUBufferUsage.COPY_SRC,
          });
          device.queue.writeBuffer(
            stateBuffer,
            0,
            new Float32Array(job.initialState),
          );
          const signalBuffer = device.createBuffer({
            size: job.signalValues.length * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(
            signalBuffer,
            0,
            new Float32Array(job.signalValues),
          );
          const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
              { binding: 0, resource: { buffer: stateBuffer } },
              { binding: 1, resource: { buffer: signalBuffer } },
            ],
          });
          const readback = device.createBuffer({
            size: stateBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
          encoder.copyBufferToBuffer(stateBuffer, 0, readback, 0, stateBytes);
          device.queue.submit([encoder.finish()]);
          const scopeError = await device.popErrorScope();
          if (scopeError) {
            results.push({ seed: job.seed, error: scopeError.message });
            readback.destroy();
            stateBuffer.destroy();
            signalBuffer.destroy();
            continue;
          }
          await readback.mapAsync(GPUMapMode.READ);
          results.push({
            seed: job.seed,
            state: [...new Float32Array(readback.getMappedRange())],
          });
          readback.unmap();
          stateBuffer.destroy();
          signalBuffer.destroy();
          readback.destroy();
        } catch (error) {
          results.push({ seed: job.seed, error: String(error) });
        }
      }
      return { results };
    }, jobs)) as {
      error?: string;
      results?: Array<{ seed: number; state?: number[]; error?: string }>;
    };

    if (gpuResults.error || !gpuResults.results) {
      throw new Error(gpuResults.error ?? 'no GPU results');
    }

    // ── Diff ──────────────────────────────────────────────────────────────
    failures = [];
    for (const [index, job] of jobs.entries()) {
      const cpu = cpuResults[index] as Record<string, number>;
      const gpu = gpuResults.results[index];
      if (!gpu || gpu.error || !gpu.state) {
        failures.push(
          `seed ${job.seed}: GPU error: ${gpu?.error ?? 'missing'}\n  ${job.lines.join('\n  ')}`,
        );
        continue;
      }
      for (const [fieldIndex, key] of job.fieldKeys.entries()) {
        if (key === 'rand_state' || key === 'pi' || key === 'e') continue;
        if (!VARS.includes(key)) continue; // only program-written vars matter
        const cpuValue = Math.fround(cpu[key] ?? 0);
        const gpuValue = gpu.state[fieldIndex] as number;
        if (!closeEnough(cpuValue, gpuValue)) {
          failures.push(
            `seed ${job.seed}: ${key} cpu=${cpuValue} gpu=${gpuValue}\n  ${job.lines.join('\n  ')}`,
          );
          break;
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length}/${jobs.length} programs diverged:`);
    for (const failure of failures.slice(0, 10)) {
      console.error(`  ${failure}`);
    }
    if (failures.length > 10) {
      console.error(`  … ${failures.length - 10} more`);
    }
    process.exit(1);
  }
  console.log(
    `✔ ${jobs.length} programs agree between CPU JIT and real-GPU compute VM.`,
  );
}

main();
