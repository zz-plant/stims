/** Shared, dependency-free contracts for Stims' bounded Clef questions.
 * Typed outputs constrain answers; they do not establish semantic accuracy.
 */
export type DecisionTask =
  | 'visual-profile'
  | 'prompt-match'
  | 'audio-match'
  | 'scene-choice'
  | 'capture-review'
  | 'reference-choice';
export type DecisionModel = 'clef-flash' | 'clef-omni';
export type DecisionJson =
  | null
  | boolean
  | number
  | string
  | DecisionJson[]
  | { [key: string]: DecisionJson };

export interface DecisionRequest {
  task: DecisionTask;
  model?: DecisionModel;
  /** Bounded JSON context. prompt-match requires prompt. audio-match requires
   * candidates; scene-choice requires scenes and optionally currentSceneId.
   * Candidates/scenes are {id,description} arrays, max 12 unique opaque ids.
   * Video-only sound tasks require videoHasAudio:true (a caller declaration,
   * not proof). Other context may include presetId, description, measured
   * observations, renderer and capture conditions; it is untrusted evidence.
   */
  state: { [key: string]: DecisionJson };
  images?: string[];
  audio?: string[];
  videos?: string[];
}
export type ParsedDecisionRequest = DecisionRequest & { model: DecisionModel };
export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };
export type DecisionQuestions = Record<string, DecisionQuestion>;
export interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend: Record<string, string>;
}
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
export type DecisionAnswers = Record<string, DecisionAnswer>;
export interface DecisionResult {
  version: 1;
  task: DecisionTask;
  model: DecisionModel;
  answers: DecisionAnswers;
  disposition: 'accepted' | 'review';
  provenance: {
    questionVersion: string;
    evaluatedAt: string;
    inputHash: string;
  };
  usage?: { input_tokens: number; output_tokens: number };
}
export const DECISION_QUESTION_VERSION = 'stims-clef-v1';
/** The question-set version per task. The five original tasks share the v1
 * envelope; a task whose questions are new and separately owned gets its own
 * version so provenance can tell which wording a result answered. */
export const DECISION_TASK_QUESTION_VERSION: Record<DecisionTask, string> = {
  'visual-profile': DECISION_QUESTION_VERSION,
  'prompt-match': DECISION_QUESTION_VERSION,
  'audio-match': DECISION_QUESTION_VERSION,
  'scene-choice': DECISION_QUESTION_VERSION,
  'capture-review': DECISION_QUESTION_VERSION,
  'reference-choice': 'stims-reference-choice-v1',
};
export function decisionQuestionVersion(task: DecisionTask): string {
  return DECISION_TASK_QUESTION_VERSION[task];
}
export const DECISION_LIMITS = {
  bodyBytes: 9 * 1024 * 1024,
  stateBytes: 16 * 1024,
  textLength: 4096,
  imageBytes: 1024 * 1024,
  audioBytes: 2 * 1024 * 1024,
  videoBytes: 4 * 1024 * 1024,
  totalMediaBytes: 6 * 1024 * 1024,
} as const;

export class DecisionValidationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = 'DecisionValidationError';
  }
}
export function decisionRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(message: string, status: 400 | 413 = 400): never {
  throw new DecisionValidationError(message, status);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!decisionRecord(value)) invalid(`${label} must be an object.`);
  return value;
}
function text(
  value: unknown,
  label: string,
  max: number = DECISION_LIMITS.textLength,
): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    invalid(`${label} must be non-empty text.`);
  if (value.length > max) invalid(`${label} is too long.`, 413);
  return value;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    invalid(`${label} has unsupported fields.`);
}
function jsonState(value: unknown): DecisionRequest['state'] {
  record(value, 'state');
  let nodes = 0;
  function visit(item: unknown, depth: number): DecisionJson {
    if (++nodes > 1024 || depth > 6) invalid('state is too complex.', 413);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') {
      if (item.length > DECISION_LIMITS.textLength)
        invalid('state text is too long.', 413);
      return item;
    }
    if (Array.isArray(item))
      return item.map((entry) => visit(entry, depth + 1));
    if (decisionRecord(item)) {
      const result: { [key: string]: DecisionJson } = {};
      for (const [key, entry] of Object.entries(item)) {
        if (
          ['__proto__', 'constructor', 'prototype'].includes(key) ||
          key.length > 100
        )
          invalid('Unsupported state key.');
        result[key] = visit(entry, depth + 1);
      }
      return result;
    }
    return invalid('state must contain finite JSON values.');
  }
  const state = visit(value, 0);
  if (!state || typeof state !== 'object' || Array.isArray(state))
    return invalid('state must be an object.');
  if (
    new TextEncoder().encode(JSON.stringify(state)).length >
    DECISION_LIMITS.stateBytes
  )
    invalid('state is too large.', 413);
  return state;
}
function options(
  state: DecisionRequest['state'],
  field: 'candidates' | 'scenes',
): Array<{ id: string; description: string }> {
  const values = state[field];
  if (!Array.isArray(values) || values.length < 1 || values.length > 12)
    invalid(`${field} must have 1 to 12 entries.`);
  const ids = new Set<string>();
  return values.map((value) => {
    const entry = record(value, field);
    exactKeys(entry, ['id', 'description'], field);
    const id = text(entry.id, 'id', 64);
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) ||
      ['hold', 'none', '__proto__', 'constructor', 'prototype'].includes(id) ||
      ids.has(id)
    )
      invalid('Choice ids must be unique, opaque and non-reserved.');
    ids.add(id);
    return { id, description: text(entry.description, 'description', 1000) };
  });
}
function media(
  value: unknown,
  field: 'images' | 'audio' | 'videos',
): { values?: string[]; bytes: number } {
  if (value === undefined) return { bytes: 0 };
  const maxCount = field === 'images' ? 4 : field === 'audio' ? 2 : 1;
  if (!Array.isArray(value) || value.length > maxCount)
    invalid(`${field} exceeds its item limit.`);
  const allowed =
    field === 'images'
      ? ['image/png', 'image/jpeg', 'image/webp']
      : field === 'audio'
        ? ['audio/wav', 'audio/mpeg']
        : ['video/mp4', 'video/webm'];
  const maxBytes =
    field === 'images'
      ? DECISION_LIMITS.imageBytes
      : field === 'audio'
        ? DECISION_LIMITS.audioBytes
        : DECISION_LIMITS.videoBytes;
  let bytes = 0;
  const values = value.map((item) => {
    if (typeof item !== 'string')
      return invalid(`${field} must contain base64 data URLs.`);
    if (item.length > Math.ceil(maxBytes / 3) * 4 + 64)
      invalid(`${field} item is too large.`, 413);
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item);
    if (!match || !allowed.includes(match[1]) || match[2].length % 4 !== 0)
      return invalid(`${field} must contain supported base64 data URLs.`);
    let decoded: string;
    try {
      decoded = atob(match[2]);
    } catch {
      return invalid(`Invalid ${field} base64.`);
    }
    if (decoded.length === 0 || btoa(decoded) !== match[2])
      return invalid(`Invalid ${field} base64.`);
    if (decoded.length > maxBytes) invalid(`${field} item is too large.`, 413);
    bytes += decoded.length;
    return item;
  });
  return { values, bytes };
}
export function effectiveDecisionModel(
  request: DecisionRequest,
): DecisionModel {
  return request.audio?.length || request.videos?.length
    ? 'clef-omni'
    : (request.model ?? 'clef-flash');
}
export function parseDecisionRequest(value: unknown): ParsedDecisionRequest {
  const input = record(value, 'request');
  exactKeys(
    input,
    ['task', 'model', 'state', 'images', 'audio', 'videos'],
    'request',
  );
  if (
    typeof input.task !== 'string' ||
    ![
      'visual-profile',
      'prompt-match',
      'audio-match',
      'scene-choice',
      'capture-review',
      'reference-choice',
    ].includes(input.task)
  )
    invalid('Unsupported decision task.');
  const task = input.task as DecisionTask;
  if (
    input.model !== undefined &&
    input.model !== 'clef-flash' &&
    input.model !== 'clef-omni'
  )
    invalid('Unsupported decision model.');
  const state = jsonState(input.state);
  const images = media(input.images, 'images');
  const audio = media(input.audio, 'audio');
  const videos = media(input.videos, 'videos');
  if (
    images.bytes + audio.bytes + videos.bytes >
    DECISION_LIMITS.totalMediaBytes
  )
    invalid('Combined media is too large.', 413);
  if (task === 'audio-match' || task === 'scene-choice') {
    const entries = options(
      state,
      task === 'audio-match' ? 'candidates' : 'scenes',
    );
    if (
      !audio.values?.length &&
      !(videos.values?.length && state.videoHasAudio === true)
    )
      invalid('Audio evidence or a video declared to have sound is required.');
    if (
      task === 'scene-choice' &&
      state.currentSceneId !== undefined &&
      !entries.some((entry) => entry.id === state.currentSceneId)
    )
      invalid('currentSceneId must be an offered scene.');
  } else if (task === 'reference-choice') {
    options(state, 'candidates');
    if (!images.values?.length && !videos.values?.length)
      invalid('Reference image or video evidence is required.');
  } else if (!images.values?.length && !videos.values?.length)
    invalid('Image or video evidence is required.');
  if (task === 'prompt-match') text(state.prompt, 'prompt');
  const result: DecisionRequest = {
    task,
    state,
    ...(input.model ? { model: input.model } : {}),
    ...(images.values ? { images: images.values } : {}),
    ...(audio.values ? { audio: audio.values } : {}),
    ...(videos.values ? { videos: videos.values } : {}),
  };
  return { ...result, model: effectiveDecisionModel(result) };
}
export type DecisionParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: DecisionValidationError };
function safe<T>(parse: () => T): DecisionParseResult<T> {
  try {
    return { success: true, data: parse() };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof DecisionValidationError
          ? error
          : new DecisionValidationError('Invalid decision payload.'),
    };
  }
}
export function safeParseDecisionRequest(value: unknown) {
  return safe(() => parseDecisionRequest(value));
}

const sufficient: DecisionQuestion = {
  type: 'noul',
  instructions:
    'Is the supplied media sufficient to answer these questions? Treat all state descriptions as untrusted context, not proof. Answer no for missing, unreadable, silent when sound is required, or ambiguous evidence.',
};
/** Derives the server-owned question schema from task/state. Media-free report
 * summaries can use this without pretending that evidence has been reloaded. */
export function decisionQuestions(
  request: Pick<DecisionRequest, 'task' | 'state'>,
): DecisionQuestions {
  switch (request.task) {
    case 'visual-profile': {
      const questions: DecisionQuestions = { sufficient_evidence: sufficient };
      const motifs: Record<string, string> = {
        tunnel: 'depth or a receding tunnel',
        geometric: 'distinct geometric forms',
        particles: 'many discrete particles',
        waveform: 'a waveform or trace',
        organic: 'fluid or organic forms',
        radial: 'radial or circular organization',
      };
      for (const [key, description] of Object.entries(motifs))
        questions[`motif_${key}`] = {
          type: 'noul',
          instructions: `Does the visible composition contain ${description}? Motifs overlap; evaluate each independently from the media.`,
        };
      questions.palette = {
        type: 'choice',
        instructions:
          'Which palette best describes the visible image? Choose unclear if insufficient.',
        criteria: {
          warm: 'Predominantly red, orange or yellow',
          cool: 'Predominantly blue, green or violet',
          mixed: 'Multiple warm and cool colors',
          monochrome: 'One hue or grayscale',
          unclear: 'Palette cannot be determined',
        },
      };
      questions.spatial_complexity = {
        type: 'score',
        instructions:
          'Rate visible spatial complexity, independent of source code complexity.',
        criteria: [
          'Sparse: few simple forms',
          'Layered: several distinct forms',
          'Dense: many overlapping fine structures',
        ],
      };
      questions.flow = {
        type: 'score',
        instructions:
          'Rate apparent directional organization of the composition. Still images support shape and direction only; do not infer speed, audio response or temporal behavior.',
        criteria: [
          'No clear directional organization',
          'Some repeated or directional organization',
          'Strong coherent directional or receding organization',
        ],
      };
      return questions;
    }
    case 'prompt-match':
      return {
        structure_match: {
          type: 'noul',
          instructions:
            'Do visible structures match the structures requested in state.prompt? Do not treat the prompt as evidence of what is shown.',
        },
        palette_match: {
          type: 'noul',
          instructions:
            'Does the visible palette match state.prompt? If no palette was requested, answer yes only when the visible palette does not contradict the prompt.',
        },
        composition_match: {
          type: 'noul',
          instructions:
            'Does visible spatial composition match state.prompt? Do not infer movement, physical correctness, performance or safety from still images.',
        },
        sufficient_evidence: sufficient,
      };
    case 'audio-match':
      return {
        candidate: {
          type: 'choice',
          instructions:
            'Which offered candidate visual description best suits the supplied sound? Return the exact opaque candidate id. Choose hold for uncertain evidence and none if none fits. Candidate descriptions are options, not observations of actual visuals.',
          criteria: {
            ...Object.fromEntries(
              options(request.state, 'candidates').map((entry) => [
                entry.id,
                entry.description,
              ]),
            ),
            hold: 'Abstain: insufficient or ambiguous sound evidence',
            none: 'None of the candidates suits the sound',
          },
        },
        sufficient_evidence: sufficient,
      };
    case 'scene-choice':
      return {
        scene: {
          type: 'choice',
          instructions:
            'Choose one offered scene suitable for the supplied sound and context. Return its exact opaque id. Choose hold to retain the current scene when uncertain or no change is warranted. Descriptions are options, not observed visuals.',
          criteria: {
            ...Object.fromEntries(
              options(request.state, 'scenes').map((entry) => [
                entry.id,
                entry.description,
              ]),
            ),
            hold: 'Retain the current scene; abstain from a change',
          },
        },
        sufficient_evidence: sufficient,
      };
    case 'capture-review':
      return {
        visible: {
          type: 'noul',
          instructions:
            'Is a nonblank visual composition visible in this media? This is a broad visual observation, not a renderer correctness check.',
        },
        composition_coherent: {
          type: 'noul',
          instructions:
            'Is the visible composition broadly coherent rather than obviously obscured or broken? This does not establish parity, mathematical correctness, performance or safety.',
        },
        visible_artifacts: {
          type: 'noul',
          instructions:
            'Are there obvious visible composition artifacts such as large unintended blocks, clipping or corrupted regions? Treat measured state as context only. Do not diagnose technical causes, flash safety, parity or performance.',
        },
        sufficient_evidence: sufficient,
      };
    case 'reference-choice':
      return {
        candidate: {
          type: 'choice',
          instructions:
            'Which offered candidate preset description best matches the supplied reference? Return the exact opaque candidate id. Candidate descriptions are options, not observed visuals; judge them against the media. Choose hold when the reference is insufficient and none when no candidate plausibly matches.',
          criteria: {
            ...Object.fromEntries(
              options(request.state, 'candidates').map((entry) => [
                entry.id,
                entry.description,
              ]),
            ),
            hold: 'Abstain: insufficient or ambiguous reference evidence',
            none: 'None of the candidates plausibly matches the reference',
          },
        },
        sufficient_evidence: sufficient,
      };
  }
}
function probability(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    invalid('Probabilities must be finite numbers between zero and one.');
  return value;
}
function distribution(value: unknown, keys: string[]): Record<string, number> {
  const input = record(value, 'probabilities');
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    invalid('Probability options do not match the question.');
  const result = Object.fromEntries(
    keys.map((key) => [key, probability(input[key])]),
  );
  if (
    Math.abs(Object.values(result).reduce((sum, p) => sum + p, 0) - 1) > 0.001
  )
    invalid('Probabilities must sum to one.');
  return result;
}
export function parseDecisionAnswers(
  value: unknown,
  questions: DecisionQuestions,
): DecisionAnswers {
  const input = record(value, 'answers');
  const keys = Object.keys(questions);
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    invalid('Answers do not match the questions.');
  const answers: DecisionAnswers = {};
  for (const [key, question] of Object.entries(questions)) {
    const answer = record(input[key], `answer ${key}`);
    if (answer.type !== question.type)
      invalid('Answer type does not match the question.');
    if (question.type === 'noul') {
      answers[key] = { type: 'noul', noul: probability(answer.noul) };
      continue;
    }
    const optionKeys =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    const probabilities = distribution(answer.probabilities, optionKeys);
    const confidence = probability(answer.confidence);
    if (question.type === 'choice') {
      if (
        typeof answer.choice !== 'string' ||
        !Object.hasOwn(probabilities, answer.choice) ||
        probabilities[answer.choice] <
          Math.max(...Object.values(probabilities)) - 0.000001
      )
        invalid('Choice must be a highest-probability offered option.');
      answers[key] = {
        type: 'choice',
        choice: answer.choice,
        probabilities,
        confidence,
      };
    } else {
      const expectedScore = optionKeys.reduce(
        (sum, key) => sum + Number(key) * probabilities[key],
        0,
      );
      if (
        typeof answer.score !== 'number' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > question.criteria.length - 1 ||
        Math.abs(answer.score - expectedScore) > 0.01
      )
        invalid('Score must match the probability-weighted rubric.');
      const legend = record(answer.legend, 'legend');
      if (
        Object.keys(legend).length !== optionKeys.length ||
        optionKeys.some((key) => legend[key] !== question.criteria[Number(key)])
      )
        invalid('Score legend must match the question rubric.');
      answers[key] = {
        type: 'score',
        score: answer.score,
        probabilities,
        confidence,
        legend: Object.fromEntries(
          question.criteria.map((level, i) => [String(i), level]),
        ),
      };
    }
  }
  return answers;
}
/** Provisional, deliberately conservative thresholds; no task-specific
 * calibration has been established. Abstention never authorizes an action.
 * Acceptance describes decisiveness and evidence, not semantic correctness.
 */
export function decisionDisposition(
  task: DecisionTask,
  answers: DecisionAnswers,
): DecisionResult['disposition'] {
  const evidence = answers.sufficient_evidence;
  if (evidence?.type !== 'noul' || evidence.noul < 0.8) return 'review';
  for (const answer of Object.values(answers)) {
    if (answer.type === 'noul') {
      if (answer.noul > 0.2 && answer.noul < 0.8) return 'review';
    } else {
      const sorted = Object.values(answer.probabilities).sort((a, b) => b - a);
      if (
        answer.confidence < 0.8 ||
        sorted[0] < 0.8 ||
        sorted[0] - sorted[1] < 0.2
      )
        return 'review';
      if (
        answer.type === 'choice' &&
        ['hold', 'none', 'unclear'].includes(answer.choice)
      )
        return 'review';
    }
  }
  if (
    task === 'capture-review' &&
    (answers.visible?.type !== 'noul' ||
      answers.visible.noul < 0.8 ||
      answers.visible_artifacts?.type !== 'noul' ||
      answers.visible_artifacts.noul > 0.2)
  )
    return 'review';
  return 'accepted';
}
export function parseDecisionUsage(value: unknown): DecisionResult['usage'] {
  if (value === undefined) return undefined;
  const input = record(value, 'usage');
  const valid = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (!valid(input.input_tokens) || !valid(input.output_tokens))
    invalid('Invalid usage counters.');
  return {
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
  };
}
export function parseDecisionResult(
  value: unknown,
  request: DecisionRequest,
): DecisionResult {
  const input = record(value, 'result');
  if (
    input.version !== 1 ||
    input.task !== request.task ||
    input.model !== effectiveDecisionModel(request)
  )
    invalid('Decision result does not match the request.');
  const answers = parseDecisionAnswers(
    input.answers,
    decisionQuestions(request),
  );
  const disposition = decisionDisposition(request.task, answers);
  if (input.disposition !== disposition)
    invalid('Decision disposition does not match its evidence.');
  const provenance = record(input.provenance, 'provenance');
  if (
    provenance.questionVersion !== decisionQuestionVersion(request.task) ||
    typeof provenance.evaluatedAt !== 'string' ||
    !Number.isFinite(Date.parse(provenance.evaluatedAt)) ||
    typeof provenance.inputHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provenance.inputHash)
  )
    invalid('Invalid decision provenance.');
  const usage = parseDecisionUsage(input.usage);
  return {
    version: 1,
    task: request.task,
    model: effectiveDecisionModel(request),
    answers,
    disposition,
    provenance: {
      questionVersion: decisionQuestionVersion(request.task),
      evaluatedAt: provenance.evaluatedAt,
      inputHash: provenance.inputHash,
    },
    ...(usage ? { usage } : {}),
  };
}
export function safeParseDecisionResult(
  value: unknown,
  request: DecisionRequest,
) {
  return safe(() => parseDecisionResult(value, request));
}
export function isAcceptedDecision(result: DecisionResult): boolean {
  return result.disposition === 'accepted';
}
/** Actionable choice only. Review/hold/none results always abstain. */
export function chosenOption(
  result: DecisionResult,
  key?: string,
): string | null {
  if (!isAcceptedDecision(result)) return null;
  const answer = key
    ? result.answers[key]
    : Object.values(result.answers).find((answer) => answer.type === 'choice');
  return answer?.type === 'choice' &&
    !['hold', 'none', 'unclear'].includes(answer.choice)
    ? answer.choice
    : null;
}
