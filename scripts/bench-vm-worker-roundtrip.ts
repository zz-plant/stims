/**
 * Measures whether per-frame VM state can cross a worker boundary cheaply
 * enough to justify Phase 2 of docs/architecture/vm-worker-isolation.md.
 *
 * The gating question there: a frame's canonical state is the megabuf and
 * gmegabuf (1,048,576 f32 each = 4 MiB apiece), plus the state/registers maps.
 * Copying that across a worker boundary every frame may cost more than the
 * main-thread stall it removes. This harness answers it with numbers:
 *
 *   - `structuredClone` of the payload (serialization cost alone)
 *   - a real worker round trip (postMessage out, echo back), the copy path
 *   - a SharedArrayBuffer round trip (zero-copy, needs COOP/COEP)
 *   - a "dirty-range" variant (only the slice a frame touched)
 *   - the in-process per-frame `step()` for reference
 *
 *   bun run bench:vm-worker-roundtrip
 *   bun run bench:vm-worker-roundtrip -- --iterations 300
 *
 * Reports median/p95 milliseconds. A frame budget at 60 fps is 16.67 ms.
 */
import { Worker } from 'node:worker_threads';
import { compileMilkdropPresetSource } from '../packages/milkdrop-toolchain/src/compiler.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';

const args = process.argv.slice(2);
function flag(name: string, fallback: number) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
  return fallback;
}
const ITERATIONS = flag('iterations', 120);
const MEGABUF = 1_048_576;

type Stats = { median: number; p95: number; mean: number };

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    median: at(0.5),
    p95: at(0.95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

function makeState(): Record<string, number> {
  const state: Record<string, number> = {};
  // Roughly the shape a VM frame carries: built-ins + user vars.
  for (let i = 0; i < 160; i += 1) state[`var${i}`] = i * 0.5;
  return state;
}

async function measure(
  fn: () => Promise<void> | void,
  iterations: number,
): Promise<Stats> {
  const samples: number[] = [];
  // Warm up.
  for (let i = 0; i < 10; i += 1) await fn();
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

const echoSource = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (m) => parentPort.postMessage(m));
`;

function makeEchoWorker(): Worker {
  return new Worker(echoSource, { eval: true });
}

function roundTrip(worker: Worker, payload: unknown): Promise<void> {
  return new Promise((resolve) => {
    worker.once('message', () => resolve());
    worker.postMessage(payload);
  });
}

async function main() {
  const state = makeState();
  const megabuf = new Float32Array(MEGABUF);
  const gmegabuf = new Float32Array(MEGABUF);
  for (let i = 0; i < MEGABUF; i += 1) {
    megabuf[i] = Math.sin(i * 0.01);
    gmegabuf[i] = Math.cos(i * 0.01);
  }

  const fullCopyPayload = { state, registers: state, megabuf, gmegabuf };
  const megabufOnly = { megabuf };
  const dirty = { megabuf: megabuf.subarray(0, 4096) }; // 16 KiB touched slice

  const cloneFull = await measure(() => {
    structuredClone(fullCopyPayload);
  }, ITERATIONS);

  const workerCopy = makeEchoWorker();
  const fullRoundTrip = await measure(
    () => roundTrip(workerCopy, fullCopyPayload),
    ITERATIONS,
  );
  const megaOnlyRoundTrip = await measure(
    () => roundTrip(workerCopy, megabufOnly),
    ITERATIONS,
  );
  const dirtyRoundTrip = await measure(
    () => roundTrip(workerCopy, dirty),
    ITERATIONS,
  );
  await workerCopy.terminate();

  // SharedArrayBuffer: zero-copy. The worker reads/writes the same memory.
  const shared = new SharedArrayBuffer(MEGABUF * 4);
  const sharedView = new Float32Array(shared);
  sharedView.set(megabuf);
  const workerShared = makeEchoWorker();
  const sharedRoundTrip = await measure(
    () => roundTrip(workerShared, { megabuf: shared }),
    ITERATIONS,
  );
  await workerShared.terminate();

  // In-process reference: a real per-frame step.
  const raw = `title=Bench\nper_frame_1=q1=q1+1; q2=sin(q1); megabuf(0)=q2;\n`;
  const preset = compileMilkdropPresetSource(raw, { id: 'bench' });
  const vm = createMilkdropVM(preset);
  const signals = {
    time: 0,
    frame: 0,
    fps: 60,
    bass: 0.5,
    mid: 0.5,
    treb: 0.5,
    bass_att: 0.5,
    mid_att: 0.5,
    treb_att: 0.5,
    vol: 0.5,
    vol_att: 0.5,
    beat: 0,
    frequencyData: new Uint8Array(512),
    waveformData: new Uint8Array(512),
  } as never;
  let frame = 0;
  const inProcess = await measure(() => {
    (signals as { time: number }).time = frame * 0.016;
    (signals as { frame: number }).frame = frame;
    frame += 1;
    vm.step(signals);
  }, ITERATIONS);

  const fmt = (s: Stats) =>
    `${s.median.toFixed(3)} ms (p95 ${s.p95.toFixed(3)})`;
  console.log('Per-frame VM worker-boundary cost\n');
  console.log(`iterations: ${ITERATIONS}, frame budget @60fps: 16.67 ms\n`);
  console.log(`structuredClone full state:      ${fmt(cloneFull)}`);
  console.log(`worker round trip, full state:   ${fmt(fullRoundTrip)}`);
  console.log(`worker round trip, megabuf only: ${fmt(megaOnlyRoundTrip)}`);
  console.log(`worker round trip, dirty 16 KiB: ${fmt(dirtyRoundTrip)}`);
  console.log(`worker round trip, SharedArray:  ${fmt(sharedRoundTrip)}`);
  console.log(`in-process per-frame step:       ${fmt(inProcess)}`);
  console.log('');
  if (fullRoundTrip.median > inProcess.median * 2) {
    console.log(
      'Verdict: copy-based per-frame isolation costs more than the work it ' +
        'offloads. Phase 2 needs SharedArrayBuffer (COOP/COEP) or dirty-range ' +
        'transfer, not a full-state copy.',
    );
  } else {
    console.log(
      'Verdict: full-state copy is within range; Phase 2 may be viable.',
    );
  }
}

await main();
