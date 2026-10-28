/** Local performer intent token. Existing ramps/modulators do not advance it. */
const session = globalThis.crypto.randomUUID();
let revision = 0;
let frameDepth = 0;
export function markPerformanceMutation(): void {
  if (!frameDepth) revision += 1;
}
export function getPerformanceRevision(): string {
  return `${session}:${revision}`;
}
/** A frame of an already accepted gesture, not a new performer instruction. */
export function applyPerformanceFrame(operation: () => void): void {
  frameDepth += 1;
  try {
    operation();
  } finally {
    frameDepth -= 1;
  }
}
