import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { playToy } from '../scripts/play-toy.ts';

const chromiumPath = chromium.executablePath();
const hasChromium = fs.existsSync(chromiumPath);
const integrationTest = hasChromium ? test : test.skip;

integrationTest(
  'agents can launch and capture holy toy',
  async () => {
    // Increase timeout for browser launch
    const result = await playToy({
      slug: 'holy',
      screenshot: true,
      duration: 3000,
      outputDir: './test-screenshots',
      port: 5180,
    });

    expect(result.success).toBe(true);
    expect(result.screenshot).toBeTruthy();
    expect(result.audioActive).toBe(true);
  },
  { timeout: 30000 },
);

integrationTest(
  'agents can detect failing toy',
  async () => {
    const result = await playToy({
      slug: 'non-existent-toy-slug',
      duration: 1000,
    });

    // It might fail or just time out searching for element
    // The playToy script returns success: false on catch
    expect(result.success).toBe(false);
  },
  { timeout: 30000 },
);
