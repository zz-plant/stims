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
 * CPU and GPU random streams are different by design). megabuf/gmegabuf
 * programs execute via the guest-memory storage bindings and their write
 * window is diffed slot-for-slot against the CPU JIT's buffers
 * (docs/architecture/eel-guest-memory.md). Tolerance is loose-ish (f32 vs
 * f64 through transcendental
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
import {
  compileMilkdropProgram,
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from '../src/js/milkdrop/expression-jit.ts';
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

/** Buffer WRITE indices stay in [0, 64) so job state is confined to a small,
 * clearable window; READ indices roam (negative / fractional / out-of-range)
 * to exercise the trunc + bounds semantics — reads don't pollute. */
const BUFFER_WRITE_WINDOW = 64;

function genBufferIndex(rnd: () => number): string {
  const pick = rnd();
  if (pick < 0.5) return (rnd() * 100 - 10).toFixed(2);
  if (pick < 0.75) return String(Math.floor(rnd() * BUFFER_WRITE_WINDOW));
  return VARS[Math.floor(rnd() * VARS.length)] as string;
}

function genExpr(rnd: () => number, depth: number): string {
  const roll = rnd();
  if (depth <= 0 || roll < 0.28) {
    const pick = rnd();
    if (pick < 0.35) return (rnd() * 20 - 10).toFixed(4);
    if (pick < 0.7) return VARS[Math.floor(rnd() * VARS.length)] as string;
    if (pick < 0.85)
      return SIGNALS[Math.floor(rnd() * SIGNALS.length)] as string;
    const buffer = pick < 0.925 ? 'megabuf' : 'gmegabuf';
    return `${buffer}(${genBufferIndex(rnd)})`;
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
    const roll = rnd();
    if (roll < 0.2) {
      const buffer = roll < 0.13 ? 'megabuf' : 'gmegabuf';
      const index = Math.floor(rnd() * BUFFER_WRITE_WINDOW);
      lines.push(`${buffer}(${index}) = ${genExpr(rnd, 2)}`);
      continue;
    }
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
  usesMegabuf: boolean;
  usesGmegabuf: boolean;
  /** Seed contents for the buffers' write window ([0, BUFFER_WRITE_WINDOW)). */
  initialMegabuf: number[];
  initialGmegabuf: number[];
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
  const cpuBufferResults: Array<{ megabuf: number[]; gmegabuf: number[] }> = [];
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

    // Deterministic buffer seed contents, quantized to f32 like the scalars.
    const bufferRnd = mulberry32(seed * 104729);
    const initialMegabuf = Array.from({ length: BUFFER_WRITE_WINDOW }, () =>
      Math.fround(bufferRnd() * 4 - 2),
    );
    const initialGmegabuf = Array.from({ length: BUFFER_WRITE_WINDOW }, () =>
      Math.fround(bufferRnd() * 4 - 2),
    );

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
    // identifiers on the CPU tier). Buffers must be allocated at the real
    // guest-memory size — the JIT bounds-checks against MILKDROP_*_SIZE, so a
    // short array would return undefined (NaN) for in-bounds indices.
    const cpuEnv = { ...env, ...signalEnv };
    const cpuMegabuf = new Float32Array(MILKDROP_MEGABUF_SIZE);
    const cpuGmegabuf = new Float32Array(MILKDROP_GMEGABUF_SIZE);
    cpuMegabuf.set(initialMegabuf);
    cpuGmegabuf.set(initialGmegabuf);
    compileMilkdropProgram(block)(
      cpuEnv,
      {},
      {},
      null,
      cpuMegabuf,
      cpuGmegabuf,
      () => 0.5,
    );
    cpuResults.push(cpuEnv);
    cpuBufferResults.push({
      megabuf: [...cpuMegabuf.subarray(0, BUFFER_WRITE_WINDOW)],
      gmegabuf: [...cpuGmegabuf.subarray(0, BUFFER_WRITE_WINDOW)],
    });

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
      usesMegabuf: compilation.usesMegabuf,
      usesGmegabuf: compilation.usesGmegabuf,
      initialMegabuf,
      initialGmegabuf,
    });
  }
  const bufferJobs = jobs.filter(
    (job) => job.usesMegabuf || job.usesGmegabuf,
  ).length;
  console.log(
    `Prepared ${jobs.length} GPU-executable programs (${bufferJobs} using guest memory; ${skipped} skipped: parse/rand).`,
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

    const gpuResults = (await page.evaluate(
      async ({ pageJobs, megabufSize, gmegabufSize, windowSize }) => {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { error: 'no WebGPU adapter' };
        const device = await adapter.requestDevice();
        // Explicit layout: 'auto' prunes bindings a program doesn't statically
        // use (e.g. signals in a signal-free program), which invalidates the
        // bind group and silently zeroes the whole dispatch. Guest-memory
        // bindings are conditional, so one layout per (megabuf, gmegabuf)
        // combination.
        const layoutFor = (usesMegabuf: boolean, usesGmegabuf: boolean) => {
          const entries: GPUBindGroupLayoutEntry[] = [
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
          ];
          if (usesMegabuf) {
            entries.push({
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' },
            });
          }
          if (usesGmegabuf) {
            entries.push({
              binding: 3,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: 'storage' },
            });
          }
          return device.createBindGroupLayout({ entries });
        };
        const layouts = new Map<
          string,
          { layout: GPUBindGroupLayout; pipelineLayout: GPUPipelineLayout }
        >();
        const layoutEntryFor = (
          usesMegabuf: boolean,
          usesGmegabuf: boolean,
        ) => {
          const key = `${usesMegabuf}:${usesGmegabuf}`;
          let entry = layouts.get(key);
          if (!entry) {
            const layout = layoutFor(usesMegabuf, usesGmegabuf);
            entry = {
              layout,
              pipelineLayout: device.createPipelineLayout({
                bindGroupLayouts: [layout],
              }),
            };
            layouts.set(key, entry);
          }
          return entry;
        };
        // Shared full-size guest-memory buffers, reused across jobs. Writes
        // are confined to the seed window by the program generator, so
        // re-seeding the window resets the whole observable state.
        const megabufBuffer = device.createBuffer({
          size: megabufSize * 4,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
        });
        const gmegabufBuffer = device.createBuffer({
          size: gmegabufSize * 4,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.COPY_SRC,
        });
        const windowBytes = windowSize * 4;
        const megabufReadback = device.createBuffer({
          size: windowBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const gmegabufReadback = device.createBuffer({
          size: windowBytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const results: Array<{
          seed: number;
          state?: number[];
          megabuf?: number[];
          gmegabuf?: number[];
          error?: string;
        }> = [];
        for (const job of pageJobs) {
          try {
            device.pushErrorScope('validation');
            const { layout, pipelineLayout } = layoutEntryFor(
              job.usesMegabuf,
              job.usesGmegabuf,
            );
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
            if (job.usesMegabuf) {
              device.queue.writeBuffer(
                megabufBuffer,
                0,
                new Float32Array(job.initialMegabuf),
              );
            }
            if (job.usesGmegabuf) {
              device.queue.writeBuffer(
                gmegabufBuffer,
                0,
                new Float32Array(job.initialGmegabuf),
              );
            }
            const bindEntries: GPUBindGroupEntry[] = [
              { binding: 0, resource: { buffer: stateBuffer } },
              { binding: 1, resource: { buffer: signalBuffer } },
            ];
            if (job.usesMegabuf) {
              bindEntries.push({
                binding: 2,
                resource: { buffer: megabufBuffer },
              });
            }
            if (job.usesGmegabuf) {
              bindEntries.push({
                binding: 3,
                resource: { buffer: gmegabufBuffer },
              });
            }
            const bindGroup = device.createBindGroup({
              layout,
              entries: bindEntries,
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
            if (job.usesMegabuf) {
              encoder.copyBufferToBuffer(
                megabufBuffer,
                0,
                megabufReadback,
                0,
                windowBytes,
              );
            }
            if (job.usesGmegabuf) {
              encoder.copyBufferToBuffer(
                gmegabufBuffer,
                0,
                gmegabufReadback,
                0,
                windowBytes,
              );
            }
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
            const result: (typeof results)[number] = {
              seed: job.seed,
              state: [...new Float32Array(readback.getMappedRange())],
            };
            readback.unmap();
            if (job.usesMegabuf) {
              await megabufReadback.mapAsync(GPUMapMode.READ);
              result.megabuf = [
                ...new Float32Array(megabufReadback.getMappedRange()),
              ];
              megabufReadback.unmap();
            }
            if (job.usesGmegabuf) {
              await gmegabufReadback.mapAsync(GPUMapMode.READ);
              result.gmegabuf = [
                ...new Float32Array(gmegabufReadback.getMappedRange()),
              ];
              gmegabufReadback.unmap();
            }
            results.push(result);
            stateBuffer.destroy();
            signalBuffer.destroy();
            readback.destroy();
          } catch (error) {
            results.push({ seed: job.seed, error: String(error) });
          }
        }
        return { results };
      },
      {
        pageJobs: jobs,
        megabufSize: MILKDROP_MEGABUF_SIZE,
        gmegabufSize: MILKDROP_GMEGABUF_SIZE,
        windowSize: BUFFER_WRITE_WINDOW,
      },
    )) as {
      error?: string;
      results?: Array<{
        seed: number;
        state?: number[];
        megabuf?: number[];
        gmegabuf?: number[];
        error?: string;
      }>;
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
      let failed = false;
      for (const [fieldIndex, key] of job.fieldKeys.entries()) {
        if (key === 'rand_state' || key === 'pi' || key === 'e') continue;
        if (!VARS.includes(key)) continue; // only program-written vars matter
        const cpuValue = Math.fround(cpu[key] ?? 0);
        const gpuValue = gpu.state[fieldIndex] as number;
        if (!closeEnough(cpuValue, gpuValue)) {
          failures.push(
            `seed ${job.seed}: ${key} cpu=${cpuValue} gpu=${gpuValue}\n  ${job.lines.join('\n  ')}`,
          );
          failed = true;
          break;
        }
      }
      if (failed) continue;
      // Guest-memory contents: the write window must match slot-for-slot.
      const cpuBuffers = cpuBufferResults[index] as {
        megabuf: number[];
        gmegabuf: number[];
      };
      for (const [bufferKey, gpuBuffer] of [
        ['megabuf', gpu.megabuf],
        ['gmegabuf', gpu.gmegabuf],
      ] as const) {
        if (!gpuBuffer) continue;
        const cpuBuffer = cpuBuffers[bufferKey];
        for (let slot = 0; slot < cpuBuffer.length; slot++) {
          const cpuValue = cpuBuffer[slot] as number;
          const gpuValue = gpuBuffer[slot] as number;
          if (!closeEnough(cpuValue, gpuValue)) {
            failures.push(
              `seed ${job.seed}: ${bufferKey}[${slot}] cpu=${cpuValue} gpu=${gpuValue}\n  ${job.lines.join('\n  ')}`,
            );
            break;
          }
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
