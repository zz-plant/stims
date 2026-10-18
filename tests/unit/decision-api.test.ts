import { afterEach, describe, expect, jest, test } from 'bun:test';
import {
  readDecisionBody,
  runDecisionQuestions,
} from '../../functions/api/_decision-model.ts';
import { onRequest } from '../../functions/api/decide.ts';
import { onRequest as generate } from '../../functions/api/generate-preset.ts';
import {
  DECISION_LIMITS,
  type DecisionAnswers,
  type DecisionQuestions,
} from '../../src/js/core/decision-model.ts';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const capture = {
  task: 'capture-review',
  state: { measured: { motion: 0.2 } },
  images: [image],
};
const goodAnswers = {
  sufficient_evidence: { type: 'noul', noul: 0.95 },
  visible: { type: 'noul', noul: 0.95 },
  composition_coherent: { type: 'noul', noul: 0.95 },
  visible_artifacts: { type: 'noul', noul: 0.05 },
};
function post(value: unknown): Request {
  return new Request('https://toil.fyi/api/decide', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': '192.0.2.1',
    },
    body: JSON.stringify(value),
  });
}
function provider(answers: unknown = goodAnswers): WorkersAI {
  return {
    run: async (_model, inputs) => ({
      model: inputs.model,
      answers,
      usage: { input_tokens: 10, output_tokens: 0 },
    }),
  };
}
const routingQuestions: DecisionQuestions = {
  choice: {
    type: 'choice',
    instructions: 'Choose',
    criteria: { a: 'a', b: 'b' },
  },
};

afterEach(() => jest.useRealTimers());

describe('bounded decision endpoint', () => {
  test('rejects a JSON array task before inference', async () => {
    let calls = 0;
    const response = await onRequest({
      request: post({ ...capture, task: ['capture-review'] }),
      env: {
        AI: {
          run: async () => {
            calls++;
            return {};
          },
        },
      },
    });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
  });
  for (const declared of [false, true]) {
    test(`returns body overflow with ${declared ? 'declared' : 'counted'} length when stream cancellation never settles`, async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (!declared)
            controller.enqueue(new Uint8Array(DECISION_LIMITS.bodyBytes + 1));
        },
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      });
      const request = new Request('https://toil.fyi/api/decide', {
        method: 'POST',
        body: stream,
        headers: declared
          ? { 'Content-Length': String(DECISION_LIMITS.bodyBytes + 1) }
          : {},
      });
      await expect(readDecisionBody(request)).rejects.toMatchObject({
        status: 413,
      });
      expect(cancelled).toBe(true);
      expect(stream.locked).toBe(false);
    }, 500);
  }
  test('returns the upload deadline when stream cancellation never settles', async () => {
    jest.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => {});
      },
    });
    const request = new Request('https://toil.fyi/api/decide', {
      method: 'POST',
      body: stream,
    });
    const pending = readDecisionBody(request);
    jest.advanceTimersByTime(12_001);
    await expect(pending).rejects.toMatchObject({ status: 504 });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  }, 500);
  test('handles preflight, methods and missing AI without inference', async () => {
    expect(
      (
        await onRequest({
          request: new Request('https://toil.fyi/api/decide', {
            method: 'OPTIONS',
          }),
          env: {},
        })
      ).headers.get('Access-Control-Allow-Methods'),
    ).toContain('POST');
    expect(
      (
        await onRequest({
          request: new Request('https://toil.fyi/api/decide'),
          env: {},
        })
      ).status,
    ).toBe(405);
    expect((await onRequest({ request: post(capture), env: {} })).status).toBe(
      503,
    );
  });
  test('uses the existing IP limiter before calling the provider', async () => {
    let calls = 0;
    let key = '';
    const response = await onRequest({
      request: post(capture),
      env: {
        AI: {
          run: async () => {
            calls++;
            return {};
          },
        },
        AI_RATE_LIMITER: {
          limit: async (input) => {
            key = input.key;
            return { success: false };
          },
        },
      },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(key).toBe('192.0.2.1');
    expect(calls).toBe(0);
  });
  test('returns validated answers and a hash without echoing state or media', async () => {
    let calledModel = '';
    const ai: WorkersAI = {
      run: async (model, inputs) => {
        calledModel = model;
        expect(inputs.questions).toHaveProperty('visible');
        expect(inputs.images).toEqual([image]);
        return { model: inputs.model, answers: goodAnswers };
      },
    };
    const response = await onRequest({
      request: post(capture),
      env: { AI: ai },
    });
    expect(response.status).toBe(200);
    expect(calledModel).toBe('@cf/cloudflare/clef-flash');
    const result = await response.json();
    expect(result).toMatchObject({
      version: 1,
      task: 'capture-review',
      model: 'clef-flash',
      answers: goodAnswers,
      disposition: 'accepted',
      provenance: {
        questionVersion: 'stims-clef-v1',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('images');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  test('rejects malformed JSON and invalid evidence before inference', async () => {
    const malformed = new Request('https://toil.fyi/api/decide', {
      method: 'POST',
      body: '{',
    });
    expect(
      (await onRequest({ request: malformed, env: { AI: provider() } })).status,
    ).toBe(400);
    expect(
      (
        await onRequest({
          request: post({ ...capture, images: ['https://example.com/a.png'] }),
          env: { AI: provider() },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await onRequest({
          request: post({ ...capture, state: { prompt: 'a'.repeat(4097) } }),
          env: { AI: provider() },
        })
      ).status,
    ).toBe(413);
  });
  test('caps bodies by counted stream bytes even without Content-Length and cancels the stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(DECISION_LIMITS.bodyBytes + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('https://toil.fyi/api/decide', {
      method: 'POST',
      body: stream,
    });
    const response = await onRequest({ request, env: { AI: provider() } });
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });
  test('uses Omni for sound and rejects provider ids outside the offered choices', async () => {
    const body = {
      task: 'audio-match',
      state: { candidates: [{ id: 'a', description: 'calm' }] },
      audio: ['data:audio/wav;base64,UklGRgAAAABXQVZF'],
    };
    let model = '';
    const ai: WorkersAI = {
      run: async (id) => {
        model = id;
        return {
          model: 'clef-omni',
          answers: {
            candidate: {
              type: 'choice',
              choice: 'unoffered',
              probabilities: { a: 0.9, hold: 0.05, none: 0.05 },
              confidence: 0.9,
            },
            sufficient_evidence: { type: 'noul', noul: 0.9 },
          },
        };
      },
    };
    const response = await onRequest({ request: post(body), env: { AI: ai } });
    expect(model).toBe('@cf/cloudflare/clef-omni');
    expect(response.status).toBe(502);
  });
  test('does not leak provider error payloads and returns review for visible artifacts', async () => {
    const failed = await onRequest({
      request: post(capture),
      env: {
        AI: {
          run: async () => {
            throw new Error('private media payload');
          },
        },
      },
    });
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('private media');
    const review = await onRequest({
      request: post(capture),
      env: {
        AI: provider({
          ...goodAnswers,
          visible_artifacts: { type: 'noul', noul: 0.95 },
        }),
      },
    });
    expect(await review.json()).toMatchObject({ disposition: 'review' });
  });
  test('bounds inference and releases its timeout after success', async () => {
    jest.useFakeTimers();
    const pending = runDecisionQuestions(
      { run: () => new Promise(() => {}) },
      { model: 'clef-flash', state: {}, questions: routingQuestions },
    );
    jest.advanceTimersByTime(12_001);
    await expect(pending).rejects.toMatchObject({ status: 504 });
    const success = await runDecisionQuestions(
      {
        run: async () => ({
          model: 'clef-flash',
          answers: {
            choice: {
              type: 'choice',
              choice: 'a',
              probabilities: { a: 1, b: 0 },
              confidence: 1,
            },
          },
        }),
      },
      { model: 'clef-flash', state: {}, questions: routingQuestions },
    );
    expect(success.answers.choice).toMatchObject({ choice: 'a' });
    expect(jest.getTimerCount()).toBe(0);
  });
});

function classification(
  complexity: 'simple' | 'moderate' | 'complex',
  reasoning: number,
  probability = 0.95,
): DecisionAnswers {
  const rest = (1 - probability) / 2;
  return {
    complexity: {
      type: 'choice',
      choice: complexity,
      probabilities: {
        simple: complexity === 'simple' ? probability : rest,
        moderate: complexity === 'moderate' ? probability : rest,
        complex: complexity === 'complex' ? probability : rest,
      },
      confidence: probability,
    },
    needs_reasoning: { type: 'noul', noul: reasoning },
  };
}
async function generateWithRouting(
  answers: unknown,
  description = 'glowing rings',
  override?: string,
  failClassifier = false,
) {
  const models: string[] = [];
  const ai: WorkersAI = {
    run: async (model, inputs) => {
      models.push(model);
      if (model === '@cf/cloudflare/clef-flash') {
        expect(inputs.questions).toHaveProperty('needs_reasoning');
        if (failClassifier) throw new Error('unavailable');
        return { model: 'clef-flash', answers };
      }
      if (models.length === 1 && !override)
        return { response: '{"complexity":"simple","needsReasoning":false}' };
      if (model === '@cf/ibm-granite/granite-4.0-h-micro')
        return { response: 'Ring composition' };
      return { response: '[preset00]\nfDecay=0.98\nfZoom=1.02' };
    },
  };
  const response = await generate({
    request: post({ description, ...(override ? { model: override } : {}) }),
    env: { AI: ai },
  });
  return { response, models };
}
describe('generation decision routing', () => {
  test('reads hosted chat-completion output after routing as well as legacy text', async () => {
    const ai: WorkersAI = {
      run: async (model) => {
        if (model === '@cf/cloudflare/clef-flash')
          return {
            model: 'clef-flash',
            answers: classification('simple', 0.05),
          };
        return {
          choices: [
            {
              message: {
                content:
                  model === '@cf/ibm-granite/granite-4.0-h-micro'
                    ? 'Blue rings'
                    : '[preset00]\nfDecay=0.98\nfZoom=1.02',
              },
            },
          ],
        };
      },
    };
    const response = await generate({
      request: post({ description: 'blue circles' }),
      env: { AI: ai },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      milkSource: '[preset00]\nfDecay=0.98\nfZoom=1.02',
      title: 'Blue rings',
    });
  });
  test('rejects invalid or oversized descriptions before routing inference', async () => {
    let calls = 0;
    const ai: WorkersAI = {
      run: async () => {
        calls++;
        return {};
      },
    };
    const invalid = await generate({
      request: post({ description: 123 }),
      env: { AI: ai },
    });
    const oversized = await generate({
      request: post({ description: 'x'.repeat(4097) }),
      env: { AI: ai },
    });
    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(calls).toBe(0);
  });
  test('routes a short but semantically complex request to the code writer', async () => {
    const { response, models } = await generateWithRouting(
      classification('complex', 0.95),
      'coupled nonlinear feedback',
    );
    expect(response.status).toBe(200);
    expect(models.slice(0, 2)).toEqual([
      '@cf/cloudflare/clef-flash',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
    ]);
  });
  test('falls back deterministically for unavailable, malformed and uncertain decisions', async () => {
    for (const [answers, fail] of [
      [{}, false],
      [classification('complex', 0.5, 0.4), false],
      [{}, true],
    ] as const) {
      const { response, models } = await generateWithRouting(
        answers,
        'glowing rings',
        undefined,
        fail,
      );
      expect(response.status).toBe(200);
      expect(models.slice(0, 2)).toEqual([
        '@cf/cloudflare/clef-flash',
        '@cf/qwen/qwen3-30b-a3b-fp8',
      ]);
    }
  });
  test('preserves explicit allowlisted writer selection without a classification request', async () => {
    const selected = '@cf/meta/llama-4-scout-17b-16e-instruct';
    const { response, models } = await generateWithRouting(
      {},
      'glowing rings',
      selected,
    );
    expect(response.status).toBe(200);
    expect(models[0]).toBe(selected);
    expect(models).not.toContain('@cf/cloudflare/clef-flash');
  });
});
