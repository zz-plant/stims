import { useState, useSyncExternalStore } from 'react';
import {
  getSyncSessionState,
  leaveSyncSession,
  startHostSession,
  subscribeSyncSession,
  syncShareUrl,
} from './sync-session.ts';

function setSyncUrlParam(room: string | null): void {
  const url = new URL(window.location.href);
  if (room) {
    url.searchParams.set('sync', room);
  } else {
    url.searchParams.delete('sync');
  }
  window.history.replaceState(window.history.state, '', url.toString());
}

/** Watch-together controls, rendered inside the settings sheet. */
export function SyncSessionSection() {
  const session = useSyncExternalStore(
    subscribeSyncSession,
    getSyncSessionState,
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleStart = async () => {
    setBusy(true);
    try {
      const room = await startHostSession();
      setSyncUrlParam(room);
      // Same outcome as the palette's "Start watch party": the room exists
      // to be shared, so its link goes on the clipboard at once.
      await copyLink(room);
    } catch {
      // The store carries the error state for the status line below.
    }
    // Cleanup after the catch rather than in a `finally` clause: React
    // Compiler cannot lower try/finally yet, and one unparsable function
    // skips the whole file. The catch swallows everything, so this runs on
    // both paths exactly as the finally did.
    setBusy(false);
  };

  const copyLink = async (room: string) => {
    try {
      await navigator.clipboard.writeText(syncShareUrl(room));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the link is still visible in the URL bar.
    }
  };

  const handleCopy = async () => {
    if (!session.room) return;
    await copyLink(session.room);
  };

  const handleLeave = () => {
    leaveSyncSession();
    setSyncUrlParam(null);
  };

  const others = Math.max(0, session.peers - 1);
  const statusLine =
    session.status === 'error'
      ? (session.error ?? 'Could not start a watch party.')
      : session.status === 'connecting'
        ? 'Connecting…'
        : session.role === 'host'
          ? `Hosting room ${session.room}: ${others} ${others === 1 ? 'viewer' : 'viewers'} watching.`
          : `Watching room ${session.room}: presets follow the host.`;

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Watch together</h3>
      </div>
      {session.status === 'idle' ? (
        <div className="ctl-row">
          <span className="ctl-row__text">
            <span className="ctl-row__label">Watch party</span>
            <span className="ctl-row__hint">
              Creates a room and copies its link. Anyone who opens the link sees
              the presets you play, live.
            </span>
          </span>
          <button
            type="button"
            className="ctl-btn"
            disabled={busy}
            onClick={() => void handleStart()}
          >
            {busy ? 'Starting…' : 'Start watch party (copies link)'}
          </button>
        </div>
      ) : (
        <div className="ctl-row">
          <span className="ctl-row__text">
            <span className="ctl-row__label">Watch party</span>
            <span className="ctl-row__hint" role="status">
              {statusLine}
            </span>
          </span>
          {session.role === 'host' ? (
            <button type="button" className="ctl-btn" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          ) : null}
          <button
            type="button"
            className="ctl-btn ctl-btn--quiet"
            onClick={handleLeave}
          >
            {session.role === 'host' ? 'End watch party' : 'Leave watch party'}
          </button>
        </div>
      )}
    </section>
  );
}
