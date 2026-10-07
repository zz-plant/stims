/**
 * Preset lab — shader-fix benchmark: real broken shader translations as tasks for code-fixing models, scored by a real GLSL compiler.
 *
 * Shader translation is this repo's most frequent kind of bug, and every
 * preset stage lab:glsl-corpus-scan reports as failing is a ready-made task:
 * the preset's shader source, the GLSL the runtime currently derives from
 * it, and the compiler's error. A model answers with a corrected GLSL body
 * for that stage; this scores it exactly the way the scan judges the
 * runtime's own output (same assembly into the fragment shader, same
 * glslangValidator invocation).
 *
 *   bun run lab:shader-fix-bench -- --export tasks.jsonl
 *   <a model answers: one { taskId, glsl } line per task>
 *   bun run lab:shader-fix-bench -- --score answers.jsonl [--out report.json]
 *   bun run lab:shader-fix-bench -- --baseline copy|stub
 *
 * Needs glslangValidator on PATH (`brew install glslang`,
 * `apt-get install glslang-tools`).
 *
 * Compiling is necessary, not sufficient: deleting the offending line
 * compiles too. So each answer is also scored on what it kept:
 *   compiles       the assembled stage passes glslangValidator
 *   texturesKept   share of the textures the original body samples that the
 *                  answer still samples (a fix keeps the shader's inputs)
 *   editFraction   share of the original's lines changed (1 - LCS / longer
 *                  length, whitespace-insensitive), with changedLines
 *   fixed          compiles, keeps every texture, and is local: changes at
 *                  most --max-edit (default 0.3) of the lines, or at most two
 *                  lines (on a three-line shader one line is already a third)
 *
 * The baselines show why all three matter: `copy` (the current output,
 * unchanged) fixes nothing, and `stub` (an empty body, so the stage falls
 * back to pass-through) compiles every time and keeps nothing.
 *
 * Still not scored: whether the fixed shader draws what the preset's author
 * intended. That needs rendering against the native projectM references
 * (parity:capture / parity:diff), which a fix passing here should go on to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { assembleMilkdropDirectFragmentShaders } from '../src/js/milkdrop/feedback-manager-shared.ts';
import {
  deriveStageGlsl,
  type ShaderStage,
  validateFragmentShader,
} from './preset-lab-glsl-corpus-scan.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

const DEFAULT_MAX_EDIT = 0.3;

export type ShaderFixTask = {
  taskId: string;
  presetId: string;
  stage: ShaderStage;
  /** The preset's own shader text for this stage (HLSL, or native GLSL). */
  source: string;
  /** The GLSL body the runtime derives today: what an answer replaces. */
  glsl: string;
  /** glslangValidator's first error for the assembled stage. */
  error: string;
};

type StageBodies = { warp: string | null; comp: string | null };

function stageBodies(
  raw: string,
  presetId: string,
): { bodies: StageBodies; sources: StageBodies } | null {
  let compiled: ReturnType<typeof compileMilkdropPresetSource>;
  try {
    compiled = compileMilkdropPresetSource(raw, { id: presetId });
  } catch {
    return null;
  }
  const programs = compiled.ir.post.shaderPrograms;
  return {
    bodies: {
      warp: deriveStageGlsl(compiled, 'warp'),
      comp: deriveStageGlsl(compiled, 'comp'),
    },
    sources: {
      warp: programs.warp?.source ?? null,
      comp: programs.comp?.source ?? null,
    },
  };
}

/** Compiles one stage of a preset with `body` in place of its derived GLSL. */
export function compileStage(
  bodies: StageBodies,
  stage: ShaderStage,
  body: string | null,
  /** Injected in tests; the CLI uses glslangValidator. */
  validate: (glsl: string) => string | null = validateFragmentShader,
): string | null {
  const warp = stage === 'warp' ? body : bodies.warp;
  const comp = stage === 'composite' ? body : bodies.comp;
  const assembled = assembleMilkdropDirectFragmentShaders(warp, comp);
  return validate(stage === 'warp' ? assembled.warp : assembled.composite);
}

/**
 * Textures a GLSL body samples: the first argument of texture2D/texture/tex2D
 * calls outside comments (a read commented out samples nothing).
 */
export function sampledTextures(glsl: string): Set<string> {
  const out = new Set<string>();
  const code = glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '');
  for (const match of code.matchAll(
    /\b(?:texture2D|texture|tex2D|textureLod)\s*\(\s*([A-Za-z_]\w*)/g,
  )) {
    out.add(match[1] as string);
  }
  return out;
}

/** Lines an edit may change regardless of the body's length. */
const ALWAYS_LOCAL_LINES = 2;

/**
 * Lines changed between two bodies, whitespace-insensitive: the longer
 * length minus their longest common subsequence of lines.
 */
export function changedLines(before: string, after: string): number {
  return lineDiff(before, after).changed;
}

/** Share of lines changed: changedLines over the longer length. */
export function editFraction(before: string, after: string): number {
  const { changed, longest } = lineDiff(before, after);
  return longest === 0 ? 0 : changed / longest;
}

function lineDiff(
  before: string,
  after: string,
): { changed: number; longest: number } {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ''))
      .filter(Boolean);
  const a = lines(before);
  const b = lines(after);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return { changed: 0, longest: 0 };
  // Classic O(n·m) LCS over lines, two rows at a time.
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, current[j - 1] as number);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return { changed: longest - (previous[b.length] as number), longest };
}

export type ShaderFixScore = {
  taskId: string;
  compiles: boolean;
  error?: string;
  texturesKept: number;
  editFraction: number;
  changedLines: number;
  fixed: boolean;
};

export function scoreAnswer(
  task: ShaderFixTask,
  bodies: StageBodies,
  answer: string,
  options: {
    maxEdit?: number;
    validate?: (glsl: string) => string | null;
  } = {},
): ShaderFixScore {
  const maxEdit = options.maxEdit ?? DEFAULT_MAX_EDIT;
  const error = compileStage(
    bodies,
    task.stage,
    answer.trim() ? answer : null,
    options.validate,
  );
  const original = sampledTextures(task.glsl);
  const kept = sampledTextures(answer);
  const texturesKept = original.size
    ? [...original].filter((name) => kept.has(name)).length / original.size
    : 1;
  const edit = editFraction(task.glsl, answer);
  const changed = changedLines(task.glsl, answer);
  // Local means a small share of the body, or at most a couple of lines:
  // on a three-line shader, fixing one line is already a third of it.
  const local = edit <= maxEdit || changed <= ALWAYS_LOCAL_LINES;
  return {
    taskId: task.taskId,
    compiles: error === null,
    ...(error ? { error } : {}),
    texturesKept,
    editFraction: edit,
    changedLines: changed,
    fixed: error === null && texturesKept === 1 && local,
  };
}

/** Every failing stage in the catalog, with the bodies needed to score it. */
export function buildTasks(
  repoRoot: string,
  only: readonly string[] = [],
): Array<{ task: ShaderFixTask; bodies: StageBodies }> {
  const catalog = loadCatalogEntries(repoRoot);
  const out: Array<{ task: ShaderFixTask; bodies: StageBodies }> = [];
  for (const entry of catalog.values()) {
    if (only.length && !only.includes(entry.id)) continue;
    const raw = fs.readFileSync(
      path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
      'latin1',
    );
    const derived = stageBodies(raw, entry.id);
    if (!derived || (!derived.bodies.warp && !derived.bodies.comp)) continue;
    for (const stage of ['warp', 'composite'] as const) {
      const key = stage === 'warp' ? 'warp' : 'comp';
      const glsl = derived.bodies[key];
      if (!glsl) continue;
      const error = compileStage(derived.bodies, stage, glsl);
      if (!error) continue;
      out.push({
        task: {
          taskId: `${entry.id}:${stage}`,
          presetId: entry.id,
          stage,
          source: derived.sources[key] ?? '',
          glsl,
          error,
        },
        bodies: derived.bodies,
      });
    }
  }
  return out;
}

export function summarize(scores: readonly ShaderFixScore[]) {
  const mean = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return {
    tasks: scores.length,
    compiles: scores.filter((score) => score.compiles).length,
    fixed: scores.filter((score) => score.fixed).length,
    meanTexturesKept: mean(scores.map((score) => score.texturesKept)),
    meanEditFraction: mean(scores.map((score) => score.editFraction)),
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const maxEdit = Number(get('--max-edit') ?? DEFAULT_MAX_EDIT);
  const tasks = buildTasks(repoRoot);

  const exportPath = get('--export');
  if (exportPath) {
    fs.writeFileSync(
      path.resolve(exportPath),
      `${tasks.map(({ task }) => JSON.stringify(task)).join('\n')}\n`,
    );
    console.log(`Wrote ${tasks.length} shader-fix tasks to ${exportPath}`);
    return;
  }

  const scorePath = get('--score');
  const baseline = get('--baseline');
  let answers: Map<string, string>;
  let label: string;
  if (scorePath) {
    label = path.basename(scorePath);
    answers = new Map(
      fs
        .readFileSync(path.resolve(scorePath), 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const row = JSON.parse(line) as { taskId: string; glsl: string };
          return [row.taskId, row.glsl] as const;
        }),
    );
  } else if (baseline === 'copy' || baseline === 'stub') {
    label = `baseline ${baseline}`;
    answers = new Map(
      tasks.map(({ task }) => [
        task.taskId,
        baseline === 'copy' ? task.glsl : '',
      ]),
    );
  } else {
    throw new Error(
      'Usage: bun run lab:shader-fix-bench -- --export tasks.jsonl | --score answers.jsonl | --baseline copy|stub  [--max-edit 0.3] [--out report.json]',
    );
  }

  const scores = tasks.map(({ task, bodies }) => {
    const answer = answers.get(task.taskId);
    return answer === undefined
      ? {
          taskId: task.taskId,
          compiles: false,
          error: 'no answer',
          texturesKept: 0,
          editFraction: 1,
          changedLines: task.glsl.split('\n').length,
          fixed: false,
        }
      : scoreAnswer(task, bodies, answer, { maxEdit });
  });
  const summary = summarize(scores);
  console.log(`${label} on ${summary.tasks} failing shader stages`);
  console.log(
    `  compiles ${summary.compiles}/${summary.tasks}  fixed ${summary.fixed}/${summary.tasks}  textures kept ${(summary.meanTexturesKept * 100).toFixed(1)}%  lines changed ${(summary.meanEditFraction * 100).toFixed(1)}%`,
  );
  const outPath = get('--out');
  if (outPath) {
    fs.writeFileSync(
      path.resolve(outPath),
      JSON.stringify({ label, summary, scores }, null, 2),
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
