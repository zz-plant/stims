// stims-sync: Durable Object-backed watch-together rooms.
// Deploy: wrangler deploy --config wrangler.sync.jsonc
//
// One SyncRoom DO per room code. The room creator holds a hostKey; the host's
// preset changes are persisted and broadcast to every viewer over WebSockets
// (hibernation API, so idle rooms cost nothing). Rooms self-delete after 24h
// of inactivity via the DO alarm.
//
// HTTP surface (CORS-open; room codes are unguessable capabilities):
//   POST /api/rooms                  -> { room, hostKey }
//   GET  /api/rooms/:room/ws[?key=]  -> WebSocket (host when key matches)

export interface RoomState {
  presetId: string | null;
  title: string | null;
  updatedAt: number;
}

interface SocketAttachment {
  role: 'host' | 'viewer';
}

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROOM_CODE_LENGTH = 8;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function randomCode(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Host messages accepted over the socket. Anything else is dropped.
export function parseHostMessage(
  raw: unknown,
): { presetId: string; title: string | null } | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const parsed = JSON.parse(raw) as {
      type?: string;
      presetId?: string;
      title?: string;
    };
    if (parsed.type !== 'preset' || typeof parsed.presetId !== 'string') {
      return null;
    }
    const presetId = parsed.presetId.slice(0, 256);
    if (!presetId) return null;
    return {
      presetId,
      title:
        typeof parsed.title === 'string' ? parsed.title.slice(0, 256) : null,
    };
  } catch {
    return null;
  }
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket): void;
  getWebSockets(): WebSocket[];
}

interface HibernatableWebSocket extends WebSocket {
  serializeAttachment(value: SocketAttachment): void;
  deserializeAttachment(): SocketAttachment | null;
}

export class SyncRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private async touch(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async initRoom(hostKey: string): Promise<void> {
    await this.state.storage.put({
      hostKey,
      room: { presetId: null, title: null, updatedAt: Date.now() },
    });
    await this.touch();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      const { hostKey } = (await request.json()) as { hostKey: string };
      await this.initRoom(hostKey);
      return json({ ok: true });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const hostKey = await this.state.storage.get<string>('hostKey');
      if (!hostKey) {
        return new Response('Room not found', { status: 404 });
      }
      const role: SocketAttachment['role'] =
        url.searchParams.get('key') === hostKey ? 'host' : 'viewer';

      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      (server as HibernatableWebSocket).serializeAttachment({ role });
      this.state.acceptWebSocket(server);

      const room = await this.state.storage.get<RoomState>('room');
      if (room?.presetId) {
        server.send(JSON.stringify({ type: 'preset', ...room }));
      }
      this.broadcastPeers();
      await this.touch();

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: unknown): Promise<void> {
    const attachment = (ws as HibernatableWebSocket).deserializeAttachment();
    if (attachment?.role !== 'host') return;

    const message = parseHostMessage(raw);
    if (!message) return;

    const room: RoomState = {
      presetId: message.presetId,
      title: message.title,
      updatedAt: Date.now(),
    };
    await this.state.storage.put({ room });
    await this.touch();

    const payload = JSON.stringify({ type: 'preset', ...room });
    for (const socket of this.state.getWebSockets()) {
      if (socket !== ws) {
        try {
          socket.send(payload);
        } catch {
          // Socket already closing; hibernation cleanup handles it.
        }
      }
    }
  }

  async webSocketClose(): Promise<void> {
    this.broadcastPeers();
  }

  private broadcastPeers(): void {
    const sockets = this.state.getWebSockets();
    const payload = JSON.stringify({ type: 'peers', count: sockets.length });
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        // Ignore sockets mid-close.
      }
    }
  }

  async alarm(): Promise<void> {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.close(1000, 'Room expired');
      } catch {
        // Already closed.
      }
    }
    await this.state.storage.deleteAll();
  }
}

interface SyncRoomStub {
  fetch(request: Request): Promise<Response>;
  initRoom(hostKey: string): Promise<void>;
}

interface Env {
  SYNC_ROOM: {
    idFromName(name: string): unknown;
    get(id: unknown): SyncRoomStub;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const room = randomCode(ROOM_CODE_LENGTH);
      const hostKey = randomCode(24);
      const stub = env.SYNC_ROOM.get(env.SYNC_ROOM.idFromName(room));
      await stub.initRoom(hostKey);
      return json({ room, hostKey });
    }

    const wsMatch = url.pathname.match(/^\/api\/rooms\/([a-z2-9]+)\/ws$/);
    if (wsMatch) {
      const stub = env.SYNC_ROOM.get(env.SYNC_ROOM.idFromName(wsMatch[1]));
      const forward = new URL('https://sync/ws');
      const key = url.searchParams.get('key');
      if (key) forward.searchParams.set('key', key);
      return stub.fetch(new Request(forward.toString(), request));
    }

    return json({ error: 'Not found' }, 404);
  },
};
