import {
  DecisionValidationError,
  parseDecisionRequest,
} from '../../src/js/core/decision-model.ts';
import { enforceAiRateLimit } from './_ai-guard.ts';
import {
  DecisionProviderError,
  readDecisionBody,
  runDecision,
} from './_decision-model.ts';

interface Env {
  AI?: WorkersAI;
  AI_RATE_LIMITER?: RateLimiter;
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}
export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS')
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed. Use POST.' }, 405);
  if (!env.AI)
    return json(
      { error: 'Model inference is not available on this deployment.' },
      503,
    );
  const limited = await enforceAiRateLimit(request, env.AI_RATE_LIMITER);
  if (limited) return limited;
  try {
    const input = parseDecisionRequest(await readDecisionBody(request));
    return json(await runDecision(env.AI, input));
  } catch (error) {
    if (
      error instanceof DecisionValidationError ||
      error instanceof DecisionProviderError
    )
      return json({ error: error.message }, error.status);
    return json({ error: 'Decision evaluation failed.' }, 502);
  }
}
