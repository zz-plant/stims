/**
 * Preset lab — LLM answers: runs a local Ollama model on lab:edit-eval or lab:shader-fix-bench tasks and writes answers those benchmarks score.
 *
 * Both benchmarks keep the model outside the repo: export tasks, answer them
 * anywhere, score the answers. This is the "anywhere" for a model served by
 * Ollama, so a local model's score is one command away:
 *
 *   bun run lab:edit-eval -- --export edit-tasks.jsonl
 *   bun run lab:llm-answer -- --bench edit --tasks edit-tasks.jsonl \
 *     --model qwen3-coder:30b-128k --out edit-answers.jsonl
 *   bun run lab:edit-eval -- --score edit-answers.jsonl --out edit-report.json
 *
 * (and the same with `--bench shader` and lab:shader-fix-bench).
 *
 * Writes one `{ taskId, source }` (edit) or `{ taskId, glsl }` (shader) line
 * per task, plus `<out>.meta.jsonl` with each task's timing, token counts
 * and raw replies.
 * Tasks already in `--out` are skipped, so an interrupted run resumes.
 *
 * --format edit asks for SEARCH/REPLACE blocks instead of the whole text
 * and applies them here: local models asked for a whole shader body often
 * reply with only the lines they changed, which scores as a rewrite.
 *
 * --rounds N (shader, default 1) compiles each answer the way the benchmark
 * scores it and, while it fails, sends the model the new error for another
 * try, up to N replies in all. Broken translations often hold more than one
 * error, and one reply can only fix the one it was shown.
 *
 * Options: --limit N (first N tasks), --parallel N (concurrent requests;
 * Ollama's OLLAMA_NUM_PARALLEL caps the useful value), --temperature
 * (default 0), --no-error-line (shader: withhold the task's errorLine, to
 * measure what it is worth). The model's own context size is used, so a
 * model other clients already hold loaded is not reloaded.
 * OLLAMA_URL overrides http://localhost:11434.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTasks,
  diagnoseStage,
  type StageBodies,
} from './preset-lab-shader-fix-bench.ts';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

type Bench = 'edit' | 'shader';

type EditTask = {
  taskId: string;
  instruction: string;
  parentSource: string;
};

type ShaderTask = {
  taskId: string;
  presetId: string;
  stage: 'warp' | 'composite';
  source: string;
  glsl: string;
  error: string;
  errorLine?: number | null;
};

type Prompt = { system: string; user: string; maxTokens: number };

/**
 * How the model states its answer. `whole`: the complete edited text.
 * `edit`: SEARCH/REPLACE blocks this script applies to the original, so a
 * model that answers with only the lines it changed is still scored.
 */
export type AnswerFormat = 'whole' | 'edit';

const EDIT_SYSTEM =
  'You edit MilkDrop presets (.milk files). Reply in exactly the form asked for, with no explanation.';

const SHADER_SYSTEM =
  'You fix GLSL ES fragment-shader code that was machine-translated from MilkDrop HLSL shaders. Reply in exactly the form asked for, with no explanation.';

const EDIT_BLOCKS = [
  'Reply with one or more edits in this form, and nothing else:',
  '<<<<<<< SEARCH',
  'the exact lines to change, copied from the original',
  '=======',
  'the lines that replace them',
  '>>>>>>> REPLACE',
].join('\n');

function wholeReply(what: string, text: string): string {
  const lines = text.split('\n').length;
  return `Reply with the complete ${what}: all ${lines} lines, the unchanged ones included, not only the lines you change. No markdown fences.`;
}

/** Room for the answer: about one token per 3 characters of what it rewrites, doubled, plus slack. */
function answerBudget(chars: number): number {
  return Math.ceil((chars / 3) * 2) + 512;
}

export function editPrompt(
  task: EditTask,
  format: AnswerFormat = 'whole',
): Prompt {
  const instruction = task.instruction.replace(
    /\s*Answer with the complete edited \.milk preset\.\s*$/,
    '',
  );
  const reply =
    format === 'whole'
      ? wholeReply('edited .milk preset', task.parentSource)
      : EDIT_BLOCKS;
  return {
    system: EDIT_SYSTEM,
    user: `${instruction}\n${reply}\n\n${task.parentSource}`,
    maxTokens: answerBudget(task.parentSource.length),
  };
}

export function shaderPrompt(
  task: ShaderTask,
  options: { errorLine?: boolean; format?: AnswerFormat } = {},
): Prompt {
  const line =
    options.errorLine !== false && task.errorLine
      ? task.glsl.split('\n')[task.errorLine - 1]
      : undefined;
  const where =
    line === undefined
      ? ''
      : `\nThe error is on line ${task.errorLine} of the body:\n${line.trim()}\n`;
  return {
    system: SHADER_SYSTEM,
    user: [
      `This GLSL body is the ${task.stage} shader of the MilkDrop preset "${task.presetId}", translated from its HLSL source. It runs inside main() of a GLSL ES fragment shader, and it fails to compile:`,
      '',
      task.error.trim(),
      where,
      'Fix it with the smallest edit that compiles. Keep every texture sample and leave the rest of the code as it is.',
      options.format === 'edit'
        ? EDIT_BLOCKS
        : wholeReply('corrected body', task.glsl),
      '',
      'HLSL source:',
      task.source,
      '',
      'GLSL body:',
      task.glsl,
    ].join('\n'),
    maxTokens: answerBudget(task.glsl.length),
  };
}

function dropThinking(reply: string): string {
  return reply.replace(/<think>[\s\S]*?<\/think>/g, '');
}

/**
 * The follow-up when an answer still fails to compile: the new error, the
 * line it points at, and (for edits, whose result the model never saw) the
 * body as it now stands.
 */
export function shaderFollowUp(
  failure: { error: string; errorLine: number | null },
  body: string,
  format: AnswerFormat,
  failedEdits = 0,
): string {
  const line =
    failure.errorLine === null
      ? undefined
      : body.split('\n')[failure.errorLine - 1];
  return [
    'That still fails to compile:',
    '',
    failure.error.trim(),
    ...(line === undefined
      ? []
      : [
          '',
          `The error is on line ${failure.errorLine} of the body:`,
          line.trim(),
        ]),
    '',
    ...(format === 'edit'
      ? [
          ...(failedEdits
            ? [
                `${failedEdits} of your edits matched nothing in the body and were skipped.`,
              ]
            : []),
          `Reply with more edits, against the body as it now stands:\n\n${body}\n\n${EDIT_BLOCKS}`,
        ]
      : [wholeReply('corrected body', body)]),
  ].join('\n');
}

/**
 * The answer inside a `whole` reply: the longest fenced block if the model
 * fenced it anyway, else the whole reply.
 */
export function extractAnswer(reply: string): string {
  const text = dropThinking(reply);
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(
    (match) => match[1] as string,
  );
  if (blocks.length) {
    return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trimEnd();
  }
  return text.trim();
}

/**
 * Applies a reply's SEARCH/REPLACE blocks to `original` in order. A block
 * whose SEARCH text is not found verbatim is matched line by line ignoring
 * whitespace; a repeat of a block already applied counts as applied; one
 * that matches nowhere is counted as failed and skipped.
 */
export function applyEdits(
  original: string,
  reply: string,
): { text: string; applied: number; failed: number } {
  let text = original;
  let applied = 0;
  let failed = 0;
  const pattern =
    /<{5,}\s*SEARCH[^\n]*\n([\s\S]*?)\n?={5,}[^\n]*\n([\s\S]*?)\n?>{5,}\s*REPLACE/g;
  for (const [, search = '', replace = ''] of dropThinking(reply).matchAll(
    pattern,
  )) {
    if (search.trim() && text.includes(search)) {
      text = text.replace(search, () => replace);
      applied += 1;
      continue;
    }
    const lines = text.split('\n');
    const at = findLines(lines, search);
    if (at >= 0) {
      lines.splice(at, squashedLines(search).length, ...replace.split('\n'));
      text = lines.join('\n');
      applied += 1;
    } else if (findLines(lines, replace) >= 0) {
      // Models repeat blocks; one whose replacement is already in place is done.
      applied += 1;
    } else {
      failed += 1;
    }
  }
  return { text, applied, failed };
}

/** A block's lines with whitespace removed, blank lines at either end dropped. */
function squashedLines(block: string): string[] {
  const out = block.split('\n').map((line) => line.replace(/\s+/g, ''));
  while (out.length && !out.at(-1)) out.pop();
  while (out.length && !out[0]) out.shift();
  return out;
}

/** Where `block`'s lines start in `lines`, ignoring whitespace; -1 if nowhere. */
function findLines(lines: string[], block: string): number {
  const wanted = squashedLines(block);
  if (!wanted.length) return -1;
  return lines.findIndex((_, start) =>
    wanted.every(
      (line, k) => (lines[start + k] ?? '').replace(/\s+/g, '') === line,
    ),
  );
}

type ChatResult = {
  content: string;
  promptTokens: number;
  answerTokens: number;
  doneReason: string;
};

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function chat(
  model: string,
  messages: Message[],
  maxTokens: number,
  temperature: number,
): Promise<ChatResult> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
      options: { temperature, seed: 1, num_predict: maxTokens },
    }),
    // Bun aborts a fetch after 300 s by default; a long shader's whole
    // answer, queued behind another client's request, takes longer.
    timeout: false,
  } as RequestInit);
  if (!response.ok) {
    throw new Error(
      `ollama chat failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const data = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
  };
  return {
    content: data.message?.content ?? '',
    promptTokens: data.prompt_eval_count ?? 0,
    answerTokens: data.eval_count ?? 0,
    doneReason: data.done_reason ?? '',
  };
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const bench = get('--bench') as Bench | undefined;
  const tasksPath = get('--tasks');
  const model = get('--model');
  const outPath = get('--out');
  if (
    (bench !== 'edit' && bench !== 'shader') ||
    !tasksPath ||
    !model ||
    !outPath
  ) {
    throw new Error(
      'Usage: bun run lab:llm-answer -- --bench edit|shader --tasks tasks.jsonl --model <ollama model> --out answers.jsonl [--format whole|edit] [--rounds N] [--limit N] [--parallel N] [--temperature T] [--no-error-line]',
    );
  }
  const format = (get('--format') ?? 'whole') as AnswerFormat;
  if (format !== 'whole' && format !== 'edit') {
    throw new Error('--format takes whole or edit');
  }
  const limit = Number(get('--limit') ?? Number.POSITIVE_INFINITY);
  const parallel = Math.max(1, Number(get('--parallel') ?? 1));
  const temperature = Number(get('--temperature') ?? 0);
  const errorLine = !args.includes('--no-error-line');
  const rounds = Math.max(1, Number(get('--rounds') ?? 1));
  if (rounds > 1 && bench !== 'shader') {
    throw new Error(
      '--rounds needs --bench shader: only shaders are compiled here',
    );
  }

  const out = path.resolve(outPath);
  const metaOut = `${out}.meta.jsonl`;
  const done = new Set(
    readJsonl<{ taskId: string }>(out).map((row) => row.taskId),
  );
  const tasks = readJsonl<EditTask & ShaderTask>(path.resolve(tasksPath))
    .slice(0, limit)
    .filter((task) => !done.has(task.taskId));
  console.log(
    `${model} on ${tasks.length} ${bench} tasks (${done.size} already answered)`,
  );
  // Feedback compiles each answer exactly as lab:shader-fix-bench scores it,
  // against the preset's other stage, so it needs the bodies the export had.
  const bodies = new Map<string, StageBodies>();
  if (rounds > 1) {
    const repoRoot = path.resolve(
      fileURLToPath(new URL('..', import.meta.url)),
    );
    for (const built of buildTasks(repoRoot)) {
      bodies.set(built.task.taskId, built.bodies);
    }
  }

  let next = 0;
  let finished = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++] as EditTask & ShaderTask;
      const prompt =
        bench === 'edit'
          ? editPrompt(task, format)
          : shaderPrompt(task, { errorLine, format });
      const original = bench === 'edit' ? task.parentSource : task.glsl;
      const messages: Message[] = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];
      const started = performance.now();
      const replies: string[] = [];
      const errors: string[] = [];
      let answer = original;
      let promptTokens = 0;
      let answerTokens = 0;
      let doneReason = '';
      let applied = 0;
      let failed = 0;
      try {
        for (let round = 1; round <= rounds; round += 1) {
          const result = await chat(
            model,
            messages,
            prompt.maxTokens,
            temperature,
          );
          replies.push(result.content);
          promptTokens += result.promptTokens;
          answerTokens += result.answerTokens;
          doneReason = result.doneReason;
          messages.push({ role: 'assistant', content: result.content });
          let failedNow = 0;
          if (format === 'edit') {
            const edits = applyEdits(answer, result.content);
            answer = edits.text;
            applied += edits.applied;
            failed += edits.failed;
            failedNow = edits.failed;
          } else {
            answer = extractAnswer(result.content);
          }
          const taskBodies = bodies.get(task.taskId);
          if (round === rounds || !taskBodies) break;
          const failure = diagnoseStage(taskBodies, task.stage, answer);
          if (!failure) break;
          errors.push(failure.error);
          messages.push({
            role: 'user',
            content: shaderFollowUp(failure, answer, format, failedNow),
          });
        }
      } catch (error) {
        console.error(`${task.taskId}: ${(error as Error).message}`);
        continue;
      }
      const seconds = (performance.now() - started) / 1000;
      fs.appendFileSync(
        out,
        `${JSON.stringify(
          bench === 'edit'
            ? { taskId: task.taskId, source: answer }
            : { taskId: task.taskId, glsl: answer },
        )}\n`,
      );
      fs.appendFileSync(
        metaOut,
        `${JSON.stringify({
          taskId: task.taskId,
          model,
          format,
          temperature,
          ...(bench === 'shader' ? { errorLine, rounds: replies.length } : {}),
          seconds: Number(seconds.toFixed(1)),
          promptTokens,
          answerTokens,
          doneReason,
          ...(format === 'edit' ? { applied, failed } : {}),
          ...(errors.length ? { errors } : {}),
          replies,
        })}\n`,
      );
      finished += 1;
      console.log(
        `[${finished}/${tasks.length}] ${task.taskId}  ${seconds.toFixed(0)}s  ${answerTokens} tokens${rounds > 1 ? `  ${replies.length} round${replies.length > 1 ? 's' : ''}` : ''}${format === 'edit' ? `  edits ${applied} applied, ${failed} failed` : ''}${doneReason === 'length' ? '  (hit the token cap)' : ''}`,
      );
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
