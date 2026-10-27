/**
 * Behavioural coverage for the dev-server half of the live channel
 * (`scripts/vite-live-channel.ts`), against a real vite dev server with only
 * this plugin, and a WebSocket client that speaks vite's HMR protocol the way
 * a tab's `import.meta.hot` does.
 *
 * What can go wrong is the routing: a command reaching an automated tab
 * instead of the one a person is watching, a reply landing on the wrong
 * request, a save not reaching the page, or the log missing what the agent
 * did. Each test drives one of those through the same socket, HTTP route and
 * file watcher a live session uses.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import {
  type LiveClient,
  liveChannel,
  pickStage,
} from '../../scripts/vite-live-channel.ts';

type Message = { type: string; event?: string; data?: unknown };

function portOf(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('vite is not listening on a port');
  }
  return address.port;
}

/** One tab's HMR socket. */
class FakeTab {
  readonly received: Message[] = [];
  private readonly waiters: Array<() => void> = [];
  private constructor(
    private readonly socket: WebSocket,
    readonly clientId: string,
  ) {
    socket.addEventListener('message', (event) => {
      this.received.push(JSON.parse(String(event.data)) as Message);
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static async open(server: ViteDevServer, clientId: string) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${portOf(server)}/?token=${server.config.webSocketToken}`,
      'vite-hmr',
    );
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('ws error')), {
        once: true,
      });
    });
    return new FakeTab(socket, clientId);
  }

  send(event: string, data: unknown) {
    this.socket.send(JSON.stringify({ type: 'custom', event, data }));
  }

  hello(overrides: Partial<LiveClient> = {}) {
    this.send('stims-live:hello', {
      clientId: this.clientId,
      visible: true,
      focused: false,
      url: 'http://localhost/',
      userAgent: 'test',
      webdriver: false,
      optIn: false,
      ...overrides,
    });
  }

  commands() {
    return this.received.filter((m) => m.event === 'stims-live:command') as {
      data: { requestId: string; command: Record<string, unknown> };
    }[];
  }

  /** Resolves with the next command this tab receives. */
  async nextCommand(timeoutMs = 3000) {
    const seen = this.commands().length;
    const deadline = Date.now() + timeoutMs;
    while (this.commands().length === seen) {
      if (Date.now() > deadline) throw new Error('no command arrived');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
    return this.commands()[seen].data;
  }

  reply(requestId: string, result: Record<string, unknown>) {
    this.send('stims-live:reply', {
      clientId: this.clientId,
      requestId,
      result,
    });
  }

  close() {
    this.socket.close();
  }
}

/** Polls a condition the server reaches asynchronously; never a fixed sleep. */
async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Awaited: a pending Promise is truthy, so an unawaited async read
    // returned on the first pass without waiting for anything.
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let root: string;
let server: ViteDevServer;
let base: string;
const tabs: FakeTab[] = [];

const liveDir = () => join(root, 'scratch/live');
const readLog = () => {
  try {
    return readFileSync(join(liveDir(), 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
};
const stageId = async () =>
  (
    (await (await fetch(`${base}/__stims-live/state`)).json()) as {
      stage: { id: string } | null;
    }
  ).stage?.id ?? null;

async function openTab(clientId: string, overrides?: Partial<LiveClient>) {
  const tab = await FakeTab.open(server, clientId);
  tabs.push(tab);
  tab.hello(overrides);
  return tab;
}

function post(command: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/__stims-live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(command),
  });
}

beforeEach(async () => {
  // Real path: vite resolves its root, so macOS's /var → /private/var link
  // would otherwise make every expected path differ from the one served.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'stims-live-channel-')));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>');
  server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [liveChannel()],
    server: { port: 0, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  base = `http://127.0.0.1:${portOf(server)}`;
});

afterEach(async () => {
  for (const tab of tabs.splice(0)) tab.close();
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('pickStage', () => {
  const client = (
    clientId: string,
    fields: Partial<LiveClient> = {},
  ): LiveClient => ({
    clientId,
    url: '',
    userAgent: '',
    visible: false,
    focused: false,
    webdriver: false,
    optIn: false,
    activeAt: 0,
    ...fields,
  });

  test('prefers a focused visible tab, then a visible one, then the most recently active', () => {
    expect(
      pickStage([
        client('hidden', { activeAt: 9 }),
        client('visible', { visible: true, activeAt: 1 }),
        client('focused', { visible: true, focused: true, activeAt: 0 }),
      ])?.clientId,
    ).toBe('focused');
    expect(
      pickStage([
        client('older', { visible: true, activeAt: 1 }),
        client('newer', { visible: true, activeAt: 2 }),
      ])?.clientId,
    ).toBe('newer');
  });

  test('skips automated tabs unless they opted in', () => {
    const automated = client('bot', {
      visible: true,
      focused: true,
      webdriver: true,
    });
    expect(pickStage([automated])).toBeNull();
    expect(pickStage([automated, client('person')])?.clientId).toBe('person');
    expect(pickStage([{ ...automated, optIn: true }])?.clientId).toBe('bot');
  });
});

describe('live channel on a vite dev server', () => {
  test('relays a command to the stage tab only and answers with its reply', async () => {
    const automated = await openTab('bot', { webdriver: true, focused: true });
    const person = await openTab('person');
    await until(async () => (await stageId()) === 'person' || undefined);

    const response = post({ type: 'toil:run', id: 'next-preset' });
    const delivered = await person.nextCommand();
    expect(delivered.command).toEqual({ type: 'toil:run', id: 'next-preset' });
    person.reply(delivered.requestId, { success: true, action: 'run' });

    const body = (await (await response).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      action: 'run',
      clientId: 'person',
    });
    expect(automated.commands()).toEqual([]);
    expect(readLog().at(-1)).toMatchObject({
      from: 'agent',
      type: 'command',
      via: 'http',
      command: { type: 'toil:run', id: 'next-preset' },
      result: { success: true },
    });
  });

  test('moves the stage to the tab brought forward and back when it closes', async () => {
    const first = await openTab('first');
    await until(async () => (await stageId()) === 'first' || undefined);
    const second = await openTab('second', { visible: false });
    second.send('stims-live:presence', {
      clientId: 'second',
      visible: true,
      focused: true,
    });
    await until(async () => (await stageId()) === 'second' || undefined);

    second.close();
    await until(async () => (await stageId()) === 'first' || undefined);
    expect(
      readLog()
        .filter((entry) => entry.type === 'stage')
        .map((entry) => (entry.stage as { id: string } | null)?.id),
    ).toEqual(['first', 'second', 'first']);
    first.close();
  });

  test('logs the stage tab’s events and state, and ignores other tabs’', async () => {
    const stage = await openTab('stage', { focused: true });
    const other = await openTab('other', { visible: false });
    await until(async () => (await stageId()) === 'stage' || undefined);

    other.send('stims-live:event', {
      clientId: 'other',
      event: { seq: 1, at: 0, type: 'preset', data: { to: 'ignored' } },
    });
    stage.send('stims-live:event', {
      clientId: 'stage',
      event: { seq: 1, at: 0, type: 'preset', data: { to: 'geiss-casino' } },
    });
    stage.send('stims-live:state', {
      clientId: 'stage',
      state: { presetId: 'geiss-casino', fps: 60 },
    });

    const state = await until(() => {
      try {
        const parsed = JSON.parse(
          readFileSync(join(liveDir(), 'state.json'), 'utf8'),
        ) as { state: { presetId?: string } | null };
        return parsed.state?.presetId ? parsed : undefined;
      } catch {
        return undefined;
      }
    });
    expect(state).toMatchObject({
      stage: { id: 'stage' },
      state: { presetId: 'geiss-casino' },
    });
    const pageEvents = readLog().filter((entry) => entry.from === 'page');
    expect(pageEvents).toEqual([
      expect.objectContaining({ type: 'preset', data: { to: 'geiss-casino' } }),
    ]);
  });

  test('applies preset.milk to the stage on each save, once per content', async () => {
    const tab = await openTab('stage', { focused: true });
    await until(async () => (await stageId()) === 'stage' || undefined);

    writeFileSync(join(liveDir(), 'preset.milk'), 'zoom=1.01\n');
    const applied = await tab.nextCommand();
    expect(applied.command).toEqual({
      type: 'toil:apply_source',
      source: 'zoom=1.01\n',
    });
    tab.reply(applied.requestId, {
      success: false,
      reason: 'The source failed to compile.',
      state: { errorCount: 1 },
    });
    const logged = await until(() =>
      readLog().find((entry) => entry.via === 'file:preset.milk'),
    );
    // The log names the size, not the whole preset.
    expect(logged).toMatchObject({
      command: { type: 'toil:apply_source', source: '<10 chars>' },
      result: { success: false, state: { errorCount: 1 } },
    });

    writeFileSync(join(liveDir(), 'pattern.js'), 's("bd*4")');
    const pattern = await tab.nextCommand();
    expect(pattern.command).toEqual({
      type: 'live',
      method: 'playPattern',
      args: ['s("bd*4")'],
    });
    tab.reply(pattern.requestId, { success: true });

    writeFileSync(join(liveDir(), 'pattern.js'), '\n');
    const hush = await tab.nextCommand();
    expect(hush.command).toEqual({ type: 'live', method: 'hush' });
  });

  test('logs preset code by size and every other field as sent', async () => {
    const tab = await openTab('stage', { focused: true });
    await until(async () => (await stageId()) === 'stage' || undefined);

    for (const command of [
      { type: 'toil:set_audio', source: 'demo' },
      { type: 'toil:load_preset', milkSource: '[preset00]\nzoom=1\n' },
    ]) {
      const response = post(command);
      const delivered = await tab.nextCommand();
      // The page gets the whole command; only the log shortens it.
      expect(delivered.command).toEqual(command);
      tab.reply(delivered.requestId, { success: true });
      await response;
    }

    expect(
      readLog()
        .filter((entry) => entry.from === 'agent')
        .map((entry) => entry.command),
    ).toEqual([
      { type: 'toil:set_audio', source: 'demo' },
      { type: 'toil:load_preset', milkSource: '<18 chars>' },
    ]);
  });

  test('stores a capture as frame.jpg instead of returning the image', async () => {
    const tab = await openTab('stage', { focused: true });
    await until(async () => (await stageId()) === 'stage' || undefined);

    const response = post({ type: 'capture' });
    const command = await tab.nextCommand();
    tab.reply(command.requestId, {
      success: true,
      image: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
    });
    const body = (await (await response).json()) as Record<string, unknown>;

    expect(body.image).toBeUndefined();
    expect(body.imagePath).toBe(join(liveDir(), 'frame.jpg'));
    expect(readFileSync(join(liveDir(), 'frame.jpg'), 'utf8')).toBe(
      'jpeg-bytes',
    );
  });

  test('says why when no tab can take the command', async () => {
    const empty = await post({ type: 'toil:run', id: 'next-preset' });
    expect(empty.status).toBe(503);
    expect(((await empty.json()) as { reason: string }).reason).toContain(
      'No tab is connected',
    );

    await openTab('bot', { webdriver: true });
    const automatedOnly = await post({ type: 'capture' });
    expect(
      ((await automatedOnly.json()) as { reason: string }).reason,
    ).toContain('automated');
  });

  test('fails a command at once when the stage closes before answering', async () => {
    const tab = await openTab('stage', { focused: true });
    await until(async () => (await stageId()) === 'stage' || undefined);

    const response = post({ type: 'toil:run', id: 'next-preset' });
    await tab.nextCommand();
    tab.close();

    const body = (await (await response).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: false, clientId: 'stage' });
    expect(String(body.reason)).toContain('closed or reloaded');
  });

  test('refuses a cross-site page and a body that skips the preflight', async () => {
    const crossSite = await post(
      { type: 'toil:run', id: 'next-preset' },
      { Origin: 'https://example.com' },
    );
    expect(crossSite.status).toBe(403);

    const formPost = await fetch(`${base}/__stims-live/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"type":"toil:run","id":"next-preset"}',
    });
    expect(formPost.status).toBe(415);
  });
});
