// CORS and method handling shared by the API endpoints. The leading
// underscore keeps `wrangler pages functions build` from turning this module
// into a route.

/** The response to a CORS preflight for an endpoint that serves `method`. */
export function corsPreflight(method: 'GET' | 'POST'): Response {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': `${method}, OPTIONS`,
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Answers a preflight, or rejects any method but `method` with a plain 405.
 * Returns null when the request may proceed.
 */
export function methodGuard(
  request: Request,
  method: 'GET' | 'POST',
): Response | null {
  if (request.method === 'OPTIONS') return corsPreflight(method);
  if (request.method !== method) {
    return new Response('Method not allowed', { status: 405 });
  }
  return null;
}

/** A JSON response any origin may read. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
