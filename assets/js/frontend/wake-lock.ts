let wakeLockSentinel: WakeLockSentinel | null = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  if (wakeLockSentinel) return;

  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch {}
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch {}
  wakeLockSentinel = null;
}

export function connectWakeLock(shouldLock: () => boolean): () => void {
  let syncing = false;

  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      if (shouldLock()) {
        await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    } finally {
      syncing = false;
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && shouldLock()) {
      void sync();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  void sync();

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    void releaseWakeLock();
  };
}
