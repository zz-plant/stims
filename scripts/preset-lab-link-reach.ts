#!/usr/bin/env bun
/**
 * Preset lab — share-link reach over the bundled catalog (no browser).
 *
 * Measures how far a `#code=` share link can actually reach: for every
 * bundled preset, the length of today's raw-encoded remix link against the
 * sharing budget (MAX_REMIX_URL_LENGTH), versus the same source
 * deflate-raw-compressed and base64url-encoded. Reports raw fit %, compressed
 * fit %, median/p95 link lengths, and the presets no encoding can fit, so
 * the "Share-link reach" roadmap item is decided on measured numbers:
 *
 *   bun run lab:link-reach              # human summary, JSON to --out
 *   bun run lab:link-reach -- --json    # JSON to stdout instead
 *
 * The compressed numbers measure the `z1~<base64url>` payload the shipped
 * encoder now falls back to for over-budget drafts
 * (src/js/frontend/url-state.ts) — the measurement is what justified
 * shipping it, and re-running keeps the shipped budget honest as the
 * catalog grows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  buildPresetCodeHash,
  MAX_REMIX_URL_LENGTH,
} from '../src/js/frontend/url-state.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

const DEFAULT_OUTPUT_DIR = './scratch/preset-lab';

/** A third payload shape, chosen so it cannot collide with either of the
 * two the decoder reads today (bare Latin-1 base64, `u1~` UTF-8 base64).
 * `z` is not in the base64 alphabet and `~` survives encodeURIComponent. */
const MEASURED_COMPRESSED_PREFIX = 'z1~';

type PresetReach = {
  id: string;
  file: string;
  /** The `.milk` source text as the app loads it (UTF-8). */
  sourceChars: number;
  rawLinkLength: number;
  rawFits: boolean;
  compressedLinkLength: number;
  compressedFits: boolean;
};

export type LinkReachReport = {
  version: 1;
  generatedAt: string;
  /** The product's sharing budget, imported from the shipped encoder. */
  budget: number;
  /** The link shape measured: deep link to the preset plus the code hash. */
  baseUrl: string;
  presetCount: number;
  raw: {
    fitCount: number;
    fitPct: number;
    medianLinkLength: number;
    p95LinkLength: number;
    maxLinkLength: number;
  };
  compressed: {
    fitCount: number;
    fitPct: number;
    medianLinkLength: number;
    p95LinkLength: number;
    maxLinkLength: number;
  };
  /** Presets the raw encoding cannot fit but compression could carry. */
  compressionRescues: number;
  /** Presets no measured encoding fits under the budget. */
  failBoth: Array<
    Pick<
      PresetReach,
      'id' | 'sourceChars' | 'rawLinkLength' | 'compressedLinkLength'
    >
  >;
  /** The ten longest raw links, the presets that define the ceiling. */
  biggest: Array<
    Pick<
      PresetReach,
      'id' | 'sourceChars' | 'rawLinkLength' | 'compressedLinkLength'
    >
  >;
  presets: PresetReach[];
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

/** Nearest-rank percentile over a sorted list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((fraction / 100) * sorted.length));
  return sorted[rank - 1] ?? sorted[sorted.length - 1] ?? 0;
}

/**
 * The compressed link the measured encoding would produce, byte-for-byte the
 * way buildPresetCodeHash produces the raw one: payload embedded in a
 * `#code=` hash, left unescaped (base64url and `z1~` are all
 * encodeURIComponent-safe characters, so no percent-escaping would occur).
 */
function compressedLinkLength(baseUrl: string, raw: string): number {
  const bytes = new TextEncoder().encode(raw);
  const deflated = deflateRawSync(bytes);
  const payload =
    MEASURED_COMPRESSED_PREFIX +
    Buffer.from(deflated).toString('base64url').replace(/=+$/u, '');
  return baseUrl.length + '#code='.length + payload.length;
}

export function measurePresetReach({
  id,
  file,
  raw,
}: {
  id: string;
  file: string;
  raw: string;
}): PresetReach {
  const baseUrl = `https://toil.fyi/?preset=${id}`;
  // buildPresetCodeHash returns the percent-escaped `#code=` fragment the
  // shipped encoder writes; appending it to the deep link is exactly what
  // buildRemixShareUrl does before the budget check rejects the result.
  const hash = buildPresetCodeHash(raw);
  if (!hash) {
    throw new Error(`could not encode ${id} into a share hash`);
  }
  const rawLinkLength = baseUrl.length + hash.length;
  const compressedLength = compressedLinkLength(baseUrl, raw);
  return {
    id,
    file,
    sourceChars: raw.length,
    rawLinkLength,
    rawFits: rawLinkLength <= MAX_REMIX_URL_LENGTH,
    compressedLinkLength: compressedLength,
    compressedFits: compressedLength <= MAX_REMIX_URL_LENGTH,
  };
}

export function summarizeReach(presets: PresetReach[]): LinkReachReport {
  const rawSorted = [...presets]
    .map((preset) => preset.rawLinkLength)
    .sort((a, b) => a - b);
  const compressedSorted = [...presets]
    .map((preset) => preset.compressedLinkLength)
    .sort((a, b) => a - b);
  const rawFitCount = presets.filter((preset) => preset.rawFits).length;
  const compressedFitCount = presets.filter(
    (preset) => preset.compressedFits,
  ).length;
  const failBoth = presets
    .filter((preset) => !preset.rawFits && !preset.compressedFits)
    .map((preset) => ({
      id: preset.id,
      sourceChars: preset.sourceChars,
      rawLinkLength: preset.rawLinkLength,
      compressedLinkLength: preset.compressedLinkLength,
    }));
  const biggest = [...presets]
    .sort((a, b) => b.rawLinkLength - a.rawLinkLength)
    .slice(0, 10)
    .map((preset) => ({
      id: preset.id,
      sourceChars: preset.sourceChars,
      rawLinkLength: preset.rawLinkLength,
      compressedLinkLength: preset.compressedLinkLength,
    }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    budget: MAX_REMIX_URL_LENGTH,
    baseUrl: 'https://toil.fyi/?preset=<id>',
    presetCount: presets.length,
    raw: {
      fitCount: rawFitCount,
      fitPct: presets.length > 0 ? (100 * rawFitCount) / presets.length : 0,
      medianLinkLength: percentile(rawSorted, 50),
      p95LinkLength: percentile(rawSorted, 95),
      maxLinkLength: rawSorted[rawSorted.length - 1] ?? 0,
    },
    compressed: {
      fitCount: compressedFitCount,
      fitPct:
        presets.length > 0 ? (100 * compressedFitCount) / presets.length : 0,
      medianLinkLength: percentile(compressedSorted, 50),
      p95LinkLength: percentile(compressedSorted, 95),
      maxLinkLength: compressedSorted[compressedSorted.length - 1] ?? 0,
    },
    compressionRescues: presets.filter(
      (preset) => !preset.rawFits && preset.compressedFits,
    ).length,
    failBoth,
    biggest,
    presets,
  };
}

export function formatReachReportText(report: LinkReachReport): string {
  const lines: string[] = [];
  lines.push('# Share-link reach — bundled catalog');
  lines.push('');
  lines.push(
    `Budget: ${report.budget} characters per link (MAX_REMIX_URL_LENGTH), link shape ${report.baseUrl}.`,
  );
  lines.push(
    `Presets measured: ${report.presetCount} (bundled .milk sources, read as the app loads them).`,
  );
  lines.push('');
  lines.push('| encoding | fit | fit % | median | p95 | max |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  lines.push(
    `| raw (today) | ${report.raw.fitCount}/${report.presetCount} | ${report.raw.fitPct.toFixed(1)}% | ${report.raw.medianLinkLength} | ${report.raw.p95LinkLength} | ${report.raw.maxLinkLength} |`,
  );
  lines.push(
    `| deflate-raw + base64url | ${report.compressed.fitCount}/${report.presetCount} | ${report.compressed.fitPct.toFixed(1)}% | ${report.compressed.medianLinkLength} | ${report.compressed.p95LinkLength} | ${report.compressed.maxLinkLength} |`,
  );
  lines.push('');
  lines.push(
    `- Presets only compression can carry: ${report.compressionRescues}.`,
  );
  lines.push(`- Presets no encoding fits: ${report.failBoth.length}.`);
  if (report.failBoth.length > 0) {
    for (const preset of report.failBoth.slice(0, 20)) {
      lines.push(
        `  - ${preset.id}: raw ${preset.rawLinkLength}, compressed ${preset.compressedLinkLength}`,
      );
    }
    if (report.failBoth.length > 20) {
      lines.push(`  - … and ${report.failBoth.length - 20} more (see JSON).`);
    }
  }
  lines.push('');
  lines.push('## Longest raw links');
  for (const preset of report.biggest) {
    lines.push(
      `- ${preset.id}: raw ${preset.rawLinkLength}, compressed ${preset.compressedLinkLength} (${preset.sourceChars} source chars)`,
    );
  }
  return lines.join('\n');
}

function parseArgs(argv: string[]) {
  return {
    outputDir: path.resolve(
      argv.includes('--out')
        ? (argv[argv.indexOf('--out') + 1] ?? DEFAULT_OUTPUT_DIR)
        : DEFAULT_OUTPUT_DIR,
    ),
    json: argv.includes('--json'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromScript();
  const entries = loadCatalogEntries(repoRoot);
  const presets: PresetReach[] = [];
  let skipped = 0;
  for (const [id, entry] of entries) {
    const filePath = path.join(
      repoRoot,
      'public',
      entry.file.replace(/^\//u, ''),
    );
    try {
      // UTF-8, matching the bundled loader the share encoder receives its
      // text from (response.text()).
      const raw = fs.readFileSync(filePath, 'utf8');
      presets.push(measurePresetReach({ id, file: entry.file, raw }));
    } catch {
      skipped += 1;
    }
  }
  if (presets.length === 0) {
    console.error('No bundled preset sources could be read.');
    process.exit(1);
  }

  const report = summarizeReach(presets);
  fs.mkdirSync(options.outputDir, { recursive: true });
  const reportPath = path.join(options.outputDir, 'link-reach.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReachReportText(report));
    console.log('');
    console.log(`Report written to ${reportPath}`);
  }
  if (skipped > 0) {
    console.warn(`Skipped ${skipped} catalog entries with unreadable files.`);
  }
}

if (import.meta.main) {
  await main();
}
