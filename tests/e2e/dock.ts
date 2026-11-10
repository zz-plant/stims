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

  while (Date.now() < deadline) {
    if (await menuOpen()) return;
    const box = await stage.boundingBox();
    if (!box) throw new Error('the stage has no box to point at');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try {
      await button.click({ timeout: ATTEMPT_MS });
      return;
    } catch {
      // The bar was still folded, or folded again, or the click landed and
      // the attempt ran out after it; the next pass tells which.
    }
  }
  if (await menuOpen()) return;
  throw new Error(`the ${label} button never became clickable within 30s`);
}

export async function openDockMenu(page: Page) {
  await clickDockButton(page, 'More actions');
}

/** The bar's Share button, there from 640px; narrower, Share is in the menu. */
export async function openDockShare(page: Page) {
  await clickDockButton(page, 'Share');
}
