// Vectorize vector IDs are capped at 64 bytes; many MilkDrop preset slugs are
// longer. Long slugs become `<55-byte prefix>-<8-hex fnv1a hash>` (64 bytes)
// and the full preset id travels in vector metadata instead.

const VECTORIZE_MAX_ID_BYTES = 64;
const HASH_SUFFIX_LENGTH = 9; // '-' + 8 hex chars

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function toVectorizeId(presetId: string): string {
  const bytes = new TextEncoder().encode(presetId);
  if (bytes.length <= VECTORIZE_MAX_ID_BYTES) return presetId;

  const prefixBytes = bytes.slice(
    0,
    VECTORIZE_MAX_ID_BYTES - HASH_SUFFIX_LENGTH,
  );
  const prefix = new TextDecoder().decode(prefixBytes);
  return `${prefix}-${fnv1aHex(presetId)}`;
}
