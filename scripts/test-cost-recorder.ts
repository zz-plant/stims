/**
 * Test cost recorder: a `bun test` preload that logs each test's CPU time, its
 * subprocesses' CPU time and its wall time, one JSON line per test.
 *
 * Wall time is what a timeout measures, but it stretches with machine load:
 * a test that takes 1.5 s alone took 22 s in a gate at load 212 (#1476). CPU
 * time barely moves with load, so it says what a test costs on any machine at
 * any moment, and `test:budget` predicts the wall time from it. A test that
 * shells out (git, a nested `bun`) spends its CPU in children, which
 * `process.cpuUsage()` cannot see; `getrusage(RUSAGE_CHILDREN)` counts every
 * child the process has waited for, so the difference across a test is the
 * CPU its subprocesses burned.
 *
 * It does nothing unless STIMS_TEST_COST_DIR names a directory, and writes
 * `<pid>.jsonl` there so parallel workers never share a file. Hooks receive no
 * test name, so each line carries the file (`Bun.main`, which bun sets to the
 * running test file) and the test's position in it; `test:budget` pairs that
 * with the junit report, where tests appear in the order they ran.
 *
 * A file's imports and beforeAll hooks run before its first test and belong
 * to no test, yet they were 71 s of a 166 s gate. Each file's first record
 * therefore also carries `setupCpuMs`: the process's CPU since the previous
 * file's last test, or since this module loaded. Under `--parallel` bun gives
 * every file a fresh global realm and loads the preloads again, so there the
 * module's state starts over per file while process CPU keeps counting.
 */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { afterEach, beforeEach } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const COST_DIR = process.env.STIMS_TEST_COST_DIR;

export type TestCostRecord = {
  /** The test file, relative to the directory `bun test` ran in. */
  file: string;
  /** Zero-based position among the tests of `file` that ran. */
  index: number;
  selfCpuMs: number;
  childCpuMs: number;
  wallMs: number;
  /** On a file's first test only: CPU spent loading the file and its hooks. */
  setupCpuMs?: number;
};

const cpuMs = (usage: NodeJS.CpuUsage) => (usage.user + usage.system) / 1000;

const RUSAGE_CHILDREN = -1;

/** CPU time of every waited-for child, in ms, or null where libc is absent. */
function childCpuReader(): (() => number) | null {
  try {
    const libc = dlopen(
      process.platform === 'darwin' ? 'libc.dylib' : 'libc.so.6',
      { getrusage: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } },
    );
    // struct rusage opens with ru_utime and ru_stime: two 16-byte timevals
    // of seconds then microseconds on both 64-bit macOS and Linux.
    const usage = new BigInt64Array(18);
    const view = new DataView(usage.buffer);
    const timeval = (offset: number) =>
      Number(view.getBigInt64(offset, true)) * 1000 +
      view.getInt32(offset + 8, true) / 1000;
    return () => {
      libc.symbols.getrusage(RUSAGE_CHILDREN, ptr(usage));
      return timeval(0) + timeval(16);
    };
  } catch {
    return null;
  }
}

if (COST_DIR) {
  const childCpu = childCpuReader() ?? (() => 0);
  const out = join(COST_DIR, `${process.pid}.jsonl`);
  const seen = new Map<string, number>();
  let lastTestEndCpuMs = cpuMs(process.cpuUsage());
  let started: {
    cpu: NodeJS.CpuUsage;
    childMs: number;
    wall: number;
    setupCpuMs?: number;
  } | null = null;

  beforeEach(() => {
    const cpu = process.cpuUsage();
    started = {
      cpu,
      childMs: childCpu(),
      wall: performance.now(),
      setupCpuMs: seen.has(Bun.main)
        ? undefined
        : cpuMs(cpu) - lastTestEndCpuMs,
    };
  });

  afterEach(() => {
    if (!started) return;
    const now = process.cpuUsage();
    const file = relative(process.cwd(), Bun.main);
    const index = seen.get(Bun.main) ?? 0;
    seen.set(Bun.main, index + 1);
    const record: TestCostRecord = {
      file,
      index,
      selfCpuMs: cpuMs(now) - cpuMs(started.cpu),
      childCpuMs: Math.max(0, childCpu() - started.childMs),
      wallMs: performance.now() - started.wall,
      ...(started.setupCpuMs === undefined
        ? {}
        : { setupCpuMs: started.setupCpuMs }),
    };
    appendFileSync(out, `${JSON.stringify(record)}\n`);
    lastTestEndCpuMs = cpuMs(process.cpuUsage());
    started = null;
  });
}
