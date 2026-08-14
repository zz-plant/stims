// Watch-together session transport. Talks to the stims-sync Worker
// (scripts/sync-room-worker.ts): the host broadcasts preset changes over a
// WebSocket and viewers follow along. Module-level store so the settings
// panel UI and the App-level bridge share one connection; React reads it via
// useSyncExternalStore.

import { SyncRoomCreateResponseSchema } from '../core/edge-contracts.ts';

const SYNC_BASE = 'https://stims-sync.kanavj.workers.dev';
const HOST_KEY_STORAGE_PREFIX = 'stims-sync-host-key:';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

export type SyncRole = 'host' | 'viewer';

export interface SyncSessionState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  room: string | null;
  role: SyncRole | null;
  peers: number;
  error: string | null;
}

export interface SyncPresetMessage {
  presetId: string;
  title: string | null;
}

const IDLE_STATE: SyncSessionState = {
  status: 'idle',
  room: null,
  role: null,
  peers: 0,
  error: null,
};

let state: SyncSessionState = IDLE_STATE;
let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
// The preset the host last sent (or a viewer last received); used to avoid
// echo loops when the bridge observes the preset change it just applied.
let lastSyncedPresetId: string | null = null;

const stateListeners = new Set<() => void>();
const presetListeners = new Set<(message: SyncPresetMessage) => void>();

function setState(next: Partial<SyncSessionState>): void {
  state = { ...state, ...next };
  for (const listener of stateListeners) {
    listener();
  }
}

export function subscribeSyncSession(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getSyncSessionState(): SyncSessionState {
  return state;
}

export function onSyncPreset(
  listener: (message: SyncPresetMessage) => void,
): () => void {
  presetListeners.add(listener);
  return () => presetListeners.delete(listener);
}

export function getLastSyncedPresetId(): string | null {
  return lastSyncedPresetId;
}

function storedHostKey(room: string): string | null {
  try {
    return sessionStorage.getItem(`${HOST_KEY_STORAGE_PREFIX}${room}`);
  } catch {
    return null;
  }
}

function connect(room: string, hostKey: string | null): void {
  intentionalClose = false;
  const role: SyncRole = hostKey ? 'host' : 'viewer';
  setState({ status: 'connecting', room, role, error: null });

  const url = new URL(`${SYNC_BASE}/api/rooms/${room}/ws`);
  url.protocol = url.protocol.replace('http', 'ws');
  if (hostKey) url.searchParams.set('key', hostKey);

  const ws = new WebSocket(url.toString());
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    reconnectAttempts = 0;
    setState({ status: 'connected' });
  };

  ws.onmessage = (event) => {
    if (socket !== ws) return;
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        presetId?: string;
        title?: string | null;
        count?: number;
      };
      if (message.type === 'peers' && typeof message.count === 'number') {
        setState({ peers: message.count });
        return;
      }
      if (message.type === 'preset' && typeof message.presetId === 'string') {
        lastSyncedPresetId = message.presetId;
        for (const listener of presetListeners) {
          listener({
            presetId: message.presetId,
            title: message.title ?? null,
          });
        }
      }
    } catch {
      // Malformed frame; ignore.
    }
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (intentionalClose) {
      setState(IDLE_STATE);
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    reconnectAttempts += 1;
    setState({ status: 'connecting' });
    reconnectTimer = setTimeout(() => connect(room, hostKey), delay);
  };
}

export async function startHostSession(): Promise<string> {
  leaveSyncSession();
  const response = await fetch(`${SYNC_BASE}/api/rooms`, { method: 'POST' });
  if (!response.ok) {
    setState({ status: 'error', error: 'Could not create a sync session.' });
    throw new Error(`Room creation failed: ${response.status}`);
  }
  const parsed = SyncRoomCreateResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    setState({ status: 'error', error: 'Could not create a sync session.' });
    throw new Error('Room creation returned an unexpected response body');
  }
  const { room, hostKey } = parsed.data;
  try {
    sessionStorage.setItem(`${HOST_KEY_STORAGE_PREFIX}${room}`, hostKey);
  } catch {
    // Session storage unavailable; the session still works until reload.
  }
  connect(room, hostKey);
  return room;
}

// Joins as viewer, or resumes as host when this tab created the room.
export function joinSyncRoom(room: string): void {
  if (state.room === room && state.status !== 'idle') return;
  leaveSyncSession();
  connect(room, storedHostKey(room));
}

export function leaveSyncSession(): void {
  intentionalClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  lastSyncedPresetId = null;
  if (socket) {
    const ws = socket;
    socket = null;
    try {
      ws.close(1000, 'Left session');
    } catch {
      // Already closed.
    }
  }
  setState(IDLE_STATE);
}

export function sendSyncPreset(presetId: string, title: string | null): void {
  if (state.role !== 'host' || socket?.readyState !== WebSocket.OPEN) return;
  lastSyncedPresetId = presetId;
  socket.send(JSON.stringify({ type: 'preset', presetId, title }));
}

export function syncShareUrl(room: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('sync', room);
  return url.toString();
}
