// Shared decision inference and body limits. The underscore prevents routing.
import {
  DECISION_LIMITS,
  type DecisionModel,
  type DecisionQuestions,
  type DecisionRequest,
  type DecisionResult,
  DecisionValidationError,
  decisionDisposition,
  decisionQuestions,
  decisionQuestionVersion,
  decisionRecord,
  effectiveDecisionModel,
  parseDecisionAnswers,
  parseDecisionUsage,
} from '../../src/js/core/decision-model.ts';

export class DecisionProviderError extends Error {
  constructor(
    message: string,
    public readonly status: 502 | 504 = 502,
  ) {
    super(message);
    this.name = 'DecisionProviderError';
  }
}
export const DECISION_TIMEOUT_MS = 12_000;

/** The binding does not expose a documented cancellation option. Bound our
 * wait, discard late responses and always release the timer. This deadline
 * does not promise that provider-side GPU work has been cancelled. */
async function deadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DecisionProviderError('Decision evaluation timed out.', 504),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function readDecisionBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > DECISION_LIMITS.bodyBytes) {
    // An underlying stream's cancellation hook may never settle. Observe its
    // rejection without making a bounded rejection wait for cleanup.
    void request.body?.cancel().catch(() => {});
    throw new DecisionValidationError('Request body is too large.', 413);
  }
  if (!request.body)
    throw new DecisionValidationError('JSON request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    await deadline(
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          total += value.byteLength;
          if (total > DECISION_LIMITS.bodyBytes)
            throw new DecisionValidationError(
              'Request body is too large.',
              413,
            );
          chunks.push(value);
        }
      })(),
      DECISION_TIMEOUT_MS,
    );
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(combined),
      );
    } catch {
      throw new DecisionValidationError('Invalid JSON request body.');
    }
  } finally {
    // cancel() closes the reader immediately, but its promise also waits for
    // the underlying source. Releasing our lock must not await that source.
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface DecisionInferenceInput {
  model: DecisionModel;
  state: DecisionRequest['state'];
  questions: DecisionQuestions;
  images?: string[];
  audio?: string[];
  videos?: string[];
}

/** Only server-created questions reach this runner. The public endpoint never
 * accepts arbitrary schemas, model ids, or remote media fetches. */
export async function runDecisionQuestions(
  ai: WorkersAI,
  input: DecisionInferenceInput,
) {
  let output: unknown;
  try {
    output = await deadline(
      ai.run(`@cf/cloudflare/${input.model}`, input),
      DECISION_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof DecisionProviderError) throw error;
    throw new DecisionProviderError('Decision provider is unavailable.');
  }
  try {
    if (
      !decisionRecord(output) ||
      (output.model !== input.model &&
        output.model !== `@cf/cloudflare/${input.model}`)
    )
      throw new Error('Unexpected decision model.');
    const answers = parseDecisionAnswers(output.answers, input.questions);
    const usage = parseDecisionUsage(output.usage);
    return { answers, ...(usage ? { usage } : {}) };
  } catch {
    throw new DecisionProviderError(
      'Decision provider returned an invalid result.',
    );
  }
}

export async function runDecision(
  ai: WorkersAI,
  request: DecisionRequest,
): Promise<DecisionResult> {
  const model = effectiveDecisionModel(request);
  const questions = decisionQuestions(request);
  const fingerprint = JSON.stringify({
    questionVersion: decisionQuestionVersion(request.task),
    ...request,
    model,
  });
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fingerprint),
  );
  const inputHash = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const output = await runDecisionQuestions(ai, {
    model,
    state: request.state,
    questions,
    ...(request.images ? { images: request.images } : {}),
    ...(request.audio ? { audio: request.audio } : {}),
    ...(request.videos ? { videos: request.videos } : {}),
  });
  return {
    version: 1,
    task: request.task,
    model,
    answers: output.answers,
    disposition: decisionDisposition(request.task, output.answers),
    provenance: {
      questionVersion: decisionQuestionVersion(request.task),
      evaluatedAt: new Date().toISOString(),
      inputHash,
    },
    ...(output.usage ? { usage: output.usage } : {}),
  };
}
