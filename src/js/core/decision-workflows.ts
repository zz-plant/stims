/**
 * Offline policy for decision-assisted catalog curation and evaluation.
 * Model observations never promote compatibility, safety or performance data.
 */
import {
  type DecisionRequest,
  type DecisionResult,
  decisionQuestions,
} from './decision-model.ts';

export interface DecisionCaptureContext {
  renderer: 'webgl' | 'webgpu';
  width: number;
  height: number;
  audioScenario: string;
}

/** Media bytes are deliberately omitted from saved lab reports. */
export interface DecisionLabRecord {
  id: string;
  presetId?: string;
  family?: string;
  sourceHash?: string;
  context?: DecisionCaptureContext;
  request: Pick<DecisionRequest, 'task' | 'state' | 'model'>;
  mediaHashes?: string[];
  result?: DecisionResult;
  error?: string;
  latencyMs: number;
}

const MOTIFS = [
  'tunnel',
  'geometric',
  'particles',
  'waveform',
  'organic',
  'radial',
] as const;
const TAG_PROBABILITY = 0.9;
const MAX_DECISION_RECORDS = 1000;

/** Conservative candidate labels, pending human review and contextual checks. */
export function profileSearchTags(result: DecisionResult): string[] {
  if (result.task !== 'visual-profile' || result.disposition !== 'accepted')
    return [];
  const enough = result.answers.sufficient_evidence;
  if (enough?.type !== 'noul' || enough.noul < TAG_PROBABILITY) return [];
  const tags: string[] = [];
  for (const motif of MOTIFS) {
    const answer = result.answers[`motif_${motif}`];
    if (
      answer?.type === 'noul' &&
      Number.isFinite(answer.noul) &&
      answer.noul >= TAG_PROBABILITY &&
      answer.noul <= 1
    ) {
      tags.push(`look:${motif}`);
    }
  }
  const palette = result.answers.palette;
  if (
    palette?.type === 'choice' &&
    ['warm', 'cool', 'mixed', 'monochrome'].includes(palette.choice) &&
    palette.probabilities[palette.choice] >= TAG_PROBABILITY
  ) {
    tags.push(`look:${palette.choice}`);
  }
  return tags;
}

function contextKey(
  context: DecisionCaptureContext | undefined,
): string | null {
  if (
    !context ||
    !['webgl', 'webgpu'].includes(context.renderer) ||
    !Number.isFinite(context.width) ||
    !Number.isFinite(context.height) ||
    context.width <= 0 ||
    context.height <= 0
  )
    return null;
  return `${context.renderer}:${context.width < context.height ? 'portrait' : 'landscape'}`;
}

type Catalog = {
  presets: Array<{ id: string; file: string; tags?: string[] }>;
};

export interface DecisionProfileManifest {
  version: 1;
  profiles: Array<{
    id: string;
    sourceHash: string;
    tags: string[];
    contexts: Array<
      DecisionCaptureContext & {
        provenance: DecisionResult['provenance'];
        model: DecisionResult['model'];
      }
    >;
  }>;
}

/**
 * Publish only the intersection of observations on both backends and aspects.
 * Source changes invalidate the whole group. The catalog is copied, not mutated.
 */
export function promoteVisualProfiles<T extends Catalog>(
  catalog: T,
  records: readonly DecisionLabRecord[],
  sourceHashOf: (file: string) => string | null,
): { catalog: T; manifest: DecisionProfileManifest } {
  if (records.length > MAX_DECISION_RECORDS)
    throw new Error('Too many decision records');
  const next = structuredClone(catalog);
  const manifest: DecisionProfileManifest = { version: 1, profiles: [] };
  const required = [
    'webgl:portrait',
    'webgl:landscape',
    'webgpu:portrait',
    'webgpu:landscape',
  ];
  for (const entry of next.presets) {
    const group = records.filter(
      (record) =>
        record.presetId === entry.id &&
        record.request.task === 'visual-profile',
    );
    if (!group.length) continue;
    const hash = sourceHashOf(entry.file);
    if (
      !hash ||
      group.some(
        (record) =>
          record.sourceHash !== hash ||
          !record.result ||
          record.error ||
          !contextKey(record.context),
      )
    )
      continue;
    const contexts = new Set(group.map((record) => contextKey(record.context)));
    if (required.some((key) => !contexts.has(key))) continue;
    const tags = group.map((record) =>
      record.result ? profileSearchTags(record.result) : [],
    );
    const common = tags[0].filter((tag) =>
      tags.every((other) => other.includes(tag)),
    );
    if (!common.length) continue;
    entry.tags = [
      ...(entry.tags ?? []).filter((tag) => !tag.startsWith('look:')),
      ...common,
    ];
    manifest.profiles.push({
      id: entry.id,
      sourceHash: hash,
      tags: common,
      contexts: group.flatMap((record) =>
        record.context && record.result
          ? [
              {
                ...record.context,
                provenance: record.result.provenance,
                model: record.result.model,
              },
            ]
          : [],
      ),
    });
  }
  return { catalog: next, manifest };
}

export interface DecisionLabel {
  id: string;
  family: string;
  expected: Record<string, boolean | string | number>;
}

/** Measure accepted accuracy alongside coverage; Brier covers binary labels. */
export function evaluateDecisionRecords(
  records: readonly DecisionLabRecord[],
  labels: readonly DecisionLabel[],
) {
  if (
    records.length > MAX_DECISION_RECORDS ||
    labels.length > MAX_DECISION_RECORDS
  )
    throw new Error('Too many decision records or labels');
  const byId = new Map(records.map((record) => [record.id, record]));
  if (
    byId.size !== records.length ||
    new Set(labels.map((label) => label.id)).size !== labels.length
  )
    throw new Error('Duplicate decision or label ids');
  let accepted = 0;
  let acceptedQuestions = 0;
  let correct = 0;
  let failed = 0;
  const briers: number[] = [];
  const latencies: number[] = [];
  for (const label of labels) {
    const record = byId.get(label.id);
    if (!Object.keys(label.expected).length)
      throw new Error(`Empty labels: ${label.id}`);
    if (record) {
      const questions = decisionQuestions(record.request);
      for (const [key, expected] of Object.entries(label.expected)) {
        const question = questions[key];
        if (
          !question ||
          (question.type === 'noul'
            ? typeof expected !== 'boolean'
            : question.type === 'choice'
              ? typeof expected !== 'string' ||
                !Object.hasOwn(question.criteria, expected)
              : typeof expected !== 'number' ||
                !Number.isInteger(expected) ||
                expected < 0 ||
                expected >= question.criteria.length)
        ) {
          throw new Error(`Invalid label ${label.id}.${key}`);
        }
      }
    }
    if (record && Number.isFinite(record.latencyMs))
      latencies.push(record.latencyMs);
    if (!record?.result || record.error) {
      failed += 1;
      continue;
    }
    const result = record.result;
    if (result.disposition === 'accepted') accepted += 1;
    for (const [key, expected] of Object.entries(label.expected)) {
      if (result.disposition === 'accepted') acceptedQuestions += 1;
      const answer = result.answers[key];
      if (!answer) continue;
      let prediction: boolean | string | number;
      if (answer.type === 'noul') {
        prediction = answer.noul >= 0.5;
        if (typeof expected === 'boolean')
          briers.push((answer.noul - Number(expected)) ** 2);
      } else if (answer.type === 'choice') prediction = answer.choice;
      else {
        const mode = Object.entries(answer.probabilities).sort(
          (left, right) => right[1] - left[1],
        )[0];
        prediction = mode ? Number(mode[0]) : Number.NaN;
      }
      if (result.disposition === 'accepted') {
        if (prediction === expected) correct += 1;
      }
    }
  }
  latencies.sort((left, right) => left - right);
  return {
    itemCount: labels.length,
    acceptedCount: accepted,
    failedCount: failed,
    coverage: labels.length ? accepted / labels.length : 0,
    acceptedAccuracy: acceptedQuestions ? correct / acceptedQuestions : null,
    brier: briers.length
      ? briers.reduce((sum, score) => sum + score, 0) / briers.length
      : null,
    familyCount: new Set(labels.map((label) => label.family)).size,
    p95LatencyMs:
      latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
  };
}
