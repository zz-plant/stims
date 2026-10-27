/**
 * Behavioural coverage for the page half of the live channel
 * (`src/js/frontend/live-channel.ts`): what a tab does with a command from the
 * dev server, and what it reports back.
 *
 * The hot channel is a stand-in for `import.meta.hot`; the window, the agent
 * bridge that answers `toil:*` messages, and the message round trip between
 * them are the real ones, so a relay that never hears the bridge's reply
 * fails here.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { initAgentBridge } from '../../src/js/frontend/agent-bridge.ts';
import {
  installLiveChannel,
  type LiveHotChannel,
} from '../../src/js/frontend/live-channel.ts';
import type { LiveCommand } from '../../src/js/frontend/live-channel-protocol.ts';

type Sent = { event: string; data: Record<string, unknown> };

class FakeHot implements LiveHotChannel {
  readonly sent: Sent[] = [];
  private readonly listeners = new Map<
    string,
    Array<(data: unknown) => void>
  >();

  send(event: string, data?: unknown) {
    this.sent.push({ event, data: data as Record<string, unknown> });
  }

  on(event: string, listener: (data: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  off(event: string, listener: (data: unknown) => void) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((l) => l !== listener),
    );
  }

  emit(event: string, data: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }

  /** Delivers a command and resolves with the tab's reply to it. */
  async command(command: LiveCommand, requestId = 'r1') {
    this.emit('stims-live:command', { requestId, command });
    const reply = await until(() =>
      this.sent.find(
        (s) => s.event === 'stims-live:reply' && s.data.requestId === requestId,
      ),
    );
    return reply.data.result as Record<string, unknown>;
  }
}

/** Waits for something the page does asynchronously; never a fixed sleep. */
async function until<T>(read: () => T | undefined, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  window.__stims_live = undefined;
  window.__stims_agent = undefined;
});

function install() {
  const hot = new FakeHot();
  cleanups.push(installLiveChannel(hot));
  return hot;
}

describe('live channel page client', () => {
  test('says hello with what the server needs to pick a stage', () => {
    const { happyDOM } = window as unknown as {
      happyDOM: { setURL: (url: string) => void };
    };
    const previous = window.location.href;
    happyDOM.setURL('http://localhost:5173/?agent=true&liveChannel=1');
    try {
      const hot = install();
      const hello = hot.sent.find((s) => s.event === 'stims-live:hello');
      expect(hello?.data).toMatchObject({
        // happy-dom reports itself as automated, as Playwright does.
        webdriver: window.navigator.webdriver === true,
        optIn: true,
        url: 'http://localhost:5173/?agent=true&liveChannel=1',
      });
      expect(typeof hello?.data.clientId).toBe('string');

      hot.emit('vite:ws:connect', undefined);
      expect(
        hot.sent.filter((s) => s.event === 'stims-live:hello'),
      ).toHaveLength(2);
    } finally {
      happyDOM.setURL(previous);
    }
  });

  test('relays a toil message to the agent bridge and returns its answer', async () => {
    const ran: Array<[string, unknown]> = [];
    cleanups.push(
      initAgentBridge({
        runAction: async (id, params) => {
          ran.push([id, params]);
          return { success: true, events: [{ type: 'preset' }] };
        },
      }),
    );
    const hot = install();

    const result = await hot.command({
      type: 'toil:run',
      id: 'select-preset',
      params: { id: 'geiss-casino' },
    });

    expect(ran).toEqual([['select-preset', { id: 'geiss-casino' }]]);
    expect(result).toMatchObject({
      success: true,
      action: 'run',
      events: [{ type: 'preset' }],
    });
  });

  test('passes on the bridge refusing a command, as a failure', async () => {
    cleanups.push(initAgentBridge({}));
    const hot = install();

    const result = await hot.command({ type: 'toil:apply_source', source: 1 });

    expect(result.success).toBe(false);
    expect(String(result.reason)).toContain('Send source as preset code');
  });

  test('calls __stims_live methods with JSON arguments and returns JSON', async () => {
    const ramps: unknown[] = [];
    window.__stims_live = {
      ramp: async (request: unknown) => {
        ramps.push(request);
        return { landing: 'glided', final: { warp: 2 }, cancel: () => {} };
      },
      attachStream: () => {},
    } as unknown as NonNullable<typeof window.__stims_live>;
    const hot = install();

    const result = await hot.command({
      type: 'live',
      method: 'ramp',
      args: [{ targets: { warp: 2 }, durationMs: 10 }],
    });

    expect(ramps).toEqual([{ targets: { warp: 2 }, durationMs: 10 }]);
    // The function in the value cannot cross JSON; the data can.
    expect(result).toEqual({
      success: true,
      value: { landing: 'glided', final: { warp: 2 } },
    });

    const refused = await hot.command(
      { type: 'live', method: 'attachStream', args: [] },
      'r2',
    );
    expect(refused).toMatchObject({ success: false, methods: ['ramp'] });
  });

  test('says when the visualizer has not mounted', async () => {
    const hot = install();
    expect(await hot.command({ type: 'live', method: 'hush' })).toMatchObject({
      success: false,
    });
    expect(await hot.command({ type: 'capture' }, 'r2')).toMatchObject({
      success: false,
      reason: 'There is no stage canvas to capture.',
    });
  });

  test('forwards each agent event once, in order', async () => {
    const events = [
      { seq: 1, at: 1, type: 'preset', data: { to: 'a' } },
      { seq: 2, at: 2, type: 'status', data: { message: 'Loaded a' } },
    ];
    window.__stims_agent = {
      getEvents: (since = 0) => events.filter((e) => e.seq > since),
      getState: () => ({ presetId: 'a', statusLog: [{ message: 'x' }] }),
      getPerformanceRevision: () => 'rev:1',
    } as unknown as NonNullable<typeof window.__stims_agent>;
    const hot = install();
    const forwarded = () =>
      hot.sent
        .filter((s) => s.event === 'stims-live:event')
        .map((s) => (s.data.event as { seq: number }).seq);

    await until(() => (forwarded().length === 2 ? true : undefined));
    events.push({ seq: 3, at: 3, type: 'panel', data: { to: 'editor' } });
    await until(() => (forwarded().length === 3 ? true : undefined));
    expect(forwarded()).toEqual([1, 2, 3]);

    const state = await until(
      () => hot.sent.find((s) => s.event === 'stims-live:state')?.data.state,
    );
    // The status log already travels as events.
    expect(state).toEqual({
      presetId: 'a',
      performanceRevision: 'rev:1',
      positions: null,
    });
  });
});
