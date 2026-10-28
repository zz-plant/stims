/**
 * Dev-only bridge from this tab to the vite dev server, so an agent working in
 * the shell performs on the stage a person is watching instead of on a
 * headless browser of its own.
 *
 * The page reports and the server decides. Every connected tab says hello with
 * whether it is visible, focused and automated (`navigator.webdriver`), and the
 * server picks one of them as the stage (`pickStage` in
 * `scripts/vite-live-channel.ts`). Only the stage's events and state reach
 * `scratch/live/`, and only the stage receives commands.
 *
 * Commands reuse the surfaces that already exist rather than adding another
 * vocabulary. A `toil:*` message is posted to this window and answered by the
 * same handler an embedding page or `bun run ctl` talks to (`agent-bridge.ts`).
 * `live` calls a method on `window.__stims_live`, and `capture` returns
 * `__stims_agent.captureImage()`.
 *
 * `app.ts` installs this behind `import.meta.hot`, which vite replaces with
 * `undefined` in a build, so none of it ships.
 */
import {
  LIVE_CHANNEL_EVENTS,
  LIVE_CHANNEL_OPT_IN_PARAM,
  type LiveClientHello,
  type LiveClientPresence,
  type LiveCommand,
  type LiveCommandEnvelope,
  type LiveCommandResult,
  type LiveReplyEnvelope,
} from './live-channel-protocol.ts';

/** The part of `import.meta.hot` this module uses. */
export interface LiveHotChannel {
  send: (event: string, data?: unknown) => void;
  on: (event: string, listener: (data: unknown) => void) => void;
  off?: (event: string, listener: (data: unknown) => void) => void;
}

const EVENT_POLL_MS = 250;
const STATE_INTERVAL_MS = 1000;
const TOIL_REPLY_TIMEOUT_MS = 30_000;
const TOIL_REPLY_TYPES: readonly string[] = ['toil:status', 'toil:telemetry'];
/** Takes a MediaStream, which cannot cross a JSON channel. */
const UNCALLABLE_LIVE_METHODS: readonly string[] = ['attachStream'];

/** Drops functions and cycles so a reply always survives JSON. */
function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function liveMethodNames(live: object): string[] {
  return Object.keys(live).filter(
    (key) =>
      typeof (live as Record<string, unknown>)[key] === 'function' &&
      !UNCALLABLE_LIVE_METHODS.includes(key),
  );
}

export function installLiveChannel(
  hot: LiveHotChannel,
  env: Window = window,
): () => void {
  const clientId = env.crypto.randomUUID();
  let lastSeq = 0;
  let toilSeq = 0;

  const presence = (): LiveClientPresence => ({
    clientId,
    visible: env.document.visibilityState === 'visible',
    focused: env.document.hasFocus(),
  });

  const sayHello = () => {
    const hello: LiveClientHello = {
      ...presence(),
      url: env.location.href,
      userAgent: env.navigator.userAgent,
      webdriver: env.navigator.webdriver === true,
      optIn:
        new URLSearchParams(env.location.search).get(
          LIVE_CHANNEL_OPT_IN_PARAM,
        ) === '1',
    };
    hot.send(LIVE_CHANNEL_EVENTS.hello, hello);
  };

  const reportPresence = () => {
    hot.send(LIVE_CHANNEL_EVENTS.presence, presence());
  };

  const forwardEvents = () => {
    const agent = env.__stims_agent;
    if (!agent) return;
    for (const event of agent.getEvents(lastSeq)) {
      lastSeq = event.seq;
      hot.send(LIVE_CHANNEL_EVENTS.event, { clientId, event });
    }
  };

  const reportState = () => {
    const agent = env.__stims_agent;
    if (!agent) return;
    // The status log already reaches the server one entry at a time as
    // `status` events; repeating twenty of them every second is noise.
    const { statusLog: _statusLog, ...state } = agent.getState();
    hot.send(LIVE_CHANNEL_EVENTS.state, {
      clientId,
      state: {
        ...state,
        performanceRevision: agent.getPerformanceRevision(),
        positions: env.__stims_live?.getPositions() ?? null,
      },
    });
  };

  /** Posts to this window and waits for the bridge's reply to that request. */
  const relayToil = (message: Record<string, unknown>) =>
    new Promise<LiveCommandResult>((resolve) => {
      toilSeq += 1;
      const requestId = `live-channel:${clientId}:${toilSeq}`;
      const finish = (result: LiveCommandResult) => {
        env.clearTimeout(timer);
        env.removeEventListener('message', onMessage);
        resolve(result);
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        if (
          !data ||
          typeof data !== 'object' ||
          data.requestId !== requestId ||
          !TOIL_REPLY_TYPES.includes(String(data.type))
        ) {
          return;
        }
        const { type, requestId: _requestId, ...rest } = data;
        finish(
          type === 'toil:telemetry'
            ? { success: true, telemetry: rest }
            : { ...rest, success: rest.success === true },
        );
      };
      const timer = env.setTimeout(
        () =>
          finish({
            success: false,
            reason: `No reply to ${String(message.type)} within ${TOIL_REPLY_TIMEOUT_MS / 1000}s. The agent bridge installs when the workspace mounts; is the app still booting?`,
          }),
        TOIL_REPLY_TIMEOUT_MS,
      );
      env.addEventListener('message', onMessage);
      env.postMessage({ ...message, requestId }, '*');
    });

  const callLive = async (
    method: string,
    args: unknown[],
  ): Promise<LiveCommandResult> => {
    const live = env.__stims_live;
    if (!live) {
      return {
        success: false,
        reason:
          'window.__stims_live is not installed yet: the visualizer has not mounted.',
      };
    }
    const fn = (live as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function' || UNCALLABLE_LIVE_METHODS.includes(method)) {
      return {
        success: false,
        reason: `__stims_live has no method "${method}" that can be called over the live channel.`,
        methods: liveMethodNames(live),
      };
    }
    const value: unknown = await fn.apply(live, args);
    return { success: true, value: toJson(value) };
  };

  const capture = async (): Promise<LiveCommandResult> => {
    const image = await env.__stims_agent?.captureImage();
    return image
      ? { success: true, image }
      : { success: false, reason: 'There is no stage canvas to capture.' };
  };

  const execute = async (command: LiveCommand): Promise<LiveCommandResult> => {
    try {
      if (!command || typeof command !== 'object') {
        return { success: false, reason: 'Send a command object.' };
      }
      if (command.type === 'live') {
        if (typeof command.method !== 'string') {
          return { success: false, reason: 'Send method as a string.' };
        }
        return await callLive(
          command.method,
          Array.isArray(command.args) ? command.args : [],
        );
      }
      if (command.type === 'capture') return await capture();
      if (
        typeof command.type === 'string' &&
        command.type.startsWith('toil:')
      ) {
        return await relayToil(command);
      }
      return {
        success: false,
        reason: `Unknown command type "${String((command as { type?: unknown }).type)}". Send a toil:* message, {type: "live", method, args} or {type: "capture"}.`,
      };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const onCommand = (data: unknown) => {
    const envelope = data as LiveCommandEnvelope;
    void execute(envelope.command).then((result) => {
      const reply: LiveReplyEnvelope = {
        clientId,
        requestId: envelope.requestId,
        result,
      };
      hot.send(LIVE_CHANNEL_EVENTS.reply, reply);
    });
  };

  hot.on(LIVE_CHANNEL_EVENTS.command, onCommand);
  // A restarted dev server has forgotten every tab.
  hot.on('vite:ws:connect', sayHello);
  env.document.addEventListener('visibilitychange', reportPresence);
  env.addEventListener('focus', reportPresence);
  env.addEventListener('blur', reportPresence);
  const eventTimer = env.setInterval(forwardEvents, EVENT_POLL_MS);
  const stateTimer = env.setInterval(reportState, STATE_INTERVAL_MS);
  sayHello();

  return () => {
    env.clearInterval(eventTimer);
    env.clearInterval(stateTimer);
    env.document.removeEventListener('visibilitychange', reportPresence);
    env.removeEventListener('focus', reportPresence);
    env.removeEventListener('blur', reportPresence);
    hot.off?.(LIVE_CHANNEL_EVENTS.command, onCommand);
    hot.off?.('vite:ws:connect', sayHello);
  };
}
