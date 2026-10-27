/**
 * Dev-server half of the live channel: lets an agent in the shell perform on
 * the tab a person is watching, over the WebSocket vite already holds open to
 * every page for hot reload.
 *
 * `bun run ctl` and the MCP sessions each launch a browser of their own, so
 * whatever they drive is not on the person's screen. This plugin attaches to
 * the tab that is. The page half (`src/js/frontend/live-channel.ts`) reports
 * from every tab; this side picks one tab as the stage and:
 *
 *   - writes the stage's agent events to `scratch/live/events.jsonl`, one JSON
 *     object per line, and its latest state to `scratch/live/state.json`;
 *   - relays commands from `POST /__stims-live/command` to the stage and
 *     answers with its reply (`GET /__stims-live/state` reads the state);
 *   - applies `scratch/live/preset.milk` as preset source and plays
 *     `scratch/live/pattern.js` as a Strudel pattern each time either is saved.
 *
 * Commands from the shell and from saved files are logged to `events.jsonl`
 * with `from: "agent"`, so the log tells what the agent did apart from what
 * happened on the page.
 *
 * The routes answer loopback requests only, and refuse a browser request from
 * a page on another host. The lab and e2e servers spawned by
 * `scripts/dev-server.ts` set `STIMS_LIVE_CHANNEL=0`, so automated runs in the
 * same checkout never take over these files.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import {
  LIVE_CHANNEL_EVENTS,
  type LiveClientHello,
  type LiveClientPresence,
  type LiveCommand,
  type LiveCommandResult,
  type LiveReplyEnvelope,
} from '../src/js/frontend/live-channel-protocol.ts';

export const LIVE_CHANNEL_DIR = 'scratch/live';
export const LIVE_CHANNEL_ROUTE = '/__stims-live';

/** Longer than the page's own 30 s wait for a `toil:*` reply. */
const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const MAX_COMMAND_TIMEOUT_MS = 10 * 60_000;
const FILE_POLL_MS = 100;
/** Editors often write a file twice per save. */
const FILE_DEBOUNCE_MS = 120;
const EVENTS_ROTATE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const WATCHED_FILES = ['preset.milk', 'pattern.js'] as const;
type WatchedFile = (typeof WATCHED_FILES)[number];

export interface LiveClient extends LiveClientHello {
  /** Last hello, or last time the tab became visible or focused. */
  activeAt: number;
}

export interface LiveClientSink {
  send: (event: string, data?: unknown) => void;
}

export type LiveSendResult = LiveCommandResult & {
  clientId: string | null;
  requestId: string | null;
  ms: number;
};

/**
 * The tab commands go to: a visible, focused tab first, then a visible one,
 * then any. Ties go to the tab most recently brought forward, so clicking into
 * the terminal to talk to the agent does not move the stage. Automated tabs
 * count only with `?liveChannel=1`.
 */
export function pickStage(clients: Iterable<LiveClient>): LiveClient | null {
  const rank = (client: LiveClient) =>
    client.visible && client.focused ? 2 : client.visible ? 1 : 0;
  let best: LiveClient | null = null;
  for (const client of clients) {
    if (client.webdriver && !client.optIn) continue;
    if (
      !best ||
      rank(client) > rank(best) ||
      (rank(client) === rank(best) && client.activeAt > best.activeAt)
    ) {
      best = client;
    }
  }
  return best;
}

function describeClient(client: LiveClient | null) {
  return client
    ? {
        id: client.clientId,
        url: client.url,
        visible: client.visible,
        focused: client.focused,
        webdriver: client.webdriver,
      }
    : null;
}

/** Keeps the log readable: preset source and images are not repeated in it. */
function summarizeCommand(command: LiveCommand): Record<string, unknown> {
  const summary: Record<string, unknown> = { ...command };
  // `source` is preset code only here; on toil:set_audio it is "demo".
  const codeKeys =
    command.type === 'toil:apply_source'
      ? ['source', 'milkSource']
      : ['milkSource'];
  for (const key of codeKeys) {
    if (typeof summary[key] === 'string') {
      summary[key] = `<${(summary[key] as string).length} chars>`;
    }
  }
  return summary;
}

export function createLiveChannel({
  dir,
  now = Date.now,
}: {
  dir: string;
  now?: () => number;
}) {
  const clients = new Map<string, { info: LiveClient; sink: LiveClientSink }>();
  const pending = new Map<
    string,
    { clientId: string; settle: (result: LiveCommandResult) => void }
  >();
  const lastApplied = new Map<WatchedFile, string>();
  let stageId: string | null = null;
  let latestState: { at: string; state: unknown } | null = null;
  let requestSeq = 0;
  let eventsBytes: number | null = null;

  mkdirSync(dir, { recursive: true });
  const eventsPath = join(dir, 'events.jsonl');
  const statePath = join(dir, 'state.json');

  const iso = () => new Date(now()).toISOString();

  const log = (entry: Record<string, unknown>) => {
    const line = `${JSON.stringify({ at: iso(), ...entry })}\n`;
    const bytes = Buffer.byteLength(line);
    if (eventsBytes === null) {
      try {
        eventsBytes = statSync(eventsPath).size;
      } catch {
        eventsBytes = 0;
      }
    }
    if (eventsBytes + bytes > EVENTS_ROTATE_BYTES) {
      renameSync(eventsPath, join(dir, 'events.1.jsonl'));
      eventsBytes = 0;
    }
    appendFileSync(eventsPath, line);
    eventsBytes += bytes;
  };

  const stage = () => (stageId ? (clients.get(stageId)?.info ?? null) : null);

  const snapshot = () => ({
    at: iso(),
    stage: describeClient(stage()),
    clients: [...clients.values()].map(({ info }) => ({
      ...describeClient(info),
      optIn: info.optIn,
      stage: info.clientId === stageId,
    })),
    stateAt: latestState?.at ?? null,
    state: latestState?.state ?? null,
  });

  const writeState = () => {
    const temp = `${statePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(snapshot(), null, 2)}\n`);
    renameSync(temp, statePath);
  };

  const reconsiderStage = () => {
    const next = pickStage([...clients.values()].map(({ info }) => info));
    const nextId = next?.clientId ?? null;
    if (nextId === stageId) return;
    stageId = nextId;
    latestState = null;
    // A new stage has not seen the files yet; the next save applies them
    // even if their content is unchanged.
    lastApplied.clear();
    log({ from: 'channel', type: 'stage', stage: describeClient(next) });
    writeState();
  };

  const hello = (data: LiveClientHello, sink: LiveClientSink) => {
    clients.set(data.clientId, { info: { ...data, activeAt: now() }, sink });
    reconsiderStage();
  };

  const presence = (data: LiveClientPresence) => {
    const entry = clients.get(data.clientId);
    if (!entry) return;
    const broughtForward =
      (data.visible && !entry.info.visible) ||
      (data.focused && !entry.info.focused);
    entry.info = {
      ...entry.info,
      visible: data.visible,
      focused: data.focused,
      activeAt: broughtForward ? now() : entry.info.activeAt,
    };
    reconsiderStage();
  };

  const disconnect = (clientId: string) => {
    if (!clients.delete(clientId)) return;
    for (const [requestId, request] of pending) {
      if (request.clientId !== clientId) continue;
      pending.delete(requestId);
      request.settle({
        success: false,
        reason: 'The stage tab closed or reloaded before it answered.',
      });
    }
    reconsiderStage();
  };

  const pageEvent = (data: {
    clientId: string;
    event: { type: string; data: unknown; at: number };
  }) => {
    if (data.clientId !== stageId || !data.event) return;
    log({
      from: 'page',
      type: data.event.type,
      data: data.event.data,
      pageAt: new Date(data.event.at).toISOString(),
    });
  };

  const pageState = (data: { clientId: string; state: unknown }) => {
    if (data.clientId !== stageId) return;
    latestState = { at: iso(), state: data.state };
    writeState();
  };

  const reply = (data: LiveReplyEnvelope) => {
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    request.settle(data.result);
  };

  /** A capture's data URL becomes `frame.jpg`, so replies stay small. */
  const storeImage = (result: LiveCommandResult): LiveCommandResult => {
    const image = result.image;
    if (typeof image !== 'string') return result;
    const match = image.match(/^data:image\/\w+;base64,(.+)$/);
    if (!match) return result;
    const imagePath = join(dir, 'frame.jpg');
    writeFileSync(imagePath, Buffer.from(match[1], 'base64'));
    const { image: _image, ...rest } = result;
    return { ...rest, imagePath };
  };

  const send = async (
    command: LiveCommand,
    {
      via,
      timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    }: { via: string; timeoutMs?: number },
  ): Promise<LiveSendResult> => {
    const started = now();
    const target = stageId ? clients.get(stageId) : undefined;
    let requestId: string | null = null;
    let result: LiveCommandResult;
    if (!target) {
      result = {
        success: false,
        reason:
          clients.size === 0
            ? 'No tab is connected to this dev server. Open the app in a browser.'
            : 'Every connected tab is automated. Open the app in a browser you can see, or add ?liveChannel=1 to an automated one.',
      };
    } else {
      requestSeq += 1;
      requestId = `cmd-${requestSeq}`;
      const id = requestId;
      result = await new Promise<LiveCommandResult>((resolveResult) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolveResult({
            success: false,
            reason: `The stage did not answer within ${timeoutMs} ms.`,
          });
        }, timeoutMs);
        pending.set(id, {
          clientId: target.info.clientId,
          settle: (value) => {
            clearTimeout(timer);
            resolveResult(value);
          },
        });
        target.sink.send(LIVE_CHANNEL_EVENTS.command, {
          requestId: id,
          command,
        });
      });
      result = storeImage(result);
    }
    const ms = now() - started;
    log({
      from: 'agent',
      type: 'command',
      via,
      command: summarizeCommand(command),
      result,
      ms,
    });
    return {
      ...result,
      clientId: target?.info.clientId ?? null,
      requestId,
      ms,
    };
  };

  const applyFile = async (name: WatchedFile) => {
    let content: string;
    try {
      content = readFileSync(join(dir, name), 'utf8');
    } catch {
      return null;
    }
    if (lastApplied.get(name) === content) return null;
    lastApplied.set(name, content);
    const via = `file:${name}`;
    if (name === 'preset.milk') {
      return send({ type: 'toil:apply_source', source: content }, { via });
    }
    return content.trim()
      ? send({ type: 'live', method: 'playPattern', args: [content] }, { via })
      : send({ type: 'live', method: 'hush' }, { via });
  };

  return {
    hello,
    presence,
    disconnect,
    pageEvent,
    pageState,
    reply,
    send,
    applyFile,
    snapshot,
    paths: { events: eventsPath, state: statePath },
  };
}

export type LiveChannel = ReturnType<typeof createLiveChannel>;

function isLoopback(address: string | undefined) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

function isLocalOrigin(origin: string) {
  try {
    const { hostname } = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

function respond(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Body is over ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createLiveChannelHandler(channel: LiveChannel) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(LIVE_CHANNEL_ROUTE)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (
      !isLoopback(req.socket.remoteAddress) ||
      (origin && !isLocalOrigin(origin))
    ) {
      respond(res, 403, {
        success: false,
        reason: 'The live channel answers this machine only.',
      });
      return;
    }
    const route = url.pathname.slice(LIVE_CHANNEL_ROUTE.length);
    if (req.method === 'GET' && route === '/state') {
      respond(res, 200, channel.snapshot());
      return;
    }
    if (req.method === 'POST' && route === '/command') {
      // A JSON content type keeps a cross-site form or no-cors fetch from
      // reaching this route without a preflight, which it never approves.
      if (!req.headers['content-type']?.startsWith('application/json')) {
        respond(res, 415, {
          success: false,
          reason: 'Send the command with Content-Type: application/json.',
        });
        return;
      }
      let command: LiveCommand;
      try {
        command = JSON.parse(await readBody(req)) as LiveCommand;
      } catch (error) {
        respond(res, 400, {
          success: false,
          reason: `Body is not JSON: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      const requested = Number(url.searchParams.get('timeoutMs'));
      const timeoutMs =
        Number.isFinite(requested) && requested > 0
          ? Math.min(requested, MAX_COMMAND_TIMEOUT_MS)
          : undefined;
      const result = await channel.send(command, { via: 'http', timeoutMs });
      respond(res, result.clientId ? 200 : 503, result);
      return;
    }
    respond(res, 404, {
      success: false,
      reason: `Use GET ${LIVE_CHANNEL_ROUTE}/state or POST ${LIVE_CHANNEL_ROUTE}/command.`,
    });
  };
}

function configureLiveChannel(server: ViteDevServer) {
  // STIMS_LIVE_CHANNEL_DIR moves the files, so the e2e test does not write
  // over the scratch/live/ of a session running in the same checkout.
  const dir = resolve(
    server.config.root,
    process.env.STIMS_LIVE_CHANNEL_DIR ?? LIVE_CHANNEL_DIR,
  );
  const channel = createLiveChannel({ dir });
  const attachedSockets = new WeakSet<object>();

  server.ws.on(LIVE_CHANNEL_EVENTS.hello, (data: LiveClientHello, client) => {
    channel.hello(data, client);
    if (!attachedSockets.has(client.socket)) {
      attachedSockets.add(client.socket);
      client.socket.on('close', () => channel.disconnect(data.clientId));
    }
  });
  server.ws.on(LIVE_CHANNEL_EVENTS.presence, channel.presence);
  server.ws.on(LIVE_CHANNEL_EVENTS.event, channel.pageEvent);
  server.ws.on(LIVE_CHANNEL_EVENTS.state, channel.pageState);
  server.ws.on(LIVE_CHANNEL_EVENTS.reply, channel.reply);

  server.middlewares.use(createLiveChannelHandler(channel));

  // Polls the two paths rather than subscribing to file events. Vite's
  // watcher does not report files that appear in an existing directory when
  // it polls, and macOS file events arrived seconds late and coalesced two
  // saves into one when measured on 2026-10-27. A save that silently does
  // nothing is a dropped gesture; two stat calls every 100 ms are not.
  const timers = new Map<WatchedFile, ReturnType<typeof setTimeout>>();
  const watchedPaths = WATCHED_FILES.map((name) => {
    const path = join(dir, name);
    watchFile(path, { interval: FILE_POLL_MS }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs || current.mtimeMs === 0) {
        return;
      }
      clearTimeout(timers.get(name));
      timers.set(
        name,
        setTimeout(() => void channel.applyFile(name), FILE_DEBOUNCE_MS),
      );
    });
    return path;
  });
  server.httpServer?.once('close', () => {
    for (const path of watchedPaths) unwatchFile(path);
    for (const timer of timers.values()) clearTimeout(timer);
  });

  // Where the CLI finds this server, since vite moves to the next free port
  // when its own is taken.
  const serverFile = join(dir, 'server.json');
  server.httpServer?.once('listening', () => {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') return;
    writeFileSync(
      serverFile,
      `${JSON.stringify({ port: address.port, pid: process.pid, root: server.config.root }, null, 2)}\n`,
    );
  });
  server.httpServer?.once('close', () => {
    try {
      const owner = JSON.parse(readFileSync(serverFile, 'utf8')) as {
        pid?: number;
      };
      if (owner.pid === process.pid) rmSync(serverFile, { force: true });
    } catch {
      // Already gone, or another server's.
    }
  });

  server.config.logger.info(
    `  live channel: ${relative(server.config.root, dir)}/ ← stage tab events, POST ${LIVE_CHANNEL_ROUTE}/command → stage`,
  );
}

export function liveChannel(): Plugin {
  return {
    name: 'stims-live-channel',
    apply: (_config, { command, isPreview }) =>
      command === 'serve' &&
      !isPreview &&
      process.env.STIMS_LIVE_CHANNEL !== '0',
    configureServer: configureLiveChannel,
  };
}
