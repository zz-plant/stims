import { useEffect, useSyncExternalStore } from 'react';
import {
  getLastSyncedPresetId,
  getSyncSessionState,
  joinSyncRoom,
  onSyncPreset,
  sendSyncPreset,
  subscribeSyncSession,
} from './sync-session.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/**
 * Invisible glue between the sync-session transport and the engine. Mounted
 * once inside the workspace providers: joins a room named by ?sync=<room>,
 * follows the host's preset changes as a viewer, and broadcasts this tab's
 * preset changes when it is the host.
 */
export function SyncSessionBridge(): null {
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const session = useSyncExternalStore(
    subscribeSyncSession,
    getSyncSessionState,
  );

  // Join a shared session named in the URL (viewer, or host resume).
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('sync');
    if (room && /^[a-z2-9]{4,16}$/.test(room)) {
      joinSyncRoom(room);
    }
  }, []);

  // Viewer: follow the host's preset.
  useEffect(() => {
    if (session.role !== 'viewer') return;
    return onSyncPreset((message) => {
      void engine.handlePlayPreset(message.presetId);
    });
  }, [session.role, engine]);

  // Host: broadcast local preset changes, skipping the echo of a preset the
  // transport just handled.
  const activePresetId = engineSnapshot?.activePresetId ?? null;
  useEffect(() => {
    if (session.role !== 'host' || session.status !== 'connected') return;
    if (!activePresetId || activePresetId === getLastSyncedPresetId()) return;
    const title =
      engine.catalog.find((entry) => entry.id === activePresetId)?.title ??
      null;
    sendSyncPreset(activePresetId, title);
  }, [activePresetId, session.role, session.status, engine.catalog]);

  return null;
}
