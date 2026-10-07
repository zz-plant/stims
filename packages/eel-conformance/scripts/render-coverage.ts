/**
 * Renders docs/coverage-light.svg and docs/coverage-dark.svg: one bar per
 * section, pinned cases solid and provisional cases hatched, so the README's
 * picture of the corpus is generated from the corpus and cannot drift.
 *
 *   bun run coverage:svg
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEelCaseGroups } from '../src/index.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

type Theme = {
  name: 'light' | 'dark';
  background: string;
  text: string;
  muted: string;
  bar: string;
  hatch: string;
  grid: string;
};

const THEMES: Theme[] = [
  {
    name: 'light',
    background: '#ffffff',
    text: '#1f2328',
    muted: '#656d76',
    bar: '#3b6ea5',
    hatch: '#c9a227',
    grid: '#d0d7de',
  },
  {
    name: 'dark',
    background: '#0d1117',
    text: '#e6edf3',
    muted: '#8b949e',
    bar: '#6ea0d8',
    hatch: '#e3c25a',
    grid: '#30363d',
  },
];

function escapeXml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function renderCoverage(theme: Theme): string {
  const groups = loadEelCaseGroups();
  const rowHeight = 26;
  const labelWidth = 170;
  const chartWidth = 360;
  const padding = 16;
  const headerHeight = 34;
  const width = padding * 2 + labelWidth + chartWidth + 150;
  const height = headerHeight + groups.length * rowHeight + padding * 2;
  const max = Math.max(...groups.map((g) => g.cases.length));
  const scale = chartWidth / max;
  const total = groups.reduce((n, g) => n + g.cases.length, 0);
  const provisionalTotal = groups.reduce(
    (n, g) => n + g.cases.filter((c) => c.status === 'provisional').length,
    0,
  );

  const rows = groups
    .map((group, index) => {
      const y = headerHeight + padding + index * rowHeight;
      const provisional = group.cases.filter(
        (c) => c.status === 'provisional',
      ).length;
      const pinned = group.cases.length - provisional;
      const x0 = padding + labelWidth;
      const pinnedWidth = pinned * scale;
      const provisionalWidth = provisional * scale;
      return [
        `<text x="${padding + labelWidth - 10}" y="${y + 17}" text-anchor="end" fill="${theme.text}">${escapeXml(group.section)}</text>`,
        `<rect x="${x0}" y="${y + 4}" width="${pinnedWidth.toFixed(1)}" height="16" rx="2" fill="${theme.bar}"/>`,
        provisional > 0
          ? `<rect x="${(x0 + pinnedWidth).toFixed(1)}" y="${y + 4}" width="${provisionalWidth.toFixed(1)}" height="16" rx="2" fill="url(#hatch-${theme.name})" stroke="${theme.hatch}" stroke-width="1"/>`
          : '',
        `<text x="${(x0 + pinnedWidth + provisionalWidth + 8).toFixed(1)}" y="${y + 17}" fill="${theme.muted}">${group.cases.length}${provisional ? ` (${provisional} provisional)` : ''}</text>`,
      ].join('');
    })
    .join('\n');

  const gridLines = [0, 5, 10, 15]
    .filter((v) => v <= max)
    .map((v) => {
      const x = padding + labelWidth + v * scale;
      return `<line x1="${x.toFixed(1)}" y1="${headerHeight + padding - 4}" x2="${x.toFixed(1)}" y2="${height - padding}" stroke="${theme.grid}" stroke-dasharray="2 4"/><text x="${x.toFixed(1)}" y="${headerHeight + padding - 8}" text-anchor="middle" fill="${theme.muted}" font-size="11">${v}</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13" role="img" aria-label="EEL conformance corpus: ${total} cases across ${groups.length} sections, ${provisionalTotal} provisional">
<defs>
  <pattern id="hatch-${theme.name}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="${theme.background}"/>
    <line x1="0" y1="0" x2="0" y2="6" stroke="${theme.hatch}" stroke-width="2"/>
  </pattern>
</defs>
<rect width="${width}" height="${height}" fill="${theme.background}" rx="8"/>
<text x="${padding}" y="${padding + 8}" fill="${theme.text}" font-weight="600" font-size="14">${total} cases in ${groups.length} sections</text>
<text x="${width - padding}" y="${padding + 8}" text-anchor="end" fill="${theme.muted}" font-size="12">solid: pinned · hatched: provisional</text>
${gridLines}
${rows}
</svg>
`;
}

if (import.meta.main) {
  for (const theme of THEMES) {
    const path = join(OUT_DIR, `coverage-${theme.name}.svg`);
    writeFileSync(path, renderCoverage(theme));
    console.log(`wrote ${path}`);
  }
}
