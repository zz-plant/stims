/**
 * Lines up a burst run with what the page and the native tap saw.
 *
 * bun tools/latency-report.ts <bursts.jsonl> <shell.jsonl> [native.jsonl]
 *
 * Every stage is measured from the moment the burst was presented to the output
 * device, on the wall clock all the processes share. Prints p50/p95 for each.
 */
import { existsSync, readFileSync } from 'node:fs';

type Row = Record<string, number & string>;
const readLines = (path: string | undefined): Row[] =>
  path && existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

const [burstPath, shellPath, nativePath] = process.argv.slice(2);
const burstLines = readLines(burstPath);
const device = burstLines.find((line) => line.kind === 'device');
const bursts = burstLines.filter((line) => line.kind === 'burst');
if (!bursts.length) throw new Error('no bursts');
const from = bursts[0].presentedAt - 200;
const to = bursts[bursts.length - 1].presentedAt + 1500;

const ticks = readLines(shellPath).filter(
  (line) => line.kind === 'tick' && line.t >= from && line.t <= to + 3000,
);
const events = ticks.flatMap((tick) => tick.events as unknown as Row[]);
const native = readLines(nativePath);

const firstAfter = (rows: Row[], at: number, key = 't') =>
  rows.find((row) => row[key] >= at - 60 && row[key] <= at + 500) ?? null;

const stages = new Map<string, number[]>();
const add = (name: string, value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return;
  stages.set(name, [...(stages.get(name) ?? []), value]);
};
const byKind = (kind: string) => events.filter((event) => event.kind === kind);
const streamEvents = byKind('stream');
const chunkEvents = byKind('chunk');
const analysisEvents = byKind('analysis');

let matched = 0;
for (const burst of bursts) {
  const at = burst.presentedAt;
  const inputNative = firstAfter(native, at, 'callbackAt');
  const chunk = firstAfter(chunkEvents, at);
  const stream = firstAfter(streamEvents, at);
  const analysis = firstAfter(analysisEvents, at);
  if (analysis) matched += 1;
  add('tap input timestamp', inputNative ? inputNative.inputAt - at : null);
  add('native callback', inputNative ? inputNative.callbackAt - at : null);
  add('page handler (chunk)', chunk ? chunk.t - at : null);
  add('stream reaches a page worklet', stream ? stream.t - at : null);
  add('Stims analysis message', analysis ? analysis.t - at : null);
  add('next rAF after analysis', analysis?.raf ? analysis.raf - at : null);
  add(
    'rAF, from the speaker estimate',
    analysis?.raf ? analysis.raf - burst.speakerAt : null,
  );
  add(
    'analysis message to rAF',
    analysis?.raf ? analysis.raf - analysis.t : null,
  );
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};
console.log(`bursts ${bursts.length}, reached Stims ${matched}`);
if (device) console.log(`device ${JSON.stringify(device)}`);
const lastTick = ticks[ticks.length - 1] as unknown as Record<string, unknown>;
console.log(
  `contexts ${JSON.stringify(lastTick?.contexts)} native ${JSON.stringify(lastTick?.nativeAudio)}`,
);
console.log(
  `rafP50 ${lastTick?.rafP50} backend ${lastTick?.backend} energy ${lastTick?.energy}`,
);
for (const [name, values] of stages) {
  console.log(
    `${name.padEnd(34)} n=${String(values.length).padStart(3)}  p50 ${quantile(values, 0.5).toFixed(1).padStart(7)} ms  p95 ${quantile(values, 0.95).toFixed(1).padStart(7)} ms`,
  );
}
