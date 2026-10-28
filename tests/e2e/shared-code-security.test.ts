/** Compressed shared presets boot and animate; oversized sources are refused. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { deflateSync, strToU8 } from 'fflate';
import { chromium } from 'playwright';
import { AUTOPLAY_ARG } from '../../scripts/embed-harness.ts';
import { buildRemixShareUrl } from '../../src/js/frontend/url-state.ts';
import {
  captureAgentStats,
  getAgentState,
  runAgentAction,
} from './agent-api.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { closeQuietly } from './deadline.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5212;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: DevServerHandle | null = null;

beforeAll(
  async () => {
    if (hasChromium) devServer = await startDevServer({ port: TEST_PORT });
  },
  { timeout: 60000 },
);
afterAll(async () => {
  await devServer?.stop();
});

requiredBrowserTest(
  'a compressed shared preset reaches the editor and animates',
  async () => {
    const source = [
      '[preset00]',
      'title=Bounded compressed share',
      'fDecay=0.98',
      'zoom=1.01',
      'per_frame_1=q1=0.321; wave_r=0.5+0.5*sin(time);',
      ...Array.from(
        { length: 1000 },
        (_, i) => `// ${i} ${(i * 7919) % 99991} ${(i * 10007) % 99989}`,
      ),
    ].join('\n');
    const url = buildRemixShareUrl(
      `${SERVER_URL}/?preset=geiss-casino&agent=true&renderer=webgl`,
      source,
    );
    expect(new URL(url).hash.startsWith('#code=z1~')).toBe(true);
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: [...SOFTWARE_RENDERER_ARGS, AUTOPLAY_ARG],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => Boolean(window.__stims_agent), null, {
        timeout: 30000,
      });
      await page.evaluate(async () => {
        const agent = window.__stims_agent;
        if (!agent) throw new Error('The agent API did not load.');
        await agent.run('audio-demo');
        await agent.waitFor((s) => s.engineState === 'live', 30000);
        await agent.waitForVariables((v) => v.q1 === 0.321, 30000);
      });
      const editor = await page.evaluate(() =>
        window.__STIMS_AGENT_BRIDGE__?.getEditorState(),
      );
      expect(editor).toMatchObject({
        presetId: 'geiss-casino',
        sourceLength: source.length,
        errorCount: 0,
        renderingFallback: false,
      });
      await captureAgentStats(page);
      const stats = await captureAgentStats(page);
      expect(stats).not.toBeNull();
      expect(stats?.motionEstimate).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);

requiredBrowserTest(
  'an over-limit compressed source leaves the workspace usable',
  async () => {
    // Small, bounded reproduction: 2 MiB decoded exceeds the 1 MiB cap.
    const bytes = deflateSync(strToU8(`// oversized\n${' '.repeat(2 << 20)}`));
    const hash = `#code=z1~${Buffer.from(bytes).toString('base64url')}`;
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${SERVER_URL}/?agent=true&renderer=webgl${hash}`);
      await page.waitForFunction(() => Boolean(window.__stims_agent), null, {
        timeout: 30000,
      });
      const state = await getAgentState(page);
      expect(state.panel).toBeNull();
      expect(state.lastError).toBeNull();
      expect((await runAgentAction(page, 'open-browse')).ok).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await closeQuietly(browser);
    }
  },
  { timeout: 180000 },
);
