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
    } catch {
      // The store carries the error state for the status line below.
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!session.room) return;
    try {
      await navigator.clipboard.writeText(syncShareUrl(session.room));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the link is still visible in the URL bar.
    }
  };

  const handleLeave = () => {
    leaveSyncSession();
    setSyncUrlParam(null);
  };

  const others = Math.max(0, session.peers - 1);
  const statusLine =
    session.status === 'error'
      ? (session.error ?? 'Sync session error.')
      : session.status === 'connecting'
        ? 'Connecting…'
        : session.role === 'host'
          ? `Hosting room ${session.room} — ${others} ${others === 1 ? 'viewer' : 'viewers'} watching.`
          : `Watching room ${session.room} — presets follow the host.`;

  return (
    <section className="ctl-section">
      <div className="ctl-section__head">
        <h3 className="ctl-section__title">Watch together</h3>
      </div>
      {session.status === 'idle' ? (
        <div className="ctl-row">
          <span className="ctl-row__text">
            <span className="ctl-row__label">Shared session</span>
            <span className="ctl-row__hint">
              Start a session and share the link. Everyone who opens it sees
              the presets you play, live.
            </span>
          </span>
          <button
            type="button"
            className="ctl-btn"
            disabled={busy}
            onClick={() => void handleStart()}
          >
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>
      ) : (
        <div className="ctl-row">
          <span className="ctl-row__text">
            <span className="ctl-row__label">Shared session</span>
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
            Leave
          </button>
        </div>
      )}
    </section>
  );
}
