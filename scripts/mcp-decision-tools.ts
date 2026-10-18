/**
 * Optional Clef judgments over the live stage and explicitly supplied clips.
 * One call makes one suggestion; application uses the local scene/preset API.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  chosenOption,
  type DecisionRequest,
  type DecisionResult,
  type DecisionTask,
} from '../src/js/core/decision-model.ts';
import { requestDecision } from '../src/js/core/services/decision-client.ts';
import { asTextResponse, type createMcpServer } from './mcp-shared.ts';

interface SessionScene {
  name: string;
  description?: string;
  positions: Record<string, number>;
  modulators: unknown[];
}
export interface DecisionSessionContext {
  getState(): Promise<{ presetId: string | null; revision: string }>;
  captureImage(): Promise<string | null>;
  getScenes(): Promise<SessionScene[]>;
  selectPreset(
    id: string,
    expectedPresetId: string | null,
    revision: string,
  ): Promise<unknown>;
  recallScene(
    name: string,
    expectedPresetId: string | null,
    fingerprint: string,
    revision: string,
  ): Promise<unknown>;
}
interface SessionDecisionOptions {
  task: DecisionTask;
  prompt?: string;
  audio?: string;
  video?: string;
  candidates?: Array<{ id: string; description: string }>;
  apply?: boolean;
}

/** Testable orchestration; uncertainty and stale observations always abstain. */
export async function runSessionDecision(
  context: DecisionSessionContext,
  options: SessionDecisionOptions,
  submit: (request: DecisionRequest) => Promise<DecisionResult>,
) {
  const before = await context.getState();
  const soundTask =
    options.task === 'audio-match' || options.task === 'scene-choice';
  if (soundTask && !options.audio && !options.video)
    throw new Error(
      'A sound decision requires an explicitly supplied audio or video clip.',
    );
  if (options.apply && !soundTask)
    throw new Error('Only preset and scene suggestions can be applied.');
  const scenes =
    options.task === 'scene-choice'
      ? (await context.getScenes()).slice(0, 12)
      : [];
  if (options.task === 'scene-choice' && !scenes.length)
    throw new Error('Save a described performance scene first.');
  const request: DecisionRequest = {
    task: options.task,
    state: { presetId: before.presetId },
    ...(options.audio ? { audio: [options.audio] } : {}),
    ...(options.video ? { videos: [options.video] } : {}),
  };
  if (options.task === 'prompt-match')
    request.state.prompt = options.prompt ?? '';
  if (options.task === 'audio-match')
    request.state.candidates = options.candidates ?? [];
  if (options.task === 'scene-choice')
    request.state.scenes = scenes.map((scene, index) => ({
      id: `scene${index}`,
      description: scene.description || scene.name,
    }));
  if (soundTask && options.video) request.state.videoHasAudio = true;
  if (!soundTask && !options.video) {
    const image = await context.captureImage();
    if (!image) throw new Error('The live stage has no readable picture.');
    request.images = [image];
  }
  const result = await submit(request);
  const key = options.task === 'scene-choice' ? 'scene' : 'candidate';
  const selected =
    result.task === options.task ? chosenOption(result, key) : null;
  const candidate = options.candidates?.find(
    (candidate) => candidate.id === selected,
  );
  const sceneIndex = scenes.findIndex(
    (_scene, index) => `scene${index}` === selected,
  );
  const scene = sceneIndex >= 0 ? scenes[sceneIndex] : null;
  const suggestion =
    options.task === 'scene-choice'
      ? (scene?.name ?? null)
      : options.task === 'audio-match'
        ? (candidate?.id ?? null)
        : null;
  let applied = false;
  let reason: string | null = null;
  if (options.apply && suggestion) {
    const current = await context.getState();
    if (
      current.presetId !== before.presetId ||
      current.revision !== before.revision
    )
      reason =
        'The performance changed during inference; suggestion was not applied.';
    else if (scene) {
      const currentScene = (await context.getScenes()).find(
        (item) => item.name === scene.name,
      );
      if (JSON.stringify(currentScene) !== JSON.stringify(scene))
        reason =
          'The scene changed during inference; suggestion was not applied.';
      else {
        const action = await context.recallScene(
          scene.name,
          before.presetId,
          JSON.stringify(scene),
          before.revision,
        );
        applied = action !== false;
      }
    } else if (candidate) {
      const action = await context.selectPreset(
        candidate.id,
        before.presetId,
        before.revision,
      );
      applied = action !== false;
    }
  }
  return { result, suggestion, applied, reason };
}

function clipFile(file: string, kind: 'audio' | 'video'): string {
  const formats: Record<string, string> =
    kind === 'audio'
      ? { '.wav': 'audio/wav', '.mp3': 'audio/mpeg' }
      : { '.webm': 'video/webm', '.mp4': 'video/mp4' };
  const mime = formats[path.extname(file).toLowerCase()];
  if (!mime) throw new Error('Use WAV/MP3 audio or WebM/MP4 video.');
  if (statSync(file).size > (kind === 'audio' ? 2 : 4) * 1024 * 1024)
    throw new Error('Clip exceeds the decision service media limit.');
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

export function registerDecisionTools(
  server: ReturnType<typeof createMcpServer>,
  getSession: (id: string) => { page: import('playwright').Page } | null,
) {
  server.registerTool(
    'session_decide',
    {
      description:
        'Ask Clef to profile/review the stage, compare its picture with a prompt, suggest a preset for an explicit music clip, or choose among saved scenes. Sends a stage image and any supplied clip to the configured endpoint. No microphone is opened or live audio recorded. Sound tasks need a short WAV/MP3 audioFile or WebM/MP4 videoFile WITH sound. Default is suggestion only; apply:true changes only an accepted, still-current offered preset/scene. One call per musical phrase; local ramps handle movement. This never certifies flashing, parity, synchronization or performance.',
      inputSchema: z.object({
        sessionId: z.string(),
        task: z.enum([
          'visual-profile',
          'prompt-match',
          'audio-match',
          'scene-choice',
          'capture-review',
        ]),
        endpoint: z
          .url()
          .optional()
          .describe(
            'Configured decision API URL; otherwise STIMS_DECISION_ENDPOINT. Required on the dev server.',
          ),
        prompt: z.string().max(4096).optional(),
        audioFile: z
          .string()
          .optional()
          .describe('Explicit local WAV/MP3 clip to upload, at most 2 MiB.'),
        videoFile: z
          .string()
          .optional()
          .describe(
            'Explicit local WebM/MP4 clip to upload, at most 4 MiB. Sound tasks require its soundtrack.',
          ),
        candidates: z
          .array(
            z.object({ id: z.string(), description: z.string().max(1000) }),
          )
          .min(1)
          .max(12)
          .optional()
          .describe(
            'Audio-match shortlist, from existing search or catalog retrieval.',
          ),
        apply: z.boolean().default(false),
      }),
    },
    async ({
      sessionId,
      task,
      endpoint,
      prompt,
      audioFile,
      videoFile,
      candidates,
      apply,
    }) => {
      const session = getSession(sessionId);
      if (!session) return asTextResponse('Session not found or expired.');
      const url = endpoint ?? process.env.STIMS_DECISION_ENDPOINT;
      if (!url)
        return asTextResponse(
          'Set STIMS_DECISION_ENDPOINT or pass endpoint. No media was transmitted.',
        );
      try {
        const context: DecisionSessionContext = {
          getState: () =>
            session.page.evaluate(() => ({
              presetId: window.__stims_agent?.getState().presetId ?? null,
              revision:
                window.__stims_agent?.getPerformanceRevision() ?? 'unavailable',
            })),
          captureImage: () =>
            session.page.evaluate(
              () => window.__stims_agent?.captureImage() ?? null,
            ),
          getScenes: () =>
            session.page.evaluate(
              () => window.__stims_live?.listScenes() ?? [],
            ),
          selectPreset: (id, expected, revision) =>
            session.page.evaluate(
              async ({ id, expected, revision }) => {
                if (
                  !window.__stims_agent ||
                  window.__stims_agent.getState().presetId !== expected ||
                  window.__stims_agent.getPerformanceRevision() !== revision
                )
                  return false;
                return (await window.__stims_agent.run('select-preset', { id }))
                  .ok;
              },
              { id, expected, revision },
            ),
          recallScene: (name, expected, fingerprint, revision) =>
            session.page.evaluate(
              async ({ name, expected, fingerprint, revision }) => {
                if (
                  !window.__stims_live ||
                  window.__stims_agent?.getState().presetId !== expected ||
                  window.__stims_agent?.getPerformanceRevision() !== revision
                )
                  return false;
                const scene = window.__stims_live
                  .listScenes()
                  .find((scene) => scene.name === name);
                if (JSON.stringify(scene) !== fingerprint) return false;
                const outcome = await window.__stims_live.recallScene(name, {
                  durationMs: 4000,
                });
                return outcome.superseded.length === 0;
              },
              { name, expected, fingerprint, revision },
            ),
        };
        const outcome = await runSessionDecision(
          context,
          {
            task,
            prompt,
            candidates,
            apply,
            ...(audioFile ? { audio: clipFile(audioFile, 'audio') } : {}),
            ...(videoFile ? { video: clipFile(videoFile, 'video') } : {}),
          },
          (request) => requestDecision(request, { endpoint: url }),
        );
        return asTextResponse(JSON.stringify(outcome, null, 2));
      } catch (error) {
        return asTextResponse(
          `Decision unavailable: ${error instanceof Error ? error.message : 'request failed'}`,
        );
      }
    },
  );
}
