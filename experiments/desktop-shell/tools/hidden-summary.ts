/**
 * Summarises raw rAF and timer rates per labelled state from a probe log.
 *
 * bun tools/hidden-summary.ts <shell.jsonl> [from-unix-ms]
 */
import { readFileSync } from 'node:fs';

const [path, fromArg] = process.argv.slice(2);
const from = Number(fromArg ?? 0);
type Tick = {
  kind: string;
  label: string | null;
  t: number;
  elapsedMs: number;
  raf: number;
  timerTicks: number;
  hidden: boolean;
  analysisMessages: number;
  presents: number;
  jsP50: number | null;
  jsP95: number | null;
  frameMs: number | null;
  cadenceMs: number | null;
  rafP50: number | null;
  rafP95: number | null;
  qualityStep: number | null;
  backend: string | null;
  appliedShader: string | null;
  presetId: string | null;
  visibility: string;
  renderingSuspended: boolean | null;
};
const median = (values: number[]) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : null;
};
const fixed = (value: number | null) =>
  value === null ? 'n/a' : value.toFixed(1);
const totals = new Map<
  string,
  {
    ms: number;
    raf: number;
    timers: number;
    analysis: number;
    presents: number;
    hidden: boolean;
    last: Tick;
    frameMs: number[];
    cadenceMs: number[];
    rafP50: number[];
    rafP95: number[];
    jsP50: number[];
    jsP95: number[];
  }
>();
for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
  const tick = JSON.parse(line) as Tick;
  if (tick.kind !== 'tick' || !tick.label || tick.t < from) continue;
  const total = totals.get(tick.label) ?? {
    ms: 0,
    raf: 0,
    timers: 0,
    analysis: 0,
    presents: 0,
    hidden: tick.hidden,
    last: tick,
    frameMs: [],
    cadenceMs: [],
    rafP50: [],
    rafP95: [],
    jsP50: [],
    jsP95: [],
  };
  total.ms += tick.elapsedMs;
  total.raf += tick.raf;
  total.timers += tick.timerTicks;
  total.analysis += tick.analysisMessages;
  total.presents += tick.presents ?? 0;
  total.hidden = tick.hidden;
  total.last = tick;
  if (tick.frameMs !== null) total.frameMs.push(tick.frameMs);
  if (tick.cadenceMs !== null) total.cadenceMs.push(tick.cadenceMs);
  if (tick.rafP50 !== null) total.rafP50.push(tick.rafP50);
  if (tick.rafP95 !== null) total.rafP95.push(tick.rafP95);
  if (tick.jsP50 != null) total.jsP50.push(tick.jsP50);
  if (tick.jsP95 != null) total.jsP95.push(tick.jsP95);
  totals.set(tick.label, total);
}
for (const [label, total] of totals) {
  const seconds = total.ms / 1000;
  console.log(
    `${label.padEnd(20)} ${seconds.toFixed(0).padStart(4)} s  rAF ${(total.raf / seconds).toFixed(1).padStart(6)}/s  drawn ${(total.presents / seconds).toFixed(1).padStart(6)}/s  timer ${(total.timers / seconds).toFixed(1).padStart(5)}/s  analysis ${(total.analysis / seconds).toFixed(1).padStart(5)}/s  hidden=${total.hidden} vis=${total.last.visibility} suspended=${total.last.renderingSuspended}  frame ${fixed(median(total.frameMs))} cadence ${fixed(median(total.cadenceMs))} rafP50 ${fixed(median(total.rafP50))} rafP95 ${fixed(median(total.rafP95))} js ${fixed(median(total.jsP50))}/${fixed(median(total.jsP95))} step ${total.last.qualityStep} ${total.last.backend}/${total.last.appliedShader} ${total.last.presetId}`,
  );
}
