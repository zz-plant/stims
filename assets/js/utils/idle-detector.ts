import { getAverageFrequency } from './audio-handler';

export type IdleDetectorOptions = {
  silenceThreshold?: number;
  idleDelayMs?: number;
  resumeDelayMs?: number;
};

export type IdleState = {
  idle: boolean;
  idleProgress: number;
  averageLevel: number;
};

export function createIdleDetector({
  silenceThreshold = 12,
  idleDelayMs = 2200,
  resumeDelayMs = 350,
}: IdleDetectorOptions = {}) {
  let lastActive = performance.now();
  let smoothedLevel = 0;
  let idle = false;

  function update(
    data: Uint8Array,
    now: number = performance.now(),
  ): IdleState {
    const average = getAverageFrequency(data);
    smoothedLevel = smoothedLevel * 0.8 + average * 0.2;

    const aboveThreshold = smoothedLevel > silenceThreshold;
    if (aboveThreshold) {
      lastActive = now;
    }

    const idleTarget = now - lastActive > idleDelayMs;
    idle = idleTarget;

    const idleElapsed = Math.max(0, now - (lastActive + idleDelayMs));
    const idleProgress = Math.min(1, idleElapsed / resumeDelayMs);

    return {
      idle,
      idleProgress,
      averageLevel: smoothedLevel,
    };
  }

  return { update };
}
