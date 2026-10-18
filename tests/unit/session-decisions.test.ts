import { describe, expect, test } from 'bun:test';
import {
  type DecisionSessionContext,
  runSessionDecision,
} from '../../scripts/mcp-decision-tools.ts';
import type {
  DecisionRequest,
  DecisionResult,
} from '../../src/js/core/decision-model.ts';

function choice(
  task: 'audio-match' | 'scene-choice',
  option: string,
  disposition: 'accepted' | 'review' = 'accepted',
): DecisionResult {
  return {
    version: 1,
    task,
    model: 'clef-omni',
    disposition,
    provenance: {
      questionVersion: 'stims-clef-v1',
      evaluatedAt: '2026-10-17T00:00:00Z',
      inputHash: 'a'.repeat(64),
    },
    answers: {
      [task === 'scene-choice' ? 'scene' : 'candidate']: {
        type: 'choice',
        choice: option,
        confidence: 0.99,
        probabilities: { [option]: 0.99, hold: 0.01 },
      },
      sufficient_evidence: { type: 'noul', noul: 0.99 },
    },
  };
}

function context() {
  const actions: string[] = [];
  const state = {
    presetId: 'original' as string | null,
    revision: 'original:0',
  };
  const ctx: DecisionSessionContext = {
    getState: async () => ({ ...state }),
    captureImage: async () => 'data:image/png;base64,AAAA',
    getScenes: async () => [
      {
        name: 'Soft wash',
        description: 'slow flowing shapes',
        positions: { warp: 0.5 },
        modulators: [],
      },
    ],
    selectPreset: async (id) => {
      actions.push(id);
    },
    recallScene: async (name) => {
      actions.push(name);
    },
  };
  return { ctx, actions, state };
}

describe('live session decision workflows', () => {
  test('an accepted scene is suggested without applying unless explicitly asked', async () => {
    const { ctx, actions } = context();
    const out = await runSessionDecision(
      ctx,
      { task: 'scene-choice', audio: 'data:audio/wav;base64,AAAA' },
      async () => choice('scene-choice', 'scene0'),
    );
    expect(out.suggestion).toBe('Soft wash');
    expect(out.applied).toBe(false);
    expect(actions).toEqual([]);
  });

  test('explicit apply recalls only a scene actually offered to the model', async () => {
    const { ctx, actions } = context();
    const out = await runSessionDecision(
      ctx,
      {
        task: 'scene-choice',
        audio: 'data:audio/wav;base64,AAAA',
        apply: true,
      },
      async () => choice('scene-choice', 'scene0'),
    );
    expect(out.applied).toBe(true);
    expect(actions).toEqual(['Soft wash']);
  });

  test('review or fabricated candidate choices never change the session', async () => {
    const { ctx, actions } = context();
    for (const result of [
      choice('audio-match', 'p', 'review'),
      choice('audio-match', 'invented'),
    ]) {
      const out = await runSessionDecision(
        ctx,
        {
          task: 'audio-match',
          audio: 'data:audio/wav;base64,AAAA',
          candidates: [{ id: 'p', description: 'flowing shapes' }],
          apply: true,
        },
        async () => result,
      );
      expect(out.applied).toBe(false);
    }
    expect(actions).toEqual([]);
  });

  test('a preset change during inference invalidates automatic application', async () => {
    const { ctx, actions, state } = context();
    const out = await runSessionDecision(
      ctx,
      {
        task: 'scene-choice',
        audio: 'data:audio/wav;base64,AAAA',
        apply: true,
      },
      async () => {
        state.presetId = 'changed';
        return choice('scene-choice', 'scene0');
      },
    );
    expect(out.applied).toBe(false);
    expect(actions).toEqual([]);
  });

  test('newer controls and same-id edits invalidate automatic application', async () => {
    const { ctx, actions, state } = context();
    const out = await runSessionDecision(
      ctx,
      {
        task: 'scene-choice',
        audio: 'data:audio/wav;base64,AAAA',
        apply: true,
      },
      async () => {
        state.revision = 'original:1';
        return choice('scene-choice', 'scene0');
      },
    );
    expect(out.applied).toBe(false);
    expect(actions).toEqual([]);
  });

  test('sound tasks require explicit clip input and visual tasks capture the stage', async () => {
    const { ctx } = context();
    let request: DecisionRequest | undefined;
    await expect(
      runSessionDecision(
        ctx,
        {
          task: 'audio-match',
          candidates: [{ id: 'p', description: 'shapes' }],
        },
        async () => choice('audio-match', 'p'),
      ),
    ).rejects.toThrow('clip');
    await runSessionDecision(ctx, { task: 'capture-review' }, async (input) => {
      request = input;
      return {
        ...choice('scene-choice', 'hold'),
        task: 'capture-review',
        disposition: 'review',
      };
    });
    expect(request?.images).toHaveLength(1);
  });
});
