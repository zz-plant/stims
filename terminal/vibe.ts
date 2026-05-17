export interface VibeState {
  intensity: number;
  particleBoost: number;
  hueShift: number;
}

export function createVibeState(): VibeState & { update: (now: Date) => void } {
  const lastKeypress = Date.now();
  const state: VibeState = { intensity: 0.5, particleBoost: 1, hueShift: 0 };

  const update = (now: Date) => {
    const hour = now.getHours();
    const idleMs = now.getTime() - lastKeypress;

    let baseIntensity: number;
    if (hour >= 22 || hour < 6) {
      baseIntensity = 0.8;
      state.hueShift = 290;
    } else if (hour >= 6 && hour < 12) {
      baseIntensity = 0.35;
      state.hueShift = 180;
    } else if (hour >= 12 && hour < 17) {
      baseIntensity = 0.5;
      state.hueShift = 20;
    } else {
      baseIntensity = 0.65;
      state.hueShift = 340;
    }

    const idleMinutes = idleMs / 60000;
    const idleBoost = Math.min(0.3, idleMinutes * 0.02);
    state.intensity = Math.min(1, baseIntensity + idleBoost);
    state.particleBoost = 0.5 + idleBoost * 2;
  };

  return { ...state, update };
}

export function onInputActivity(
  vibe: VibeState & { update: (now: Date) => void },
) {
  vibe.intensity = Math.max(0.2, vibe.intensity - 0.15);
}
