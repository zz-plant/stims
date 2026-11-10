/**
 * Opening the dock's More actions menu, the way a visitor does.
 *
 * The dock folds away after a few idle seconds (useAutoHideActivity), and
 * while folded its buttons leave the accessibility tree, so a plain role
 * query can wait out its whole timeout on a slow boot: the bar's 3-second
 * countdown starts at mount, long before the engine finishes booting. The
 * pointer goes over the stage first — the gesture that brings the bar back —
 * and the click targets a visible, non-inert button, since the dock is
 * rendered twice (desktop and phone).
 *
 * A slow, software-rendered runner can miss the first nudge or fold the bar
 * again while the click is waiting. Retrying the gesture is what a visitor
 * does, and it is not hiding a product assertion: the click still has to land
 * on a visible, non-inert button within the deadline.
 *
 * A click can also land and still run out its attempt: under load Playwright
 * spends the rest of the 3 seconds waiting out what follows the click. The
 * menu is open by then and its scrim covers the button, so every retry was
 * intercepted and the helper reported a button that never became clickable
 * with the menu already on screen (embed-snippet on CI, 2026-11-08 to 11-10).
 * Both buttons say when their menu is open (`aria-expanded`), and that is
 * what the caller wants, so it ends the wait.
 *
 * It still failed on CI after that, on a runner too slow to reproduce here
 * (CPU throttling to 20x, with four times the pixels, passed). A failure now
 * lists each attempt's last Playwright step and what sat on top of the
 * button, so the next one says which way the click was refused.
 */
import type { Page } from 'playwright';

const CLICK_DEADLINE_MS = 30_000;
const ATTEMPT_MS = 3_000;

async function clickDockButton(page: Page, label: string) {
  const stage = page.locator('.stims-shell__stage-frame');
  // `button`: the open menu panel carries the same aria-label.
  const button = page
    .locator(`button[aria-label="${label}"]:not([inert]):visible`)
    .first();
  const menuOpen = async () =>
    (await page
      .locator(`button[aria-label="${label}"][aria-expanded="true"]:visible`)
      .count()) > 0;
  const deadline = Date.now() + CLICK_DEADLINE_MS;
  const attempts: string[] = [];

  while (Date.now() < deadline) {
    if (await menuOpen()) return;
    const box = await stage.boundingBox();
    if (!box) throw new Error('the stage has no box to point at');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try {
      await button.click({ timeout: ATTEMPT_MS });
      return;
    } catch (error) {
      // The bar was still folded, or folded again, or the click landed and
      // the attempt ran out after it; the next pass tells which.
      attempts.push(
        `${lastPlaywrightStep(error)} | ${await whatCoversButton(page, label)}`,
      );
    }
  }
  if (await menuOpen()) return;
  throw new Error(
    `the ${label} button never became clickable within 30s:\n` +
      attempts.map((line, index) => `  ${index + 1}. ${line}`).join('\n'),
  );
}

/**
 * Why Playwright held the click: the last reason in its call log (something
 * intercepting it, the button hidden or moving), else the last step reached.
 */
function lastPlaywrightStep(error: unknown): string {
  const lines = String(error instanceof Error ? error.message : error)
    .split('\n')
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((line) => line && !line.startsWith('Call log'));
  const reason = lines.findLast((line) =>
    /intercepts|not visible|not stable|not enabled|outside of the viewport|detached/.test(
      line,
    ),
  );
  return reason ?? lines.at(-1) ?? 'no call log';
}

/** Each copy of the button: its visibility, and the element at its centre. */
function whatCoversButton(page: Page, label: string): Promise<string> {
  return page
    .evaluate((name) => {
      const nameOf = (node: Element | null) =>
        node
          ? `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`
          : 'nothing';
      return [...document.querySelectorAll(`button[aria-label="${name}"]`)]
        .map((button) => {
          const box = button.getBoundingClientRect();
          const top = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          const onTop = top === button || button.contains(top);
          return `${getComputedStyle(button).visibility}${
            button.closest('[inert]') ? ' inert' : ''
          }, ${onTop ? 'on top' : `under ${nameOf(top)}`}`;
        })
        .join('; ');
    }, label)
    .catch(() => 'page unreadable');
}

export async function openDockMenu(page: Page) {
  await clickDockButton(page, 'More actions');
}

/** The bar's Share button, there from 640px; narrower, Share is in the menu. */
export async function openDockShare(page: Page) {
  await clickDockButton(page, 'Share');
}
