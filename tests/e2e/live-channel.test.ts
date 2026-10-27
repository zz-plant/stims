/**
 * The live channel end to end: the real app on a vite dev server with the
 * channel on, a real page as the stage, and commands arriving the way an agent
 * sends them, over HTTP and as saved files.
 *
 * tests/unit/vite-live-channel.test.ts checks the server's routing against a
 * stand-in tab, and tests/unit/live-channel.test.ts the page's relay against a
 * stand-in server. This checks that the two halves meet: the page installs
 * the client from app.ts, says hello, becomes the stage, answers each kind of
 * command with what actually happened, and reports what happened on stage to
 * scratch/live/.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AUTOPLAY_ARG } from '../../scripts/embed-harness.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5241;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;
let liveDir = '';

beforeAll(
  async () => {
    if (!hasChromium) return;
    liveDir = mkdtempSync(join(tmpdir(), 'stims-live-e2e-'));
    devServer = await startDevServer({
      port: TEST_PORT,
      // The harness turns the channel off for every server it spawns; this
      // suite turns it back on, writing to a directory of its own.
      command: [
        'env',
        'STIMS_LIVE_CHANNEL=1',
        `STIMS_LIVE_CHANNEL_DIR=${liveDir}`,
        'bun',
        'run',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(TEST_PORT),
        '--strictPort',
      ],
    });
  },
  { timeout: 60000 },
);

afterAll(async () => {
  const server = devServer;
  devServer = null;
  await server?.stop();
  if (liveDir) rmSync(liveDir, { recursive: true, force: true });
});

type Reply = Record<string, unknown> & { success: boolean };

async function send(command: Record<string, unknown>): Promise<Reply> {
  const response = await fetch(`${SERVER_URL}/__stims-live/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  return (await response.json()) as Reply;
}

function readLog(): Record<string, unknown>[] {
  if (!existsSync(join(liveDir, 'events.jsonl'))) return [];
  return readFileSync(join(liveDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Polls a condition the server reaches asynchronously; never a fixed sleep. */
async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  what: string,
  timeoutMs = 30000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

requiredBrowserTest(
  'an agent drives the stage tab over HTTP and saved files, and reads back what happened',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: [...SOFTWARE_RENDERER_ARGS, AUTOPLAY_ARG],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 960, height: 540 },
      });
      // A Playwright page is automated; ?liveChannel=1 lets it be the stage.
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl&liveChannel=1`);
      await until(async () => {
        const state = (await (
          await fetch(`${SERVER_URL}/__stims-live/state`)
        ).json()) as { stage: unknown };
        return state.stage;
      }, 'the page to become the stage');

      expect(
        await send({ type: 'toil:load_preset', presetId: 'geiss-casino' }),
      ).toMatchObject({
        action: 'load_preset',
        success: true,
        presetId: 'geiss-casino',
      });

      // A broken save reports the compile failure, not a success.
      writeFileSync(
        join(liveDir, 'preset.milk'),
        '[preset00]\nper_frame_1=zoom = (1 +;\n',
      );
      const broken = await until(
        () => readLog().find((entry) => entry.via === 'file:preset.milk'),
        'the broken preset.milk to be applied',
      );
      expect(broken.result).toMatchObject({ success: false });
      expect(
        (broken.result as { state: { errorCount: number } }).state.errorCount,
      ).toBeGreaterThan(0);

      expect(
        await send({ type: 'toil:set_audio', source: 'demo' }),
      ).toMatchObject({ action: 'set_audio', success: true });

      const selected = await send({
        type: 'toil:run',
        id: 'select-preset',
        params: { id: 'martin-skywards' },
      });
      expect(selected).toMatchObject({ action: 'run', success: true });

      expect(
        await send({
          type: 'live',
          method: 'setControl',
          args: ['warp', 1.4],
        }),
      ).toMatchObject({ success: true });
      expect(
        await send({ type: 'live', method: 'getPositions' }),
      ).toMatchObject({ success: true, value: { warp: 1.4 } });

      // The CLI is the same route, with an exit code a script can branch on.
      const cli = (...words: string[]) =>
        Bun.spawnSync(
          [
            'bun',
            'run',
            'scripts/live-channel-cli.ts',
            ...words,
            '--port',
            String(TEST_PORT),
          ],
          { stdout: 'pipe', stderr: 'pipe' },
        );
      const positions = cli('call', 'getPositions');
      expect(positions.exitCode).toBe(0);
      expect(JSON.parse(positions.stdout.toString())).toMatchObject({
        success: true,
        value: { warp: 1.4 },
      });
      expect(cli('run', 'next-presett').exitCode).toBe(1);

      const capture = await send({ type: 'capture' });
      expect(capture).toMatchObject({ success: true });
      const jpeg = readFileSync(String(capture.imagePath));
      // JPEG start-of-image marker.
      expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);

      // What happened on stage reached the log and the state file.
      const presetEvent = await until(
        () =>
          readLog().find(
            (entry) =>
              entry.from === 'page' &&
              entry.type === 'preset' &&
              (entry.data as { to?: string }).to === 'martin-skywards',
          ),
        'the preset switch in events.jsonl',
      );
      expect(presetEvent).toBeTruthy();
      const state = await until(() => {
        const parsed = JSON.parse(
          readFileSync(join(liveDir, 'state.json'), 'utf8'),
        ) as {
          state: { presetId?: string; positions?: Record<string, number> };
        };
        return parsed.state?.presetId === 'martin-skywards'
          ? parsed.state
          : undefined;
      }, 'state.json to show the new preset');
      expect(state.positions).toMatchObject({ warp: 1.4 });
      expect(
        readLog().filter((entry) => entry.from === 'agent').length,
      ).toBeGreaterThanOrEqual(6);
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);
