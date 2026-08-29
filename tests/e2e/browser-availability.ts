/**
 * Whether a real browser is available, and what each e2e suite should do when
 * it is not.
 *
 * Every e2e file used to derive this itself with
 * `const browserTest = hasChromium ? test : test.skip`, which silently turns a
 * missing dependency into a green run: on an image whose Chromium build does
 * not match the pinned `@playwright/test`, the whole suite reports
 * `0 pass / 5 skip / 0 fail` and exits 0 while testing nothing. For suites
 * that exist to catch a demo button disappearing from the shell, "we could not
 * check" must not look like "we checked and it is fine".
 *
 * So the answer depends on where the run happens, and the two cases are named
 * rather than left to each caller:
 *
 *   requiredBrowserTest — must run wherever a browser is expected. Missing
 *     browser fails in CI (a provisioning fault is a real failure, and the
 *     only way anyone finds out) and skips locally with an explanation, so a
 *     contributor without browsers installed is told rather than stonewalled.
 *
 *   localOnlyBrowserTest — deliberately does not run in CI (needs a real GPU,
 *     or a trusted user gesture headless Chromium will not grant). Skipping is
 *     the correct outcome everywhere, so a missing browser is not a fault.
 */

import { test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { HEADLESS_ENVIRONMENT } from './headless-environment.ts';

export const chromiumExecutablePath = chromium.executablePath();
export const hasChromium = existsSync(chromiumExecutablePath);

const isCi = Boolean(process.env.CI);

const MISSING_BROWSER_REASON =
  `Playwright's Chromium is not installed at ${chromiumExecutablePath}.\n` +
  'This suite cannot verify anything without it, and a skipped run must not ' +
  'be mistaken for a passing one.\n' +
  'If the image already ships a different build — as cloud agent containers ' +
  'do — run `bun run setup:browsers` to link it into the layout this ' +
  'Playwright expects. Otherwise install it with ' +
  '`bunx playwright install chromium`.';

let warned = false;

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    `\n[e2e] SKIPPING browser tests — no Chromium.\n${MISSING_BROWSER_REASON}\n`,
  );
}

type TestOptions = Parameters<typeof test>[2];

/**
 * For browser tests that are part of the CI contract.
 *
 * Missing browser in CI registers a failing test rather than skipping, so the
 * job goes red and names the cause instead of passing with an empty run.
 */
export function requiredBrowserTest(
  name: string,
  body: () => void | Promise<void>,
  options?: TestOptions,
) {
  if (hasChromium) {
    return test(name, body, options);
  }
  if (isCi) {
    return test(name, () => {
      throw new Error(
        `Cannot run "${name}" — no browser available.\n${MISSING_BROWSER_REASON}`,
      );
    });
  }
  warnOnce();
  return test.skip(name, body, options);
}

/**
 * For browser tests that are deliberately local-only — they need a real GPU or
 * a trusted user gesture that a headless browser will not provide. Skipping is
 * the intended outcome anywhere without a display, CI and cloud agent
 * containers alike, so a missing browser is not a fault there.
 */
export function localOnlyBrowserTest(
  name: string,
  body: () => void | Promise<void>,
  options?: TestOptions,
) {
  if (hasChromium && !HEADLESS_ENVIRONMENT) {
    return test(name, body, options);
  }
  return test.skip(name, body, options);
}
