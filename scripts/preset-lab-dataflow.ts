/**
 * Preset lab — static dataflow: which inputs each per-frame variable can depend on, read from the equations, and checked against a dataset export.
 *
 *   bun run lab:dataflow -- --preset eos-ether
 *   bun run lab:dataflow -- --dataset output/dataset [--out report.json]
 *
 * With --preset it prints, for every canonical column that preset's
 * per-frame program writes, its kind (constant, clockwork, audio, pointer),
 * the audio signals it reads, and whether it has memory (history) or feeds
 * back on itself (accumulates). See src/js/milkdrop/preset-dataflow.ts.
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
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import {
  analyzePresetDataflow,
  type VariableDataflow,
} from '../src/js/milkdrop/preset-dataflow.ts';
import { CANONICAL_VARIABLES } from './preset-lab-dataset.ts';
import { decodeNpy } from './preset-lab-map.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import { audioShare } from './preset-lab-vj-baseline.ts';

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
  const { variables, randomStreamFollowsAudio } = analyzeCatalogPreset(
    catalog,
    id,
  );
  console.log(
    `${id}${randomStreamFollowsAudio ? '  (rand() stream follows the audio)' : ''}`,
  );
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
    columns.forEach((column, c) => {
      const runs = states.map((run) =>
        Float64Array.from(
          { length: frames },
          (_, f) => run[f * columns.length + c] as number,
        ),
      );
      const observed = observeColumn(runs);
      const kind = analysis.variables.get(column)?.kind ?? 'constant';
      table.set(
        `${kind}|${observed}`,
        (table.get(`${kind}|${observed}`) ?? 0) + 1,
      );
      if (kind !== 'audio' && observed === 'differs by song') {
        violations.push({ preset: id, column, kind, share: audioShare(runs) });
      }
    });
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
  else if (dataset) checkDataset(dataset, get('--out'));
  else
    throw new Error(
      'Usage: bun run lab:dataflow -- --preset <id> | --dataset <lab:dataset dir> [--out report.json]',
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
