// Module-level mirror of the engine's adaptive-quality state, in the same
// spirit as engine-audio-energy-store: non-React consumers (the live preset
// tile pool) need a cheap synchronous read without threading React context
// through the engine seam.

export type EngineQualityState = {
  /** Current adaptive quality step index; 0 is the best step. */
  step: number;
  /** Total number of quality steps. */
  stepCount: number;
};

let currentQuality: EngineQualityState | null = null;

export function setEngineQualityState(state: EngineQualityState | null): void {
  currentQuality = state;
}

export function getEngineQualityState(): EngineQualityState | null {
  return currentQuality;
}

/** Default live-tile engine cap when the stage is running at full quality. */
export const LIVE_TILE_FULL_CAPACITY = 10;
/** Floor: browsing keeps at least this many live previews even under load. */
export const LIVE_TILE_MIN_CAPACITY = 2;

/**
 * Live preview tiles compete with the stage for CPU and GL contexts (each
 * booted tile costs ~2ms of vm.step per tick). When the adaptive quality
 * controller is degrading the stage, spending that budget on browse-grid
 * decoration works against it — scale the pool cap down with the stage's
 * degradation instead.
 */
export function getLiveTileCapacity(): number {
  if (!currentQuality || currentQuality.stepCount <= 1) {
    return LIVE_TILE_FULL_CAPACITY;
  }
  const degradation = Math.min(
    1,
    Math.max(0, currentQuality.step / (currentQuality.stepCount - 1)),
  );
  return Math.max(
    LIVE_TILE_MIN_CAPACITY,
    Math.round(LIVE_TILE_FULL_CAPACITY * (1 - 0.8 * degradation)),
  );
}
