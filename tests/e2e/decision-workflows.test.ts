/** Real stage capture, explicit upload, rendered feedback, and mutation guards. */
import { afterAll, beforeAll, expect } from 'bun:test';
import { chromium } from 'playwright';
import sharp from 'sharp';
import type {
  DecisionRequest,
  DecisionResult,
} from '../../src/js/core/decision-model.ts';
import { hasChromium, requiredBrowserTest } from './browser-availability.ts';
import { type DevServerHandle, startDevServer } from './dev-server.ts';
import { HEADLESS, SOFTWARE_RENDERER_ARGS } from './webgl-launch.ts';

const TEST_PORT = 5226;
const origin = `http://127.0.0.1:${TEST_PORT}`;
let server: DevServerHandle | null = null;
beforeAll(
  async () => {
    if (!hasChromium) return;
    const previous = process.env.VITE_STIMS_API_BASE;
    process.env.VITE_STIMS_API_BASE = origin;
    try {
      server = await startDevServer({ port: TEST_PORT });
    } finally {
      if (previous === undefined) delete process.env.VITE_STIMS_API_BASE;
      else process.env.VITE_STIMS_API_BASE = previous;
    }
  },
  { timeout: 60_000 },
);
afterAll(async () => {
  await server?.stop();
});

requiredBrowserTest(
  'picture checks upload only on demand and preserve the live preset',
  async () => {
    const browser = await chromium.launch({
      headless: HEADLESS,
      args: SOFTWARE_RENDERER_ARGS,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await context.addInitScript(() =>
        localStorage.setItem('stims:onboarding-complete', 'true'),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const requests: DecisionRequest[] = [];
      await page.route('**/api/decide', async (route) => {
        const body = route.request().postDataJSON() as DecisionRequest;
        requests.push(body);
        if (body.task === 'scene-choice') {
          const result: DecisionResult = {
            version: 1,
            task: 'scene-choice',
            model: 'clef-omni',
            disposition: 'accepted',
            provenance: {
              questionVersion: 'stims-clef-v1',
              evaluatedAt: new Date().toISOString(),
              inputHash: 'c'.repeat(64),
            },
            answers: {
              scene: {
                type: 'choice',
                choice: 'scene1',
                confidence: 0.95,
                probabilities: { scene0: 0.05, scene1: 0.95, hold: 0.0 },
              },
              sufficient_evidence: { type: 'noul', noul: 0.99 },
            },
          };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(result),
          });
        }
        if (body.videos?.length) {
          const result: DecisionResult = {
            version: 1,
            task: 'prompt-match',
            model: 'clef-omni',
            disposition: 'accepted',
            provenance: {
              questionVersion: 'stims-clef-v1',
              evaluatedAt: new Date().toISOString(),
              inputHash: 'b'.repeat(64),
            },
            answers: {
              structure_match: { type: 'noul', noul: 0.99 },
              palette_match: { type: 'noul', noul: 0.99 },
              composition_match: { type: 'noul', noul: 0.99 },
              sufficient_evidence: { type: 'noul', noul: 0.99 },
            },
          };
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(result),
          });
        }
        const result: DecisionResult = {
          version: 1,
          task: 'prompt-match',
          model: 'clef-flash',
          disposition: 'accepted',
          provenance: {
            questionVersion: 'stims-clef-v1',
            evaluatedAt: new Date().toISOString(),
            inputHash: 'a'.repeat(64),
          },
          answers: {
            structure_match: { type: 'noul', noul: 0.99 },
            palette_match: { type: 'noul', noul: 0.01 },
            composition_match: { type: 'noul', noul: 0.99 },
            sufficient_evidence: { type: 'noul', noul: 0.99 },
          },
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(result),
        });
      });
      await page.goto(`${origin}/?agent=true&renderer=webgl`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('body[data-engine-state="ready"]', {
        timeout: 30_000,
      });
      await page.evaluate(() =>
        window.__stims_agent?.waitFor(
          (s) => s.catalogSize > 0 && s.presetId !== null,
          30_000,
        ),
      );
      await page.evaluate(() => window.__stims_agent?.run('audio-demo'));
      await page.evaluate(() =>
        window.__stims_agent?.waitFor((s) => s.engineState === 'live', 30_000),
      );
      await page.evaluate(() => window.__stims_agent?.run('open-generate'));
      const prompt = page.getByRole('textbox', {
        name: 'Description',
        exact: true,
      });
      await prompt.fill('a blue tunnel');
      await page
        .getByText('Check the current picture', { exact: true })
        .click();
      expect(requests).toHaveLength(0);
      const preset = await page.evaluate(
        () => window.__stims_agent?.getState().presetId,
      );
      await page
        .getByRole('button', {
          name: 'Check picture with AI (Clef Flash)',
          exact: true,
        })
        .click();
      await page
        .getByRole('status')
        .filter({ hasText: 'appears to miss part' })
        .waitFor({ timeout: 60_000 });
      expect(requests).toHaveLength(1);
      expect(requests[0].state.prompt).toBe('a blue tunnel');
      expect(requests[0].audio).toBeUndefined();
      expect(requests[0].videos).toBeUndefined();
      const image = requests[0].images?.[0] ?? '';
      expect(image.startsWith('data:image/jpeg;base64,')).toBe(true);
      const metadata = await sharp(
        Buffer.from(image.split(',')[1], 'base64'),
      ).metadata();
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(640);
      expect(
        await page.evaluate(() => window.__stims_agent?.getState().presetId),
      ).toBe(preset);

      // Clef Omni canvas animation check
      await page
        .getByRole('button', {
          name: 'Check animation with AI (Clef Omni)',
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () => {
          const text =
            document.querySelector('p[role="status"]')?.textContent ?? '';
          return (
            !text.includes('Recording animation') &&
            !text.includes('Evaluating animation')
          );
        },
        null,
        { timeout: 60_000 },
      );
      const animationStatus = await page
        .locator('p[role="status"]')
        .textContent();
      expect(animationStatus).toContain(
        'The animation appears to match your description',
      );
      expect(requests).toHaveLength(2);
      expect(requests[1].task).toBe('prompt-match');
      expect(requests[1].videos).toBeDefined();
      expect(
        requests[1].videos?.[0].startsWith('data:video/webm;base64,'),
      ).toBe(true);

      for (const width of [375, 768, 1024, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        expect(
          await page
            .getByRole('button', {
              name: 'Check picture with AI (Clef Flash)',
              exact: true,
            })
            .isVisible(),
        ).toBe(true);
      }
      // A continuing modulator is evidence, while a new gesture invalidates it.
      await page.waitForFunction(() => window.__stims_live !== undefined);
      const revisions = await page.evaluate(async () => {
        const live = window.__stims_live;
        const agent = window.__stims_agent;
        if (!live || !agent) throw new Error('Missing live API');
        live.bind({
          id: 'decision-test',
          target: 'zoom',
          depth: 0.05,
          source: { kind: 'lfo', hz: 1 },
        });
        const before = agent.getPerformanceRevision();
        const initial = live
          .listModulators()
          .find((m) => m.id === 'decision-test')?.value;
        await agent.waitFor(
          () =>
            live.listModulators().find((m) => m.id === 'decision-test')
              ?.value !== initial,
          // CI software rasterizers can drop to a few frames per second
          // under parallel e2e load; this is a frame-driven predicate, not
          // a timing assertion.
          30_000,
        );
        const afterFrame = agent.getPerformanceRevision();
        live.setControl('zoom', 1.02);
        const afterGesture = agent.getPerformanceRevision();
        live.unbindAll();
        return { before, afterFrame, afterGesture };
      });
      expect(revisions.before).toBe(revisions.afterFrame);
      expect(revisions.afterGesture).not.toBe(revisions.before);

      // Clef Omni live VJ scene auto-switching test
      await page.waitForFunction(() => window.__stims_live !== undefined);
      const sceneOutcome = await page.evaluate(async () => {
        const live = window.__stims_live;
        if (!live) throw new Error('Missing live API');
        live.setControl('warp', 0.2);
        live.saveScene('ambient-flow', 'slow ambient blue flow');
        live.setControl('warp', 1.8);
        live.saveScene('strobe-drop', 'high energy strobe');
        return await live.autoSwitchScene({ durationMs: 100 });
      });
      expect(sceneOutcome.chosenScene).toBe('strobe-drop');
      expect(sceneOutcome.applied).toBe(true);
      expect(sceneOutcome.confidence).toBe(0.95);
      expect(
        await page.evaluate(() => window.__stims_live?.getPositions().warp),
      ).toBe(1.8);

      expect(errors).toEqual([]);
      expect(
        await page.evaluate(() => window.__stims_agent?.getState().lastError),
      ).toBeNull();
    } finally {
      await browser.close();
    }
  },
  { timeout: 120_000 },
);
