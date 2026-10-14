/**
 * Tracks whether a video recording session is actively running.
 *
 * Consulted by hidden-tab-policy.ts so switching tabs during a recording does
 * not suspend rendering or stall video frames while audio continues.
 */

type RecordingListener = (active: boolean) => void;

const listeners = new Set<RecordingListener>();
let activeRecording = false;

export function isRecordingActive(): boolean {
  return activeRecording;
}

export function setRecordingActive(active: boolean): void {
  if (activeRecording === active) return;
  activeRecording = active;
  for (const listener of listeners) {
    listener(active);
  }
}

export function subscribeRecordingActive(
  listener: RecordingListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: reset state between test cases. */
export function resetRecordingActiveForTests(): void {
  activeRecording = false;
  listeners.clear();
}
