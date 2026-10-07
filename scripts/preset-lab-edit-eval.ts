/**
 * Preset lab — edit eval: scores a preset-editing model (or a baseline) on directed edits derived from human remixes.
 *
 * lab:remix-pairs records what each human remix changed. This turns the
 * pairs into an evaluation any preset-editing model can be scored on, with
 * no model in this repo: export the tasks, have the model answer them
 * anywhere, then score its answers here.
 *
 *   bun run lab:edit-eval -- --export tasks.jsonl            # held-out tasks
 *   <run a model: one { taskId, source } line per task>
 *   bun run lab:edit-eval -- --score answers.jsonl [--out report.json]
 *   bun run lab:edit-eval -- --baseline copy|reference|restyle:<style>
 *
 * A task is a parent preset plus a directed instruction: the changes its
 * human remix made, stated as intents a model can act on ("increase decay",
 * "rewrite the per_frame equations", "enable custom shape 2"), at most
 * --max-items of them, equation changes first. Tasks come from the held-out
 * remix families (--split test, the default, or val/all) under the same
 * family split lab:dataset uses, so a model fine-tuned on the train split
 * never sees a task's family.
 *
 * An answer is scored on what it does, not how it is written:
 *   valid            compiles without errors and steps without throwing or
 *                    going non-finite
 *   instructions     share of the instruction items satisfied, judged on the
 *                    compiler's effective values (a direction for a setting,
 *                    a changed program for an equation block)
 *   changed          its per-frame behaviour differs from the parent's
 *   distance         behavioural distance from the parent and from the human
 *                    remix, in [0, 1] (mean normalised per-variable
 *                    difference over two audio scenarios)
 *   reactivity       strongest correlation between a visual variable and the
 *                    audio bands, minus the parent's
 *   audio edits      read from the equations (lab:dataflow), no rendering:
 *                    each preset's audio edges ("zoom ← bass", "shader ←
 *                    beat"), and of the edges the human remix added or
 *                    removed relative to the parent, the share the answer
 *                    reproduces (recall), plus how many it changed that the
 *                    remix did not (extra). Exact where the correlation is a
 *                    noisy two-scenario estimate.
 *
 * The baselines bracket a model: `copy` (the parent unchanged: valid, zero
 * instructions), `reference` (the human remix: the ceiling for
 * instructions, by construction), and `restyle:<style>` (the app's
 * one-click restyles, which ignore the instruction).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
  type PresetMutationStyle,
} from '../src/js/milkdrop/preset-mutations.ts';
import { labelPresetAudio } from './preset-lab-dataflow.ts';
import {
  assignFamilySplits,
  CANONICAL_VARIABLES,
  computeSignals,
  type DatasetSplit,
  runPresetForDataset,
  SIGNAL_COLUMNS,
} from './preset-lab-dataset.ts';
import type { PresetLabScenario } from './preset-lab-metrics.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import {
  diffPresets,
  listRemixPairs,
  splitPresetSource,
} from './preset-lab-remix-pairs.ts';
import { buildScenarioInputs, type FrameInputs } from './preset-lab-replay.ts';

const EVAL_SCENARIOS: readonly PresetLabScenario[] = ['bass-pulse', 'full-mix'];
const EVAL_FRAMES = 180;
const DEFAULT_MAX_ITEMS = 8;
/** Below this behavioural distance an answer counts as unchanged. */
const CHANGED_THRESHOLD = 0.01;
/** The audio bands reactivity is measured against. */
const BAND_SIGNALS = ['bass_att', 'mid_att', 'treb_att'] as const;

export type InstructionItem =
  | {
      kind: 'setting';
      key: string;
      direction: 'increase' | 'decrease' | 'enable' | 'disable';
      text: string;
    }
  | { kind: 'program'; block: string; text: string };

export type EditTask = {
  taskId: string;
  family: string;
  split: DatasetSplit;
  parentId: string;
  parentTitle: string;
  remixTitle: string;
  instruction: string;
  items: InstructionItem[];
  parentSource: string;
};

const BLOCK_NAMES: Record<string, string> = {
  per_frame: 'per-frame equations',
  per_frame_init: 'per-frame init equations',
  per_pixel: 'per-pixel (warp mesh) equations',
  warp: 'warp shader',
  comp: 'composite shader',
};

function describeBlock(block: string): string {
  const custom = /^(wave|shape)_(\d+)_(per_frame|per_point|init)$/.exec(block);
  if (custom) {
    const [, kind, n, part] = custom;
    const partName =
      part === 'per_point'
        ? 'per-point'
        : part === 'per_frame'
          ? 'per-frame'
          : 'init';
    return `custom ${kind} ${Number(n) + 1} ${partName} equations`;
  }
  return BLOCK_NAMES[block] ?? `${block} equations`;
}

function describeSetting(key: string): string {
  const custom = /^(wave|shape)code_(\d+)_(.+)$/.exec(key);
  if (custom) {
    const [, kind, n, field] = custom;
    return `custom ${kind} ${Number(n) + 1} ${field}`;
  }
  return key;
}

/**
 * The directed instruction for turning `parentSource` into `remixSource`:
 * equation blocks the remix rewrote first, then the settings it moved most
 * (by relative change), capped at `maxItems`.
 */
export function buildInstruction(
  parentSource: string,
  remixSource: string,
  maxItems = DEFAULT_MAX_ITEMS,
): InstructionItem[] {
  const diff = diffPresets(parentSource, remixSource);
  const items: InstructionItem[] = diff.programChanges.map((change) => ({
    kind: 'program',
    block: change.block,
    text:
      change.before === null
        ? `add ${describeBlock(change.block)}`
        : change.after === null
          ? `remove the ${describeBlock(change.block)}`
          : `rewrite the ${describeBlock(change.block)}`,
  }));
  const settings = diff.scalarChanges
    .filter(
      (change): change is { key: string; before: number; after: number } =>
        change.before !== null && change.after !== null,
    )
    .map((change) => {
      const isFlag =
        (change.before === 0 || change.before === 1) &&
        (change.after === 0 || change.after === 1) &&
        (/enabled|additive|usedots|thick|textured|invert|brighten|darken|solarize|wrap/.test(
          change.key,
        ) ||
          change.key.endsWith('_enabled'));
      const direction: 'increase' | 'decrease' | 'enable' | 'disable' = isFlag
        ? change.after === 1
          ? 'enable'
          : 'disable'
        : change.after > change.before
          ? 'increase'
          : 'decrease';
      const magnitude =
        Math.abs(change.after - change.before) /
        Math.max(Math.abs(change.before), Math.abs(change.after), 1e-6);
      return { change, direction, magnitude };
    })
    .sort((a, b) => b.magnitude - a.magnitude);
  for (const { change, direction } of settings) {
    const label = describeSetting(change.key);
    items.push({
      kind: 'setting',
      key: change.key,
      direction,
      text: `${direction} ${label}`,
    });
  }
  return items.slice(0, maxItems);
}

export function instructionText(
  parentTitle: string,
  items: readonly InstructionItem[],
): string {
  const steps = items.map((item, index) => `${index + 1}. ${item.text}`);
  return [
    `Edit the MilkDrop preset "${parentTitle}" below into a remix of it.`,
    'Make these changes and keep the rest of the preset as it is:',
    ...steps,
    'Answer with the complete edited .milk preset.',
  ].join('\n');
}

/** Whether `candidateSource` carries out each instruction item. */
export function checkInstructions(
  parentSource: string,
  candidateSource: string,
  items: readonly InstructionItem[],
): boolean[] {
  const parent = splitPresetSource(parentSource);
  let candidate: ReturnType<typeof splitPresetSource>;
  try {
    candidate = splitPresetSource(candidateSource);
  } catch {
    return items.map(() => false);
  }
  const normalize = (text: string | undefined) =>
    text === undefined ? undefined : text.replace(/\s+/g, '');
  return items.map((item) => {
    if (item.kind === 'program') {
      return (
        normalize(candidate.programs.get(item.block)) !==
        normalize(parent.programs.get(item.block))
      );
    }
    const before = parent.scalars.get(item.key);
    const after = candidate.scalars.get(item.key);
    if (after === undefined) return false;
    switch (item.direction) {
      case 'enable':
        return after === 1;
      case 'disable':
        return after === 0;
      case 'increase':
        return before !== undefined && after > before;
      case 'decrease':
        return before !== undefined && after < before;
    }
  });
}

type Behaviour = {
  valid: boolean;
  detail?: string;
  /** Per scenario, row-major [frames, CANONICAL_VARIABLES]. */
  states: Float32Array[];
  reactivity: number;
  /** Audio dependencies read from the equations, as "target←signal". */
  audioEdges: ReadonlySet<string>;
};

/** A preset's audio dependencies: canonical columns, the per-pixel mesh,
 * enabled custom waves and shapes, and shader uniforms, each with the audio
 * signals that reach it. */
export function audioEdges(
  ir: Parameters<typeof labelPresetAudio>[0],
): Set<string> {
  const label = labelPresetAudio(ir);
  const edges = new Set<string>();
  for (const [column, signals] of Object.entries(label.audioColumns))
    for (const signal of signals) edges.add(`${column}←${signal}`);
  const drawn: Array<[string, string[]]> = [
    ['per-pixel', label.perPixelSignals],
    ['waves', label.waveSignals],
    ['shapes', label.shapeSignals],
    ['shader', label.shaderSignals],
  ];
  for (const [target, signals] of drawn)
    for (const signal of signals) edges.add(`${target}←${signal}`);
  return edges;
}

/** Edges added (+) or removed (−) going from `before` to `after`. */
export function edgeEdit(
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): Set<string> {
  const edit = new Set<string>();
  for (const edge of after) if (!before.has(edge)) edit.add(`+${edge}`);
  for (const edge of before) if (!after.has(edge)) edit.add(`-${edge}`);
  return edit;
}

let scenarioCache: { inputs: FrameInputs[]; signals: Float32Array }[] | null =
  null;

function evalScenarios() {
  scenarioCache ??= EVAL_SCENARIOS.map((scenario) => {
    const inputs = buildScenarioInputs(scenario, EVAL_FRAMES);
    return { inputs, signals: computeSignals(inputs) };
  });
  return scenarioCache;
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i] as number;
    meanB += b[i] as number;
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] as number) - meanA;
    const db = (b[i] as number) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return varA > 1e-12 && varB > 1e-12 ? cov / Math.sqrt(varA * varB) : 0;
}

/** Runs a preset over the eval scenarios; invalid when it errors or goes NaN. */
export function measureBehaviour(source: string, id: string): Behaviour {
  const compiled = (() => {
    try {
      return compileMilkdropPresetSource(source, { id });
    } catch (error) {
      return error as Error;
    }
  })();
  if (compiled instanceof Error) {
    return {
      valid: false,
      detail: compiled.message,
      states: [],
      reactivity: 0,
      audioEdges: new Set(),
    };
  }
  const errors = compiled.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (errors.length) {
    return {
      valid: false,
      detail: `compile error: ${errors[0]?.code}`,
      states: [],
      reactivity: 0,
      audioEdges: new Set(),
    };
  }
  const width = CANONICAL_VARIABLES.length;
  const states: Float32Array[] = [];
  let reactivity = 0;
  for (const scenario of evalScenarios()) {
    const run = runPresetForDataset(
      source,
      id,
      scenario.inputs,
      CANONICAL_VARIABLES,
    );
    if (!run.states || (run.status !== 'ok' && run.status !== 'static')) {
      return {
        valid: false,
        detail: `${run.status}: ${run.detail ?? ''}`,
        states: [],
        reactivity: 0,
        audioEdges: new Set(),
      };
    }
    states.push(run.states);
    for (const band of BAND_SIGNALS) {
      const bandColumn = SIGNAL_COLUMNS.indexOf(band);
      const driver = Array.from(
        { length: EVAL_FRAMES },
        (_, frame) =>
          scenario.signals[frame * SIGNAL_COLUMNS.length + bandColumn] ?? 0,
      );
      for (let column = 0; column < width; column += 1) {
        const series = Array.from(
          { length: EVAL_FRAMES },
          (_, frame) => run.states?.[frame * width + column] ?? 0,
        );
        reactivity = Math.max(reactivity, Math.abs(pearson(series, driver)));
      }
    }
  }
  return {
    valid: true,
    states,
    reactivity,
    audioEdges: audioEdges(compiled.ir),
  };
}

/**
 * Behavioural distance in [0, 1]: per variable, the mean absolute
 * difference over frames scaled by the larger of the two series' magnitude
 * and spread, capped at 1, then averaged over variables that either preset
 * moves or sets away from the other.
 */
export function behaviourDistance(a: Behaviour, b: Behaviour): number {
  if (!a.valid || !b.valid) return 1;
  const width = CANONICAL_VARIABLES.length;
  let total = 0;
  let counted = 0;
  a.states.forEach((statesA, scenario) => {
    const statesB = b.states[scenario] as Float32Array;
    const frames = statesA.length / width;
    for (let column = 0; column < width; column += 1) {
      let sum = 0;
      let meanA = 0;
      let meanB = 0;
      let minA = Number.POSITIVE_INFINITY;
      let maxA = Number.NEGATIVE_INFINITY;
      let minB = Number.POSITIVE_INFINITY;
      let maxB = Number.NEGATIVE_INFINITY;
      for (let frame = 0; frame < frames; frame += 1) {
        const x = statesA[frame * width + column] as number;
        const y = statesB[frame * width + column] as number;
        sum += Math.abs(x - y);
        meanA += x;
        meanB += y;
        minA = Math.min(minA, x);
        maxA = Math.max(maxA, x);
        minB = Math.min(minB, y);
        maxB = Math.max(maxB, y);
      }
      if (sum === 0) {
        // Identical columns only count when the variable does something;
        // a constant default both presets share says nothing.
        if (maxA !== minA) counted += 1;
        continue;
      }
      const scale = Math.max(
        Math.abs(meanA / frames),
        Math.abs(meanB / frames),
        maxA - minA,
        maxB - minB,
        1e-3,
      );
      total += Math.min(1, sum / frames / scale);
      counted += 1;
    }
  });
  return counted === 0 ? 0 : total / counted;
}

export type TaskScore = {
  taskId: string;
  valid: boolean;
  detail?: string;
  instructionsSatisfied: number;
  instructionsTotal: number;
  changed: boolean;
  distanceFromParent: number;
  distanceFromRemix: number;
  reactivityDelta: number;
  /** Share of the remix's audio edge edits the answer makes too; null when
   * the remix changed no audio dependency. */
  audioEditRecall: number | null;
  /** Audio edge edits the answer makes that the remix did not. */
  audioEditExtra: number;
};

export function scoreAnswer(
  task: EditTask,
  answerSource: string,
  cache: {
    parent: Behaviour;
    remix: Behaviour;
  },
): TaskScore {
  const behaviour = measureBehaviour(answerSource, task.parentId);
  const checks = behaviour.valid
    ? checkInstructions(task.parentSource, answerSource, task.items)
    : task.items.map(() => false);
  const distanceFromParent = behaviourDistance(cache.parent, behaviour);
  const target = edgeEdit(cache.parent.audioEdges, cache.remix.audioEdges);
  const made = behaviour.valid
    ? edgeEdit(cache.parent.audioEdges, behaviour.audioEdges)
    : new Set<string>();
  const hit = [...made].filter((edge) => target.has(edge)).length;
  return {
    taskId: task.taskId,
    valid: behaviour.valid,
    ...(behaviour.detail ? { detail: behaviour.detail } : {}),
    instructionsSatisfied: checks.filter(Boolean).length,
    instructionsTotal: task.items.length,
    changed: behaviour.valid && distanceFromParent > CHANGED_THRESHOLD,
    distanceFromParent,
    distanceFromRemix: behaviourDistance(cache.remix, behaviour),
    reactivityDelta: behaviour.valid
      ? behaviour.reactivity - cache.parent.reactivity
      : 0,
    audioEditRecall: target.size ? hit / target.size : null,
    audioEditExtra: made.size - hit,
  };
}

export type EvalSummary = {
  tasks: number;
  valid: number;
  changed: number;
  /** Mean share of instruction items satisfied (invalid answers score 0). */
  instructionScore: number;
  meanDistanceFromParent: number;
  meanDistanceFromRemix: number;
  meanReactivityDelta: number;
  /** Tasks whose human remix changed an audio dependency. */
  audioEditTasks: number;
  /** Mean audioEditRecall over those tasks (invalid answers score 0). */
  audioEditRecall: number;
  /** Mean audioEditExtra over valid answers. */
  meanAudioEditExtra: number;
};

export function summarize(scores: readonly TaskScore[]): EvalSummary {
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const valid = scores.filter((score) => score.valid);
  return {
    tasks: scores.length,
    valid: valid.length,
    changed: scores.filter((score) => score.changed).length,
    instructionScore: mean(
      scores.map((score) =>
        score.instructionsTotal
          ? score.instructionsSatisfied / score.instructionsTotal
          : 0,
      ),
    ),
    meanDistanceFromParent: mean(valid.map((s) => s.distanceFromParent)),
    meanDistanceFromRemix: mean(valid.map((s) => s.distanceFromRemix)),
    meanReactivityDelta: mean(valid.map((s) => s.reactivityDelta)),
    audioEditTasks: scores.filter((s) => s.audioEditRecall !== null).length,
    audioEditRecall: mean(
      scores
        .filter((s) => s.audioEditRecall !== null)
        .map((s) => (s.valid ? (s.audioEditRecall as number) : 0)),
    ),
    meanAudioEditExtra: mean(valid.map((s) => s.audioEditExtra)),
  };
}

type Catalog = ReturnType<typeof loadCatalogEntries>;

function readPreset(repoRoot: string, catalog: Catalog, id: string): string {
  const entry = catalog.get(id);
  if (!entry) throw new Error(`Catalog has no preset ${id}`);
  return fs.readFileSync(
    path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
    'latin1',
  );
}

/** Tasks for the requested split, with the human remix source alongside. */
export function buildTasks(
  repoRoot: string,
  options: { split: DatasetSplit | 'all'; maxItems: number },
): Array<EditTask & { remixSource: string; remixId: string }> {
  const catalog = loadCatalogEntries(repoRoot);
  const entries = [...catalog.values()].map((entry) => ({
    id: entry.id,
    title: entry.title ?? entry.id,
    author: entry.author,
  }));
  // The same seeded family split lab:dataset writes, so train/test agree
  // across the two tools.
  const splits = assignFamilySplits(entries, { val: 0.1, test: 0.1 });
  const tasks: Array<EditTask & { remixSource: string; remixId: string }> = [];
  for (const pair of listRemixPairs(entries)) {
    const split = splits.get(pair.parent.id)?.split ?? 'train';
    if (options.split !== 'all' && split !== options.split) continue;
    const parentSource = readPreset(repoRoot, catalog, pair.parent.id);
    const remixSource = readPreset(repoRoot, catalog, pair.child.id);
    let items: InstructionItem[];
    try {
      items = buildInstruction(parentSource, remixSource, options.maxItems);
    } catch {
      continue; // a preset the compiler rejects outright is not a task
    }
    if (items.length === 0) continue;
    tasks.push({
      taskId: `${pair.parent.id}->${pair.child.id}`,
      family: pair.family,
      split,
      parentId: pair.parent.id,
      parentTitle: pair.parent.title,
      remixTitle: pair.child.title,
      instruction: instructionText(pair.parent.title, items),
      items,
      parentSource,
      remixSource,
      remixId: pair.child.id,
    });
  }
  return tasks;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const split = (get('--split') ?? 'test') as DatasetSplit | 'all';
  if (!['train', 'val', 'test', 'all'].includes(split)) {
    throw new Error('--split takes train, val, test or all');
  }
  const baseline = get('--baseline');
  if (
    baseline &&
    baseline !== 'copy' &&
    baseline !== 'reference' &&
    !PRESET_MUTATION_STYLES.some((style) => baseline === `restyle:${style.id}`)
  ) {
    throw new Error(
      `--baseline takes copy, reference or restyle:<${PRESET_MUTATION_STYLES.map((s) => s.id).join('|')}>`,
    );
  }
  return {
    exportPath: get('--export'),
    scorePath: get('--score'),
    baseline,
    outPath: get('--out'),
    split,
    maxItems: Number(get('--max-items') ?? DEFAULT_MAX_ITEMS),
    limit: get('--limit') ? Number(get('--limit')) : null,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  let tasks = buildTasks(repoRoot, options);
  if (options.limit !== null) tasks = tasks.slice(0, options.limit);

  if (options.exportPath) {
    const lines = tasks.map(({ remixSource: _r, remixId: _i, ...task }) =>
      JSON.stringify(task),
    );
    fs.writeFileSync(path.resolve(options.exportPath), `${lines.join('\n')}\n`);
    console.log(
      `Wrote ${tasks.length} ${options.split} tasks to ${options.exportPath}`,
    );
    return;
  }

  let answers: Map<string, string>;
  let label: string;
  if (options.scorePath) {
    label = path.basename(options.scorePath);
    answers = new Map(
      fs
        .readFileSync(path.resolve(options.scorePath), 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const row = JSON.parse(line) as { taskId: string; source: string };
          return [row.taskId, row.source] as const;
        }),
    );
  } else if (options.baseline) {
    label = `baseline ${options.baseline}`;
    const style = options.baseline.startsWith('restyle:')
      ? (options.baseline.slice('restyle:'.length) as PresetMutationStyle)
      : null;
    answers = new Map(
      tasks.map((task) => [
        task.taskId,
        options.baseline === 'reference'
          ? task.remixSource
          : style
            ? mutatePresetStyle(task.parentSource, style)
            : task.parentSource,
      ]),
    );
  } else {
    throw new Error(
      'Usage: bun run lab:edit-eval -- --export tasks.jsonl | --score answers.jsonl | --baseline copy|reference|restyle:<style>  [--split test|val|all] [--limit N] [--out report.json]',
    );
  }

  const scores: TaskScore[] = [];
  for (const task of tasks) {
    const answer = answers.get(task.taskId);
    const cache = {
      parent: measureBehaviour(task.parentSource, task.parentId),
      remix: measureBehaviour(task.remixSource, task.parentId),
    };
    scores.push(
      answer === undefined
        ? {
            taskId: task.taskId,
            valid: false,
            detail: 'no answer',
            instructionsSatisfied: 0,
            instructionsTotal: task.items.length,
            changed: false,
            distanceFromParent: 0,
            distanceFromRemix: 1,
            reactivityDelta: 0,
            audioEditRecall:
              edgeEdit(cache.parent.audioEdges, cache.remix.audioEdges).size > 0
                ? 0
                : null,
            audioEditExtra: 0,
          }
        : scoreAnswer(task, answer, cache),
    );
  }
  const summary = summarize(scores);
  console.log(`${label} on ${summary.tasks} ${options.split} tasks`);
  console.log(
    `  valid ${summary.valid}/${summary.tasks}  changed ${summary.changed}/${summary.tasks}  instructions ${(summary.instructionScore * 100).toFixed(1)}%`,
  );
  console.log(
    `  distance from parent ${summary.meanDistanceFromParent.toFixed(3)}  from human remix ${summary.meanDistanceFromRemix.toFixed(3)}  reactivity Δ ${summary.meanReactivityDelta.toFixed(3)}`,
  );
  console.log(
    `  audio edits (from the equations): recall ${(summary.audioEditRecall * 100).toFixed(1)}% on the ${summary.audioEditTasks} tasks whose remix changed an audio dependency, ${summary.meanAudioEditExtra.toFixed(2)} extra per answer`,
  );
  if (options.outPath) {
    fs.writeFileSync(
      path.resolve(options.outPath),
      JSON.stringify({ label, split: options.split, summary, scores }, null, 2),
    );
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
