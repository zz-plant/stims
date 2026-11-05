/**
 * Receives probe reports from a shell or browser page and relays commands to it.
 *
 * bun tools/collector.ts <run-dir> [port]
 *   POST /report             a probe line; appended to <run-dir>/<shell>.jsonl
 *   POST /label?shell=&name= marks the next lines, so a run can name its states
 *   POST /run?shell=         body is async JS run in the page; replies with its result
 *   GET  /latest?shell=      the shell's newest tick
 *   GET  /burst-source       the page the tab-capture baseline plays from
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2] ?? 'scratch/desktop-shell';
const port = Number(process.argv[3] ?? 5998);
mkdirSync(runDir, { recursive: true });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
type Pending = { id: string; code: string };
const queues = new Map<string, Pending[]>();
const pollers = new Map<string, (value: Pending | null) => void>();
const results = new Map<string, (value: unknown) => void>();
const latest = new Map<string, unknown>();
const labels = new Map<string, string>();
let nextId = 1;

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { ...cors, 'content-type': 'application/json' },
  });

Bun.serve({
  port,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }
    const shell = url.searchParams.get('shell') ?? 'unknown';

    if (url.pathname === '/burst-source') {
      return new Response(
        Bun.file(join(import.meta.dir, 'burst-source.html')),
        {
          headers: { 'content-type': 'text/html' },
        },
      );
    }

    if (url.pathname === '/report') {
      const body = (await request.json()) as Record<string, unknown>;
      const name = String(body.shell ?? 'unknown');
      const line = { ...body, label: labels.get(name) ?? null, at: Date.now() };
      if (body.kind === 'tick') latest.set(name, line);
      appendFileSync(
        join(runDir, `${name}.jsonl`),
        `${JSON.stringify(line)}\n`,
      );
      return json({ ok: true });
    }
    if (url.pathname === '/label') {
      labels.set(shell, url.searchParams.get('name') ?? '');
      return json({ ok: true });
    }
    if (url.pathname === '/latest') {
      return json(latest.get(shell) ?? null);
    }
    if (url.pathname === '/cmd') {
      const queued = queues.get(shell)?.shift();
      if (queued) return json(queued);
      const waited = await new Promise<Pending | null>((resolve) => {
        pollers.get(shell)?.(null);
        const poller = (value: Pending | null) => {
          clearTimeout(expiry);
          // A poll that already ended must not take the next command with it.
          if (pollers.get(shell) === poller) pollers.delete(shell);
          resolve(value);
        };
        const expiry = setTimeout(() => poller(null), 20_000);
        pollers.set(shell, poller);
      });
      return json(waited);
    }
    if (url.pathname === '/result') {
      const body = (await request.json()) as { id: string };
      results.get(body.id)?.(body);
      results.delete(body.id);
      return json({ ok: true });
    }
    if (url.pathname === '/run') {
      const command = { id: String(nextId++), code: await request.text() };
      const finished = new Promise((resolve) => {
        results.set(command.id, resolve);
        setTimeout(() => resolve({ ok: false, error: 'timed out' }), 60_000);
      });
      const poller = pollers.get(shell);
      if (poller) {
        pollers.delete(shell);
        poller(command);
      } else {
        queues.set(shell, [...(queues.get(shell) ?? []), command]);
      }
      return json(await finished);
    }
    return new Response('not found', { status: 404, headers: cors });
  },
});
console.log(`collector on http://127.0.0.1:${port}, writing to ${runDir}`);
