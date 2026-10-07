/**
 * Renders docs/governor-trace-{light,dark}.svg from a real run of the
 * governor against a synthetic full-field strobe, so the README's picture of
 * what the governor does is produced by the governor and cannot drift from
 * it.
 *
 *   bun run figure:svg
 *
 * The strobe flips between 0.02 and 0.95 every three frames at 60 Hz: ten
 * flashes a second, more than three times the WCAG limit. The governed trace
 * is what the viewer sees once the controller's closed loop applies the
 * governor's luminance scale to the next frame, which is exactly what
 * controller.ts does with a real canvas.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeFlashTimeline,
  createFlashGovernor,
  RECOMMENDED_GRID,
} from '../src/index.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const FRAME_MS = 1000 / 60;
const FRAMES = 360;
const GRID = RECOMMENDED_GRID;

export type Trace = {
  raw: number[];
  governed: number[];
  hold: number[];
  rawPeak: number;
  governedPeak: number;
};

export function runTrace(): Trace {
  const governor = createFlashGovernor();
  const tiles = new Float32Array(GRID * GRID);
  const raw: number[] = [];
  const governed: number[] = [];
  const hold: number[] = [];
  let scale = 1;
  for (let f = 0; f < FRAMES; f += 1) {
    const luminance = Math.floor(f / 3) % 2 === 1 ? 0.95 : 0.02;
    raw.push(luminance);
    // The viewer sees the frame through the mitigation already in force,
    // and the governor is told that scale rather than handed the product.
    governed.push(luminance * scale);
    tiles.fill(luminance);
    const decision = governor.sample(f * FRAME_MS, tiles, GRID, GRID, {
      viewScale: scale,
    });
    scale = decision.luminanceScale;
    hold.push(decision.hold);
  }
  const score = (series: number[]) =>
    analyzeFlashTimeline({
      frames: series.map((v) => new Array(GRID * GRID).fill(v)),
      deltaMs: FRAME_MS,
      cols: GRID,
      rows: GRID,
    }).peakFlashesPerSecond;
  return {
    raw,
    governed,
    hold,
    rawPeak: score(raw),
    governedPeak: score(governed),
  };
}

type Theme = {
  name: 'light' | 'dark';
  background: string;
  text: string;
  muted: string;
  grid: string;
  raw: string;
  governed: string;
  hold: string;
};

const THEMES: Theme[] = [
  {
    name: 'light',
    background: '#ffffff',
    text: '#1f2328',
    muted: '#656d76',
    grid: '#d0d7de',
    raw: '#c9a227',
    governed: '#3b6ea5',
    hold: '#b35c44',
  },
  {
    name: 'dark',
    background: '#0d1117',
    text: '#e6edf3',
    muted: '#8b949e',
    grid: '#30363d',
    raw: '#e3c25a',
    governed: '#6ea0d8',
    hold: '#e0876b',
  },
];

function polyline(
  series: number[],
  x: (i: number) => number,
  y: (v: number) => number,
) {
  return series
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
}

export function renderFigure(trace: Trace, theme: Theme): string {
  const width = 720;
  const height = 300;
  const left = 48;
  const right = 16;
  const top = 40;
  const bottom = 40;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (i: number) => left + (i / (FRAMES - 1)) * plotW;
  const y = (v: number) => top + (1 - v) * plotH;
  const seconds = FRAMES / 60;
  const ticks = Array.from({ length: seconds + 1 }, (_, s) => s);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="12" role="img" aria-label="A full-field strobe at ${trace.rawPeak} flashes per second, and the same strobe as seen through the governor at ${trace.governedPeak} flashes per second">
<rect width="${width}" height="${height}" fill="${theme.background}" rx="8"/>
<text x="${left}" y="22" fill="${theme.text}" font-weight="600" font-size="14">Full-field strobe, 60 Hz, ${seconds} s</text>
<text x="${width - right}" y="22" text-anchor="end" fill="${theme.muted}">raw ${trace.rawPeak} flashes/s · governed ${trace.governedPeak} flashes/s · WCAG limit 3</text>
${[0, 0.25, 0.5, 0.75, 1]
  .map(
    (v) =>
      `<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${width - right}" y2="${y(v).toFixed(1)}" stroke="${theme.grid}" stroke-dasharray="2 4"/><text x="${left - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="${theme.muted}">${v.toFixed(2)}</text>`,
  )
  .join('\n')}
${ticks
  .map(
    (s) =>
      `<text x="${x(s * 60 > FRAMES - 1 ? FRAMES - 1 : s * 60).toFixed(1)}" y="${height - bottom + 18}" text-anchor="middle" fill="${theme.muted}">${s}s</text>`,
  )
  .join('\n')}
<text x="${left - 8}" y="${top - 10}" text-anchor="end" fill="${theme.muted}" font-size="11">luminance</text>
<polyline fill="none" stroke="${theme.raw}" stroke-width="1.25" opacity="0.9" points="${polyline(trace.raw, x, y)}"/>
<polyline fill="none" stroke="${theme.governed}" stroke-width="2" points="${polyline(trace.governed, x, y)}"/>
<polyline fill="none" stroke="${theme.hold}" stroke-width="1.5" stroke-dasharray="5 3" points="${polyline(trace.hold, x, y)}"/>
<g transform="translate(${left + 8}, ${height - 14})">
  <line x1="0" y1="-4" x2="18" y2="-4" stroke="${theme.raw}" stroke-width="1.5"/><text x="24" y="0" fill="${theme.text}">raw frames</text>
  <line x1="110" y1="-4" x2="128" y2="-4" stroke="${theme.governed}" stroke-width="2"/><text x="134" y="0" fill="${theme.text}">what the viewer sees</text>
  <line x1="290" y1="-4" x2="308" y2="-4" stroke="${theme.hold}" stroke-width="1.5" stroke-dasharray="5 3"/><text x="314" y="0" fill="${theme.text}">governor hold (0 = off)</text>
</g>
</svg>
`;
}

if (import.meta.main) {
  const trace = runTrace();
  console.log(
    `raw ${trace.rawPeak} flashes/s, governed ${trace.governedPeak} flashes/s, final hold ${trace.hold[trace.hold.length - 1]?.toFixed(3)}`,
  );
  for (const theme of THEMES) {
    const path = join(OUT_DIR, `governor-trace-${theme.name}.svg`);
    writeFileSync(path, renderFigure(trace, theme));
    console.log(`wrote ${path}`);
  }
}
