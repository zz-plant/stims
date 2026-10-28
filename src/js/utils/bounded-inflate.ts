import { inflateSync } from 'fflate';

/**
 * Inflates DEFLATE data from an untrusted source with both ends bounded.
 *
 * fflate's `out` option bounds memory: it writes into the caller's buffer and
 * never grows it, so output past the cap is dropped and the returned length
 * exceeding the cap is how truncation is detected. It does not bound time:
 * past the end of the buffer the inflater keeps decoding and discarding, so a
 * high-ratio payload still costs work in proportion to its full expanded size,
 * roughly a thousand times its own length. Rejecting input longer than
 * `maxInputBytes` before inflating is what bounds that work.
 *
 * Returns null when either limit is exceeded.
 */
export function boundedInflate(
  bytes: Uint8Array,
  limits: { maxInputBytes: number; maxOutputBytes: number },
): Uint8Array | null {
  if (bytes.length > limits.maxInputBytes) return null;
  // inflateSync hands back the caller's whole buffer for empty input.
  if (bytes.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(limits.maxOutputBytes + 1);
  const inflated = inflateSync(bytes, { out });
  return inflated.length > limits.maxOutputBytes ? null : inflated;
}
