/**
 * Preset lab — static dataflow: which audio can reach each control and drawn program, read from the equations; labels the corpus and checks a dataset export against it.
 *
 *   bun run lab:dataflow -- --preset eos-ether
 *   bun run lab:dataflow -- --dataset output/dataset [--out report.json]
 *   bun run lab:dataflow -- --all [--out labels.json]
 *
 * With --preset it prints the preset's tier (driven, waveform-only, none; see
 * labelPresetAudio), the audio signals reaching each drawn program, and, for
 * every canonical column that preset's per-frame program writes, its kind
 * (constant, clockwork, audio, pointer), the audio signals it reads, and
 * whether it has memory (history) or feeds back on itself (accumulates).
 * See packages/milkdrop-toolchain/src/preset-dataflow.ts.
 *
 * With --all it labels every catalog preset (bundled and libraries) by how
 * audio reaches its image, with no rendering: through the equations (which
 * canonical columns, from which signals), through audio uniforms its shaders
 * read, or only through a drawn waveform. It then compares those labels with
 * a source-text search for audio names (what the quality score's staticAudio
 * used before it read these labels) and with the catalog's
 * collection:audio-reactive tag (curate-catalog-collections.ts, which sets it
 * from these labels; a disagreement means the catalog needs re-curating).
 *
 * With --dataset it compares the analysis with behaviour: for every preset
 * and canonical column in a lab:dataset export, the share of variance that
 * differs between the export's scenarios at the same frame (audioShare from
 * lab:vj-baseline). A column the analysis calls non-audio must be identical
 * on every scenario; any that is not is reported as a soundness violation,
 * because it means the analysis missed a way audio reaches the value.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MILKDROP_SIGNAL_NAME_ALIASES } from 'milkdrop-toolchain/src/compiler/shader-analysis-helpers.ts';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import type { MilkdropPresetIR } from 'milkdrop-toolchain/src/compiler-types.ts';
import {
  analyzePresetDataflow,
  type VariableDataflow,
} from 'milkdrop-toolchain/src/preset-dataflow.ts';
import { CANONICAL_VARIABLES } from './preset-lab-dataset.ts';
import { decodeNpy } from './preset-lab-map.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import { AUDIO_SHARE_MIN, audioShare } from './preset-lab-vj-baseline.ts';

type Kind = VariableDataflow['kind'];
const KINDS: readonly Kind[] = ['constant', 'clockwork', 'audio', 'pointer'];
/** Measured behaviour of one column across scenarios. */
type Observed = 'flat' | 'same on every song' | 'differs by song';
const OBSERVED: readonly Observed[] = [
  'flat',
  'same on every song',
  'differs by song',
];

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function analyzeCatalogPreset(
  catalog: ReturnType<typeof loadCatalogEntries>,
  id: string,
) {
  const entry = catalog.get(id);
  if (!entry) throw new Error(`Unknown preset id: ${id}`);
  const raw = fs.readFileSync(
    path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
    'latin1',
  );
  return analyzePresetDataflow(compileMilkdropPresetSource(raw, { id }).ir);
}

/** The audio uniforms a warp/comp shader can read: every identifier the
 * shader compiler maps to a runtime audio signal (the clock ones aside). */
const SHADER_AUDIO = new RegExp(
  `\\b(${Object.keys(MILKDROP_SIGNAL_NAME_ALIASES)
    .filter((name) => !['time', 'frame', 'progress', 'fps'].includes(name))
    .join('|')})\\b`,
  'giu',
);
/** A text search for audio names: the quality score's staticAudio before
 * these labels replaced it, kept to show what that search gets wrong. */
const SOURCE_AUDIO = /\b(bass|mid|treb|vol)(_att)?\b|\bbeat(_pulse)?\b/u;
/** Below this alpha the main waveform is not visibly drawn. */
const VISIBLE_WAVE_ALPHA = 0.01;

/**
 * How audio can reach a preset's image:
 * - `driven`: an equation makes a canonical column, the per-pixel mesh, or an
 *   enabled custom wave or shape follow the audio, or a shader reads an
 *   audio uniform.
 * - `waveform-only`: the only audio on screen is a drawn waveform (the main
 *   wave, or an enabled custom wave), whose shape is the audio itself.
 * - `none`: nothing drawn depends on the audio.
 */
export type AudioTier = 'driven' | 'waveform-only' | 'none';

export type PresetAudioLabel = {
  tier: AudioTier;
  /** Canonical columns whose value follows the audio, with their signals. */
  audioColumns: Record<string, string[]>;
  /** The audio columns that also carry memory: they depend on past frames'
   * audio (an accumulator, a smoothed value), not just the current one. */
  historyColumns: string[];
  /** Canonical columns that move, but identically on every song. */
  clockworkColumns: string[];
  /** Audio signals reaching the per-pixel mesh, enabled custom waves (beyond
   * the waveform samples they draw) and enabled custom shapes. */
  perPixelSignals: string[];
  waveSignals: string[];
  shapeSignals: string[];
  /** Audio uniforms read by the warp/comp shaders. */
  shaderSignals: string[];
  waveform: boolean;
  randomStreamFollowsAudio: boolean;
};

export function labelPresetAudio(ir: MilkdropPresetIR): PresetAudioLabel {
  const { variables, randomStreamFollowsAudio, drawnAudio } =
    analyzePresetDataflow(ir);
  const merged = (lists: string[][], drop: ReadonlySet<string> = new Set()) =>
    [...new Set(lists.flat())].filter((signal) => !drop.has(signal)).sort();
  const perPixelSignals = drawnAudio.perPixel;
  // a wave's own samples are its waveform, counted below, not a drive
  const waveSignals = merged(drawnAudio.waves, new Set(['value1', 'value2']));
  const shapeSignals = merged(drawnAudio.shapes);
  const audioColumns: Record<string, string[]> = {};
  const clockworkColumns: string[] = [];
  const historyColumns: string[] = [];
  for (const column of CANONICAL_VARIABLES) {
    const v = variables.get(column);
    if (v?.kind === 'audio') {
      audioColumns[column] = v.audio;
      if (v.history) historyColumns.push(column);
    } else if (v?.kind === 'clockwork') clockworkColumns.push(column);
  }
  const shaderText = [ir.shaderSource?.warp, ir.shaderSource?.comp]
    .filter((text): text is string => typeof text === 'string')
    .join('\n');
  const shaderSignals = [
    ...new Set(
      [...shaderText.matchAll(SHADER_AUDIO)].map((m) => m[0].toLowerCase()),
    ),
  ].sort();
  const waveAlpha = Number(ir.mainWave?.wave_a ?? 1);
  const waveform =
    waveAlpha >= VISIBLE_WAVE_ALPHA ||
    (variables.get('wave_a')?.kind ?? 'constant') !== 'constant' ||
    ir.customWaves.some((wave) => Number(wave.fields.enabled ?? 0) > 0);
  const driven =
    Object.keys(audioColumns).length > 0 ||
    perPixelSignals.length > 0 ||
    waveSignals.length > 0 ||
    shapeSignals.length > 0 ||
    shaderSignals.length > 0;
  return {
    tier: driven ? 'driven' : waveform ? 'waveform-only' : 'none',
    audioColumns,
    historyColumns,
    clockworkColumns,
    perPixelSignals,
    waveSignals,
    shapeSignals,
    shaderSignals,
    waveform,
    randomStreamFollowsAudio,
  };
}

/** Classify what a column did across scenarios: runs[i] is scenario i. */
export function observeColumn(runs: readonly Float64Array[]): Observed {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    for (const value of run) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!(max - min > 0)) return 'flat';
  return audioShare(runs) > 0 ? 'differs by song' : 'same on every song';
}

function printPreset(id: string) {
  const catalog = loadCatalogEntries(repoRoot);
  const entry = catalog.get(id);
  if (!entry) throw new Error(`Unknown preset id: ${id}`);
  const { ir } = compileMilkdropPresetSource(
    fs.readFileSync(
      path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
      'latin1',
    ),
    { id },
  );
  const { variables, randomStreamFollowsAudio } = analyzePresetDataflow(ir);
  const label = labelPresetAudio(ir);
  console.log(
    `${id}: ${label.tier}${randomStreamFollowsAudio ? '  (rand() stream follows the audio)' : ''}`,
  );
  const drawn: Array<[string, string[]]> = [
    ['per-pixel mesh', label.perPixelSignals],
    ['custom waves', label.waveSignals],
    ['custom shapes', label.shapeSignals],
    ['shaders', label.shaderSignals],
  ];
  for (const [what, signals] of drawn)
    if (signals.length)
      console.log(`  ${what.padEnd(18)} ${signals.join(' ')}`);
  if (label.waveform) console.log('  waveform           drawn');
  for (const column of CANONICAL_VARIABLES) {
    const v = variables.get(column);
    if (!v || v.kind === 'constant') continue;
    const flags = [
      v.accumulates ? 'accumulates' : v.history ? 'history' : '',
      v.random ? 'rand' : '',
      v.memory ? 'megabuf' : '',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${column.padEnd(18)} ${v.kind.padEnd(10)} ${v.audio.join(' ')}${flags ? `  [${flags}]` : ''}`,
    );
  }
}

function catalogTags(): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  const catalog = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'public', 'milkdrop-presets', 'catalog.json'),
      'utf8',
    ),
  ) as { presets: Array<{ id: string; tags?: string[] }> };
  for (const entry of catalog.presets) tags.set(entry.id, entry.tags ?? []);
  return tags;
}

function labelAll(outPath: string | undefined) {
  const catalog = loadCatalogEntries(repoRoot);
  const tags = catalogTags();
  const labels: Record<string, PresetAudioLabel> = {};
  const failed: string[] = [];
  const tiers = new Map<AudioTier, number>();
  // [tier][says audio?] for the text search and the catalog's tag
  const sourceScan = new Map<string, number>();
  const titleTag = new Map<string, number>();
  const sourceOnly: string[] = [];
  const columnCounts = new Map<string, number>();
  const signalCounts = new Map<string, number>();
  for (const [id, entry] of [...catalog].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const raw = fs.readFileSync(
      path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
      'latin1',
    );
    let label: PresetAudioLabel;
    try {
      label = labelPresetAudio(compileMilkdropPresetSource(raw, { id }).ir);
    } catch {
      failed.push(id);
      continue;
    }
    labels[id] = label;
    tiers.set(label.tier, (tiers.get(label.tier) ?? 0) + 1);
    const scan = SOURCE_AUDIO.test(raw);
    const scanKey = `${label.tier}|${scan}`;
    sourceScan.set(scanKey, (sourceScan.get(scanKey) ?? 0) + 1);
    if (scan && label.tier !== 'driven') sourceOnly.push(id);
    const presetTags = tags.get(id);
    if (presetTags) {
      const key = `${label.tier}|${presetTags.includes('collection:audio-reactive')}`;
      titleTag.set(key, (titleTag.get(key) ?? 0) + 1);
    }
    for (const [column, signals] of Object.entries(label.audioColumns)) {
      columnCounts.set(column, (columnCounts.get(column) ?? 0) + 1);
      for (const signal of signals)
        signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
    }
  }
  const total = Object.keys(labels).length;
  const tierOrder: readonly AudioTier[] = ['driven', 'waveform-only', 'none'];
  const pct = (n: number, of: number) =>
    `${n}`.padStart(5) +
    ` (${((100 * n) / Math.max(1, of)).toFixed(0)}%)`.padEnd(7);
  console.log(
    `Audio labels from the equations, ${total} presets${failed.length ? ` (${failed.length} failed to compile)` : ''}`,
  );
  for (const tier of tierOrder)
    console.log(`  ${tier.padEnd(14)}${pct(tiers.get(tier) ?? 0, total)}`);
  const top = (counts: Map<string, number>, n: number) =>
    [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => `${name} ${count}`)
      .join(', ');
  console.log(`  most-driven columns: ${top(columnCounts, 8)}`);
  console.log(`  most-read signals:   ${top(signalCounts, 8)}`);
  const crossTab = (title: string, counts: Map<string, number>) => {
    console.log(`\n${title}`);
    console.log(
      `  ${'labels'.padEnd(14)}${'says audio'.padStart(12)}${'says not'.padStart(12)}`,
    );
    for (const tier of tierOrder)
      console.log(
        `  ${tier.padEnd(14)}${String(counts.get(`${tier}|true`) ?? 0).padStart(12)}${String(counts.get(`${tier}|false`) ?? 0).padStart(12)}`,
      );
  };
  crossTab(
    'Text search for audio names (the old staticAudio) against the labels',
    sourceScan,
  );
  console.log(
    `  ${sourceOnly.length} preset(s) mention an audio signal that reaches nothing drawn, e.g. ${sourceOnly.slice(0, 5).join(', ')}`,
  );
  crossTab(
    'collection:audio-reactive tag (bundled catalog) against the labels',
    titleTag,
  );
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(
      path.resolve(outPath),
      JSON.stringify({ presets: labels, failed }, null, 2),
    );
  }
}

function checkDataset(datasetDir: string, outPath: string | undefined) {
  const root = path.resolve(datasetDir);
  const files = fs.readdirSync(root);
  const manifestFile = files.find((file) => /^manifest.*\.json$/.test(file));
  if (!manifestFile) throw new Error(`${root} has no manifest*.json`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, manifestFile), 'utf8'),
  ) as {
    states: { columns: string[] | string };
  };
  const columns = manifest.states.columns;
  if (!Array.isArray(columns))
    throw new Error('--dataset needs an export with the canonical columns');
  const rows = files
    .filter((file) => /^index.*\.jsonl$/.test(file))
    .flatMap((file) =>
      fs
        .readFileSync(path.join(root, file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              presetId: string;
              scenario: string;
              status: string;
              file: string | null;
            },
        ),
    );
  const byPreset = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (row.status !== 'ok' || !row.file) continue;
    const map = byPreset.get(row.presetId) ?? new Map<string, string>();
    map.set(row.scenario, row.file);
    byPreset.set(row.presetId, map);
  }
  const scenarios = [...new Set(rows.map((row) => row.scenario))].sort();
  const catalog = loadCatalogEntries(repoRoot);
  const table = new Map<string, number>();
  const violations: Array<{
    preset: string;
    column: string;
    kind: Kind;
    share: number;
  }> = [];
  let presets = 0;
  let randomFollowsAudio = 0;
  // Preset level, as lab:vj-baseline labels presets for its audio R²: a
  // preset is measured audio-reactive when some column is at least
  // AUDIO_SHARE_MIN audio-driven, clockwork otherwise.
  const presetTable = new Map<string, number>();
  const weakAudio: Array<{ preset: string; maxShare: number }> = [];
  for (const [id, scenarioFiles] of [...byPreset].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!scenarios.every((s) => scenarioFiles.has(s))) continue;
    const states = scenarios.map((s) => {
      const data = decodeNpy(
        new Uint8Array(
          fs.readFileSync(path.join(root, scenarioFiles.get(s) as string)),
        ),
      ).data;
      return Float64Array.from(data as ArrayLike<number>);
    });
    if (states.some((run) => run.some((value) => !Number.isFinite(value))))
      continue;
    const analysis = analyzeCatalogPreset(catalog, id);
    presets += 1;
    if (analysis.randomStreamFollowsAudio) randomFollowsAudio += 1;
    const frames = (states[0]?.length ?? 0) / columns.length;
    let maxShare = 0;
    let analysisAudio = false;
    columns.forEach((column, c) => {
      const runs = states.map((run) =>
        Float64Array.from(
          { length: frames },
          (_, f) => run[f * columns.length + c] as number,
        ),
      );
      const observed = observeColumn(runs);
      const kind = analysis.variables.get(column)?.kind ?? 'constant';
      if (kind === 'audio') analysisAudio = true;
      if (observed === 'differs by song')
        maxShare = Math.max(maxShare, audioShare(runs));
      table.set(
        `${kind}|${observed}`,
        (table.get(`${kind}|${observed}`) ?? 0) + 1,
      );
      if (kind !== 'audio' && observed === 'differs by song') {
        violations.push({ preset: id, column, kind, share: audioShare(runs) });
      }
    });
    const measured = maxShare >= AUDIO_SHARE_MIN;
    const presetKey = `${analysisAudio}|${measured}`;
    presetTable.set(presetKey, (presetTable.get(presetKey) ?? 0) + 1);
    if (analysisAudio && !measured) weakAudio.push({ preset: id, maxShare });
  }
  console.log(
    `Static dataflow vs ${scenarios.length} scenarios, ${presets} presets × ${columns.length} columns`,
  );
  console.log(
    `  ${'analysis says'.padEnd(12)}${OBSERVED.map((o) => o.padStart(20)).join('')}`,
  );
  for (const kind of KINDS) {
    console.log(
      `  ${kind.padEnd(12)}${OBSERVED.map((o) => String(table.get(`${kind}|${o}`) ?? 0).padStart(20)).join('')}`,
    );
  }
  const audioCells = OBSERVED.reduce(
    (sum, o) => sum + (table.get(`audio|${o}`) ?? 0),
    0,
  );
  const audioConfirmed = table.get('audio|differs by song') ?? 0;
  console.log(
    `  soundness: ${violations.length} column(s) differ by song although the analysis found no audio path`,
  );
  console.log(
    `  precision: ${audioConfirmed} of ${audioCells} audio-classified columns differ by song (the rest: a path the audio never exercised here)`,
  );
  console.log(
    `  rand() stream follows the audio in ${randomFollowsAudio} preset(s)`,
  );
  for (const v of violations.slice(0, 20)) {
    console.log(
      `    ${v.preset} ${v.column}: ${v.kind}, audio share ${v.share.toFixed(4)}`,
    );
  }
  const cell = (analysis: boolean, measured: boolean) =>
    String(presetTable.get(`${analysis}|${measured}`) ?? 0).padStart(22);
  console.log(
    `\nPresets: measured audio-reactive (some column ≥ ${AUDIO_SHARE_MIN} audio share) vs the analysis`,
  );
  console.log(
    `  ${''.padEnd(26)}${'measured reactive'.padStart(22)}${'measured clockwork'.padStart(22)}`,
  );
  console.log(
    `  ${'analysis: audio path'.padEnd(26)}${cell(true, true)}${cell(true, false)}`,
  );
  console.log(
    `  ${'analysis: no audio path'.padEnd(26)}${cell(false, true)}${cell(false, false)}`,
  );
  weakAudio.sort((a, b) => b.maxShare - a.maxShare);
  console.log(
    `  ${weakAudio.length} measured-clockwork preset(s) have an audio path whose effect stays under the threshold here, e.g. ${weakAudio
      .slice(0, 4)
      .map((w) => `${w.preset} (${w.maxShare.toFixed(3)})`)
      .join(', ')}`,
  );
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(
      path.resolve(outPath),
      JSON.stringify(
        {
          scenarios,
          presets,
          table: Object.fromEntries(table),
          randomFollowsAudio,
          violations,
          presets_by_label: Object.fromEntries(presetTable),
          weakAudio,
        },
        null,
        2,
      ),
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const preset = get('--preset');
  const dataset = get('--dataset');
  if (preset) printPreset(preset);
  else if (args.includes('--all')) labelAll(get('--out'));
  else if (dataset) checkDataset(dataset, get('--out'));
  else
    throw new Error(
      'Usage: bun run lab:dataflow -- --preset <id> | --all [--out labels.json] | --dataset <lab:dataset dir> [--out report.json]',
    );
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
