/** Optional decision service. Media is transmitted only by an explicit call. */
import {
  type DecisionRequest,
  type DecisionResult,
  parseDecisionRequest,
  parseDecisionResult,
} from '../decision-model.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

export type DecisionFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function requestDecision(
  request: DecisionRequest,
  options: {
    endpoint?: string | null;
    signal?: AbortSignal;
    fetcher?: DecisionFetch;
    timeoutMs?: number;
  } = {},
): Promise<DecisionResult> {
  const endpoint =
    options.endpoint === undefined
      ? resolveOptionalApiUrl('/api/decide')
      : options.endpoint;
  if (!endpoint)
    throw new Error('Decision service is unavailable in this environment.');
  const url = new URL(endpoint);
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('Decision service requires an HTTP endpoint.');
  options.signal?.throwIfAborted();
  const validated = parseDecisionRequest(request);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('Decision service timed out.')),
    Math.min(60_000, Math.max(1, options.timeoutMs ?? 30_000)),
  );
  try {
    const response = await (options.fetcher ?? fetch)(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validated),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Decision service returned ${response.status}.`);
    return parseDecisionResult(await response.json(), validated);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
