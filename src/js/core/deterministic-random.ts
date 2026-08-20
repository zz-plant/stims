// Session-scoped seedable randomness for reproducing "shuffle picked a bad
// preset" failures. Without a seed, autoplay's weighted random pick
// (preset-navigation-controller.ts) is unreproducible — a crash on some
// preset from a shuffle sequence cannot be replayed, only re-described. With
// `?seed=<integer>`, the exact sequence of picks replays deterministically,
// so CI and an agent can both bisect a failure to the specific preset that
// triggered it. Pairs with the existing ?mockAudio and ?lockQualityStep
// determinism flags — together they make a fully reproducible session.
//
// mulberry32: a small, fast, well-distributed 32-bit PRNG. Not
// cryptographic — this is test/debug determinism, not security.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeededRandom(seed: number): () => number {
  return mulberry32(seed);
}

let sessionRandom: (() => number) | null = null;
let sessionSeedRead = false;

function readSeedFromLocation(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The session's random source: `Math.random` normally, or a seeded
 * generator when `?seed=<integer>` is present. Read once and memoized —
 * the seed is fixed for the life of the page, not re-read per call.
 */
export function getSessionRandom(): () => number {
  if (!sessionSeedRead) {
    sessionSeedRead = true;
    const seed = readSeedFromLocation();
    if (seed !== null) {
      sessionRandom = createSeededRandom(seed);
    }
  }
  return sessionRandom ?? Math.random;
}

/** Test-only: force a reset so tests don't leak the memoized seed across cases. */
export function resetSessionRandomForTests(): void {
  sessionRandom = null;
  sessionSeedRead = false;
}
