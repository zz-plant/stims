/**
 * Runs bounded Clef judgments over captures or catalog previews, promotes
 * reviewed visual search tags, and scores decisions against human labels.
 *
 * bun run lab:decisions -- --visual-report scratch/preset-lab/<id>/visual/visual.json --endpoint https://<preview>/api/decide
 * bun run lab:decisions -- --request items.json --endpoint https://<preview>/api/decide --out scratch/decisions/run.json
 * bun run lab:decisions -- --apply scratch/decisions/run.json
 * bun run lab:decisions -- --report scratch/decisions/run.json --labels labels.jsonl
 *
 * Request items contain {id,request:{task,state,model?},imageFiles?,audioFiles?,videoFiles?}.
 * A request file may contain one item, an array, or {items:[...]}. Saved reports
 * retain state and evidence hashes but omit media bytes. Model results remain
 * observations; promotion never changes parity, safety or performance fields.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  type DecisionRequest,
  decisionRecord,
  effectiveDecisionModel,
  parseDecisionRequest,
  parseDecisionResult,
} from '../src/js/core/decision-model.ts';
import {
  type DecisionCaptureContext,
  type DecisionLabel,
  type DecisionLabRecord,
  evaluateDecisionRecords,
  MAX_DECISION_RECORDS,
  promoteVisualProfiles,
  revalidateVisualProfiles,
} from '../src/js/core/decision-workflows.ts';
import {
  type DecisionFetch,
  requestDecision,
} from '../src/js/core/services/decision-client.ts';

export interface DecisionLabItem {
  id: string;
  presetId?: string;
  family?: string;
  sourceHash?: string;
  context?: DecisionCaptureContext;
  request: DecisionRequest;
  imageFiles?: string[];
  audioFiles?: string[];
  videoFiles?: string[];
}

const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function dataUrl(file: string): string {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime)
    throw new Error(`Unsupported media extension: ${path.extname(file)}`);
  if (statSync(file).size > 4 * 1024 * 1024)
    throw new Error('Media file exceeds the 4 MiB lab limit.');
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

/** Sequential requests respect the service's bounded per-request work. */
export async function runDecisionLab(
  items: readonly DecisionLabItem[],
  options: { endpoint: string; fetcher?: DecisionFetch; signal?: AbortSignal },
): Promise<DecisionLabRecord[]> {
  if (items.length > 1000)
    throw new Error('A decision run supports at most 1000 items.');
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error('Duplicate decision item ids.');
  const records: DecisionLabRecord[] = [];
  for (const item of items) {
    options.signal?.throwIfAborted();
    const record: DecisionLabRecord = {
      id: item.id,
      ...(item.presetId ? { presetId: item.presetId } : {}),
      ...(item.family ? { family: item.family } : {}),
      ...(item.sourceHash ? { sourceHash: item.sourceHash } : {}),
      ...(item.context ? { context: item.context } : {}),
      request: {
        task: item.request.task,
        state: item.request.state,
        ...(item.request.model ? { model: item.request.model } : {}),
      },
      latencyMs: 0,
    };
    const start = performance.now();
    try {
      const request = parseDecisionRequest({
        ...item.request,
        images: [
          ...(item.request.images ?? []),
          ...(item.imageFiles ?? []).map(dataUrl),
        ],
        audio: [
          ...(item.request.audio ?? []),
          ...(item.audioFiles ?? []).map(dataUrl),
        ],
        videos: [
          ...(item.request.videos ?? []),
          ...(item.videoFiles ?? []).map(dataUrl),
        ],
      });
      record.request.model = effectiveDecisionModel(request);
      record.mediaHashes = [
        ...(request.images ?? []),
        ...(request.audio ?? []),
        ...(request.videos ?? []),
      ].map(sha256);
      record.result = await requestDecision(request, options);
    } catch (error) {
      record.error =
        error instanceof Error ? error.message : 'Decision request failed.';
    }
    record.latencyMs = performance.now() - start;
    records.push(record);
    // Stop rather than flooding a throttled service. Completed records can be
    // reviewed; the remaining input items can be submitted in a later run.
    if (record.error?.includes('429')) break;
  }
  return records;
}

interface VisualReportInput {
  presetId: string;
  renderer: 'webgl' | 'webgpu';
  viewport?: { width: number; height: number };
  sourceHash?: string;
  scenarios?: Record<
    string,
    { backend: string | null; loadError: string | null }
  >;
  artifacts: { contactSheet: string };
}

export function buildVisualReportItem(
  report: VisualReportInput,
  prompt?: string,
): DecisionLabItem {
  const verified = ['silence', 'demo', 'steady'].every(
    (name) =>
      report.scenarios?.[name]?.backend === report.renderer &&
      report.scenarios[name].loadError === null,
  );
  return {
    id: `${report.presetId}-${report.renderer}-${report.viewport ? `${report.viewport.width}x${report.viewport.height}` : 'unknown'}-${prompt ? 'match' : 'profile'}`,
    presetId: report.presetId,
    // Only the capture instrument may bind source to an existing picture.
    // Legacy reports remain reviewable, but cannot be promoted.
    ...(verified && /^[a-f0-9]{64}$/.test(report.sourceHash ?? '')
      ? { sourceHash: report.sourceHash }
      : {}),
    ...(report.viewport && verified
      ? {
          context: {
            renderer: report.renderer,
            width: report.viewport.width,
            height: report.viewport.height,
            audioScenario: 'silence+demo+steady',
          },
        }
      : {}),
    request: prompt
      ? { task: 'prompt-match', state: { prompt } }
      : { task: 'visual-profile', state: {} },
    imageFiles: [report.artifacts.contactSheet],
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function saveJson(file: string, value: unknown) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function requireObject(value: unknown): Record<string, unknown> {
  if (!decisionRecord(value)) throw new Error('Expected a JSON object.');
  return value;
}
function requireText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Expected non-empty text.');
  return value;
}
function files(value: unknown, root: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error('Media files must be an array of paths.');
  return value.map((entry) => path.resolve(root, entry));
}
function captureContext(value: unknown): DecisionCaptureContext | undefined {
  if (value === undefined) return undefined;
  const item = requireObject(value);
  if (
    (item.renderer !== 'webgl' && item.renderer !== 'webgpu') ||
    typeof item.width !== 'number' ||
    typeof item.height !== 'number' ||
    item.width <= 0 ||
    item.height <= 0
  )
    throw new Error('Invalid capture context.');
  return {
    renderer: item.renderer,
    width: item.width,
    height: item.height,
    audioScenario: requireText(item.audioScenario),
  };
}

function readItems(file: string): DecisionLabItem[] {
  const value = readJson(file);
  const values = Array.isArray(value)
    ? value
    : decisionRecord(value) && Array.isArray(value.items)
      ? value.items
      : [value];
  return values.map((value) => {
    const item = requireObject(value);
    // Validate the complete request only after file evidence has been attached.
    const raw = requireObject(item.request);
    const task = requireText(raw.task);
    if (
      ![
        'visual-profile',
        'prompt-match',
        'audio-match',
        'scene-choice',
        'capture-review',
      ].includes(task)
    )
      throw new Error('Unsupported decision task.');
    const request = { ...raw, task } as DecisionRequest;
    return {
      id: requireText(item.id),
      request,
      ...(item.presetId ? { presetId: requireText(item.presetId) } : {}),
      ...(item.family ? { family: requireText(item.family) } : {}),
      ...(item.sourceHash ? { sourceHash: requireText(item.sourceHash) } : {}),
      context: captureContext(item.context),
      imageFiles: files(item.imageFiles, path.dirname(path.resolve(file))),
      audioFiles: files(item.audioFiles, path.dirname(path.resolve(file))),
      videoFiles: files(item.videoFiles, path.dirname(path.resolve(file))),
    };
  });
}

function readReport(file: string): DecisionLabRecord[] {
  const document = requireObject(readJson(file));
  if (document.version !== 1 || !Array.isArray(document.records))
    throw new Error('Unsupported decision report.');
  return document.records.map((value) => {
    const item = requireObject(value);
    const rawRequest = requireObject(item.request);
    const task = requireText(rawRequest.task);
    if (
      ![
        'visual-profile',
        'prompt-match',
        'audio-match',
        'scene-choice',
        'capture-review',
      ].includes(task)
    )
      throw new Error('Unsupported report task.');
    if (
      rawRequest.model !== undefined &&
      rawRequest.model !== 'clef-flash' &&
      rawRequest.model !== 'clef-omni'
    )
      throw new Error('Unsupported report model.');
    const request: DecisionRequest = {
      task: task as DecisionRequest['task'],
      state: requireObject(rawRequest.state) as DecisionRequest['state'],
      ...(rawRequest.model ? { model: rawRequest.model } : {}),
    };
    const result =
      item.result === undefined
        ? undefined
        : parseDecisionResult(item.result, request);
    if (
      typeof item.latencyMs !== 'number' ||
      !Number.isFinite(item.latencyMs) ||
      item.latencyMs < 0
    )
      throw new Error('Invalid report latency.');
    return {
      id: requireText(item.id),
      request,
      result,
      latencyMs: item.latencyMs,
      ...(item.presetId ? { presetId: requireText(item.presetId) } : {}),
      ...(item.family ? { family: requireText(item.family) } : {}),
      ...(item.sourceHash ? { sourceHash: requireText(item.sourceHash) } : {}),
      ...(item.error ? { error: requireText(item.error) } : {}),
      context: captureContext(item.context),
    };
  });
}

function readLabels(file: string): DecisionLabel[] {
  const raw = readFileSync(file, 'utf8').trim();
  const values: unknown[] = raw.startsWith('[')
    ? JSON.parse(raw)
    : raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  return values.map((value) => {
    const item = requireObject(value);
    const expected = requireObject(item.expected);
    for (const answer of Object.values(expected))
      if (
        !['boolean', 'string', 'number'].includes(typeof answer) ||
        (typeof answer === 'number' && !Number.isFinite(answer))
      )
        throw new Error('Invalid human label.');
    return {
      id: requireText(item.id),
      family: requireText(item.family),
      expected: expected as DecisionLabel['expected'],
    };
  });
}

function catalogFile(root: string) {
  return path.join(root, 'public/milkdrop-presets/catalog.json');
}
function readCatalog(root: string) {
  const doc = requireObject(readJson(catalogFile(root)));
  if (!Array.isArray(doc.presets))
    throw new Error('Expected a preset catalog.');
  return {
    ...doc,
    presets: doc.presets.map((value) => {
      const entry = requireObject(value);
      return {
        ...entry,
        id: requireText(entry.id),
        file: requireText(entry.file),
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
      };
    }),
  };
}

async function main(args: string[]) {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const all = (flag: string) =>
    args.flatMap((arg, index) =>
      arg === flag && args[index + 1] ? [args[index + 1]] : [],
    );
  if (args.includes('--help')) {
    console.log(
      'lab:decisions --request items.json | --visual-report report.json [--prompt text] | --catalog --ids id,id --previews directory\n  Inference: --endpoint https://<preview>/api/decide [--out report.json] [--limit 20]\n  Publish reviewed tags: --apply report.json\n  Evaluate: --report report.json --labels labels.jsonl [--out scores.json]\nReports omit media bytes. Promotion requires matching source hashes and both backends at both aspects.',
    );
    return;
  }
  const root = process.cwd();
  const output = value('--out') ?? 'scratch/decisions/report.json';
  const applyFile = value('--apply');
  if (applyFile) {
    const catalog = readCatalog(root);
    const manifestPath = path.join(
      root,
      'public/milkdrop-presets/decision-profiles.json',
    );
    const previous = existsSync(manifestPath)
      ? requireObject(readJson(manifestPath))
      : null;
    const rawProfiles =
      previous?.version === 1 && Array.isArray(previous.profiles)
        ? previous.profiles
        : [];
    if (rawProfiles.length > MAX_DECISION_RECORDS)
      throw new Error('Too many saved decision profiles');
    const previousProfiles = rawProfiles.map((value) => {
      const profile = requireObject(value);
      if (
        !Array.isArray(profile.tags) ||
        profile.tags.some((tag) => typeof tag !== 'string')
      )
        throw new Error('Invalid saved decision profile tags');
      return {
        ...profile,
        id: requireText(profile.id),
        sourceHash: requireText(profile.sourceHash),
        tags: profile.tags as string[],
      };
    });
    const sourceHashOf = (file: string) => {
      const source = path.resolve(root, 'public', file.replace(/^\//, ''));
      return existsSync(source) ? sha256(readFileSync(source)) : null;
    };
    const current = revalidateVisualProfiles(
      catalog,
      previousProfiles,
      sourceHashOf,
    );
    const promoted = promoteVisualProfiles(
      current.catalog,
      readReport(applyFile),
      sourceHashOf,
    );
    if (!promoted.manifest.profiles.length && !previousProfiles.length)
      throw new Error(
        'No profiles meet the source and four-context promotion policy.',
      );
    const changed = new Set(
      promoted.manifest.profiles.map((profile) => profile.id),
    );
    const manifest = {
      version: 1,
      profiles: [
        ...current.profiles.filter(
          (profile) =>
            decisionRecord(profile) && !changed.has(String(profile.id)),
        ),
        ...promoted.manifest.profiles,
      ],
    } satisfies { version: number; profiles: unknown[] };
    if (manifest.profiles.length > MAX_DECISION_RECORDS)
      throw new Error('Too many merged decision profiles');
    saveJson(catalogFile(root), promoted.catalog);
    saveJson(manifestPath, manifest);
    console.log(
      `Promoted ${promoted.manifest.profiles.length} reviewed visual profiles; invalidated ${previousProfiles.length - current.profiles.length} stale profiles. Run catalog integrity and fidelity checks.`,
    );
    return;
  }
  const report = value('--report');
  const labels = value('--labels');
  if (report && labels) {
    const scores = evaluateDecisionRecords(
      readReport(report),
      readLabels(labels),
    );
    saveJson(output, scores);
    console.log(JSON.stringify(scores, null, 2));
    return;
  }
  let items: DecisionLabItem[] = [];
  const requestFile = value('--request');
  if (requestFile) items = readItems(requestFile);
  for (const file of all('--visual-report')) {
    const raw = requireObject(readJson(file));
    const artifacts = requireObject(raw.artifacts);
    if (raw.renderer !== 'webgl' && raw.renderer !== 'webgpu')
      throw new Error('Visual report needs the actual renderer.');
    const id = requireText(raw.presetId);
    const entry = readCatalog(root).presets.find((entry) => entry.id === id);
    if (!entry)
      throw new Error('Visual report preset is absent from this catalog.');
    const viewport =
      raw.viewport === undefined ? undefined : requireObject(raw.viewport);
    if (
      viewport &&
      (typeof viewport.width !== 'number' ||
        typeof viewport.height !== 'number')
    )
      throw new Error('Invalid visual report viewport.');
    items.push(
      buildVisualReportItem(
        {
          presetId: id,
          renderer: raw.renderer,
          scenarios: Object.fromEntries(
            ['silence', 'demo', 'steady'].map((name) => {
              const scenarios = decisionRecord(raw.scenarios)
                ? raw.scenarios
                : {};
              const scenario = decisionRecord(scenarios[name])
                ? scenarios[name]
                : {};
              return [
                name,
                {
                  backend:
                    typeof scenario.backend === 'string'
                      ? scenario.backend
                      : null,
                  loadError: scenario.loadError === null ? null : 'unverified',
                },
              ];
            }),
          ),
          ...(typeof raw.sourceHash === 'string'
            ? { sourceHash: raw.sourceHash }
            : {}),
          ...(viewport
            ? {
                viewport: {
                  width: Number(viewport.width),
                  height: Number(viewport.height),
                },
              }
            : {}),
          artifacts: {
            contactSheet: path.resolve(
              root,
              requireText(artifacts.contactSheet),
            ),
          },
        },
        value('--prompt'),
      ),
    );
  }
  if (args.includes('--catalog')) {
    const ids = value('--ids')?.split(',');
    if (!ids?.length)
      throw new Error(
        'Catalog inference requires an explicit --ids shortlist.',
      );
    const previews = value('--previews') ?? 'public/milkdrop-presets/previews';
    items.push(
      ...readCatalog(root)
        .presets.filter((entry) => ids.includes(entry.id))
        .map((entry) => ({
          id: entry.id,
          presetId: entry.id,
          sourceHash: sha256(
            readFileSync(
              path.resolve(root, 'public', entry.file.replace(/^\//, '')),
            ),
          ),
          request: { task: 'visual-profile' as const, state: {} },
          imageFiles: [path.resolve(previews, `${entry.id}.png`)],
        })),
    );
  }
  if (!items.length)
    throw new Error(
      'Choose --request, --visual-report, --catalog, --apply, or --report with --labels.',
    );
  const endpoint = value('--endpoint');
  if (!endpoint)
    throw new Error(
      'Inference requires an explicit --endpoint. No production calls are made by default.',
    );
  const limit = Number(value('--limit') ?? 20);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('--limit must be 1 to 1000.');
  if (items.length > limit)
    throw new Error(
      `Selected ${items.length} items; raise --limit explicitly to submit them.`,
    );
  const records = await runDecisionLab(items, { endpoint });
  saveJson(output, { version: 1, records });
  console.log(
    `Saved ${records.length} decisions (${records.filter((record) => record.error).length} failed) to ${output}.`,
  );
  if (records.some((record) => record.error) || records.length !== items.length)
    process.exitCode = 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Decision lab failed.',
    );
    process.exitCode = 1;
  });
}
