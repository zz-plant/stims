// Shared guards for the Workers AI endpoints. The leading underscore keeps
// `wrangler pages functions build` from turning this module into a route.

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Models the client may request by name. Anything else falls back to the
// server-side default so arbitrary Workers AI models can't be run on our
// account from the open API.
export const ALLOWED_CLIENT_MODELS = new Set([
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/qwen/qwen2.5-coder-32b-instruct',
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
]);

export function allowedModelOrNull(model: string | undefined): string | null {
  return model && ALLOWED_CLIENT_MODELS.has(model) ? model : null;
}

// Returns a 429 response when the caller is over the per-IP limit, null when
// the request may proceed. A missing binding (tests, wrangler dev without the
// unsafe binding) fails open.
export async function enforceAiRateLimit(
  request: Request,
  limiter: RateLimiter | undefined,
): Promise<Response | null> {
  if (!limiter) return null;

  const key = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const { success } = await limiter.limit({ key });
    if (success) return null;
  } catch {
    // Limiter outage should not take down generation.
    return null;
  }

  return new Response(
    JSON.stringify({ error: 'Too many requests. Try again in a minute.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': '60',
      },
    },
  );
}
