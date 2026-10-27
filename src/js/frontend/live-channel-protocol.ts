/**
 * Wire format of the dev-only live channel: the custom HMR events a tab and
 * the vite dev server (`scripts/vite-live-channel.ts`) exchange, and the
 * command shape an agent posts to `/__stims-live/command`.
 *
 * Kept free of DOM and Node imports so both ends share one definition.
 */

export const LIVE_CHANNEL_EVENTS = {
  /** Page → server, on connect and after every reconnect. */
  hello: 'stims-live:hello',
  /** Page → server, when visibility or focus changes. */
  presence: 'stims-live:presence',
  /** Page → server, one `__stims_agent.getEvents()` entry. */
  event: 'stims-live:event',
  /** Page → server, about once a second. */
  state: 'stims-live:state',
  /** Page → server, the answer to one command. */
  reply: 'stims-live:reply',
  /** Server → the stage page only. */
  command: 'stims-live:command',
} as const;

/** Opts an automated tab (`navigator.webdriver`) in as a stage candidate. */
export const LIVE_CHANNEL_OPT_IN_PARAM = 'liveChannel';

export interface LiveClientPresence {
  clientId: string;
  visible: boolean;
  focused: boolean;
}

export interface LiveClientHello extends LiveClientPresence {
  url: string;
  userAgent: string;
  /** `navigator.webdriver`: Playwright, the MCP sessions, `bun run ctl`. */
  webdriver: boolean;
  /** The URL carries `?liveChannel=1`. */
  optIn: boolean;
}

/**
 * What an agent can ask the stage to do.
 *
 * - any `toil:*` message from the iframe protocol (`agent-bridge.ts`), relayed
 *   unchanged, e.g. `{type: 'toil:run', id: 'next-preset'}`;
 * - `live`: a method on `window.__stims_live` with JSON arguments, e.g.
 *   `{type: 'live', method: 'ramp', args: [{targets: {warp: 2}, durationMs: 4000}]}`;
 * - `capture`: the stage as a JPEG from `__stims_agent.captureImage()`.
 */
export type LiveCommand =
  | ({ type: `toil:${string}` } & Record<string, unknown>)
  | { type: 'live'; method: string; args?: unknown[] }
  | { type: 'capture' };

export type LiveCommandResult = {
  success: boolean;
  reason?: string;
} & Record<string, unknown>;

export interface LiveCommandEnvelope {
  requestId: string;
  command: LiveCommand;
}

export interface LiveReplyEnvelope {
  clientId: string;
  requestId: string;
  result: LiveCommandResult;
}
