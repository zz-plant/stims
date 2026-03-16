import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { playToy } from '../scripts/play-toy.ts';

const chromiumPath = chromium.executablePath();
const hasChromium = fs.existsSync(chromiumPath);
const integrationTest = hasChromium ? test : test.skip;
const TEST_PORT = 5180;
let devServer: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 20000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for dev server at ${url}`);
}

beforeAll(async () => {
  if (!hasChromium) return;

  devServer = spawn(
    'bun',
    ['run', 'vite', '--host', '127.0.0.1', '--port', String(TEST_PORT)],
    {
      stdio: 'ignore',
      cwd: process.cwd(),
    },
  );

  await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);
}, 30000);

afterAll(async () => {
  if (!devServer) return;

  devServer.kill('SIGTERM');
  await new Promise((resolve) => devServer?.once('exit', resolve));
  devServer = null;
});

integrationTest(
  'agents can launch and capture holy toy',
  async () => {
    // Increase timeout for browser launch
    const result = await playToy({
      slug: 'holy',
      screenshot: true,
      duration: 3000,
      outputDir: './test-screenshots',
      port: TEST_PORT,
    });

    expect(result.success).toBe(true);
    expect(result.screenshot).toBeTruthy();
  },
  { timeout: 45000 },
);

integrationTest(
  'agents can detect failing toy',
  async () => {
    const result = await playToy({
      slug: 'non-existent-toy-slug',
      duration: 1000,
      port: TEST_PORT,
    });

    // It might fail or just time out searching for element
    // The playToy script returns success: false on catch
    expect(result.success).toBe(false);
  },
  { timeout: 45000 },
);
