/**
 * Drive the tab a person is watching through the dev server's live channel:
 * print the stage's state, or send it one command and print the reply.
 *
 * `bun run ctl` launches a browser of its own; this talks to the one already
 * open on `bun run dev`, through `scripts/vite-live-channel.ts`. The stage's
 * events accumulate in `scratch/live/events.jsonl` either way.
 *
 * Usage:
 *   bun run live -- status                      # stage tab, connected tabs, latest state
 *   bun run live -- run <action> ['<json>']     # palette action or verb (toil:run)
 *   bun run live -- call <method> ['<json>']    # window.__stims_live method; an array is the argument list
 *   bun run live -- capture                     # stage JPEG → scratch/live/frame.jpg
 *   bun run live -- send '<json>'               # any command: a toil:* message,
 *                                               # {type:"live",method,args} or {type:"capture"}
 *
 * Options:
 *   --port <n>       dev server port (default: scratch/live/server.json, then 5173)
 *   --timeout <ms>   how long to wait for the stage's reply (default 45000)
 *
 * Exits non-zero when the stage refuses or fails the command, or no tab is
 * connected.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LiveCommand } from '../src/js/frontend/live-channel-protocol.ts';
import { LIVE_CHANNEL_DIR, LIVE_CHANNEL_ROUTE } from './vite-live-channel.ts';

const USAGE =
  'Usage: bun run live -- status | run <action> [json] | call <method> [json] | capture | send <json> [--port n] [--timeout ms]';

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${what} is not JSON (${error instanceof Error ? error.message : String(error)}): ${text}`,
    );
  }
}

export function buildCommand(words: string[]): LiveCommand | null {
  const [verb, first, second] = words;
  switch (verb) {
    case 'run': {
      if (!first) throw new Error('run needs an action id.');
      const params = second ? parseJson(second, 'params') : undefined;
      return params === undefined
        ? { type: 'toil:run', id: first }
        : { type: 'toil:run', id: first, params };
    }
    case 'call': {
      if (!first) throw new Error('call needs a __stims_live method name.');
      const value = second ? parseJson(second, 'arguments') : undefined;
      const args =
        value === undefined ? [] : Array.isArray(value) ? value : [value];
      return { type: 'live', method: first, args };
    }
    case 'capture':
      return { type: 'capture' };
    case 'send': {
      if (!first) throw new Error('send needs a command as JSON.');
      return parseJson(first, 'command') as LiveCommand;
    }
    case 'status':
      return null;
    default:
      throw new Error(USAGE);
  }
}

function resolvePort(flag: string | undefined): number {
  if (flag) return Number(flag);
  if (process.env.STIMS_LIVE_PORT) return Number(process.env.STIMS_LIVE_PORT);
  try {
    const server = JSON.parse(
      readFileSync(
        join(
          process.env.STIMS_LIVE_CHANNEL_DIR ?? LIVE_CHANNEL_DIR,
          'server.json',
        ),
        'utf8',
      ),
    ) as { port?: number };
    if (server.port) return server.port;
  } catch {
    // No dev server has announced itself in this checkout.
  }
  return 5173;
}

function takeFlag(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const [, value] = argv.splice(index, 2);
  return value;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.length === 0) {
    console.log(USAGE);
    return;
  }
  const port = resolvePort(takeFlag(argv, '--port'));
  const timeout = takeFlag(argv, '--timeout');
  const command = buildCommand(argv);
  const base = `http://127.0.0.1:${port}${LIVE_CHANNEL_ROUTE}`;
  let response: Response;
  try {
    response = command
      ? await fetch(
          `${base}/command${timeout ? `?timeoutMs=${Number(timeout)}` : ''}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(command),
          },
        )
      : await fetch(`${base}/state`);
  } catch {
    throw new Error(
      `Nothing answered on port ${port}. Start the dev server with bun run dev, or pass --port.`,
    );
  }
  const body = (await response.json()) as { success?: boolean };
  console.log(JSON.stringify(body, null, 2));
  if (!response.ok || body.success === false) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
