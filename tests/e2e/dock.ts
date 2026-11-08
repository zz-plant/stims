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
 */
import type { Page } from 'playwright';

const CLICK_DEADLINE_MS = 30_000;
const ATTEMPT_MS = 3_000;

async function clickDockButton(page: Page, label: string) {
  const stage = page.locator('.stims-shell__stage-frame');
  const button = page
    .locator(`[aria-label="${label}"]:not([inert]):visible`)
    .first();
  const deadline = Date.now() + CLICK_DEADLINE_MS;

  while (Date.now() < deadline) {
    const box = await stage.boundingBox();
    if (!box) throw new Error('the stage has no box to point at');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    try {
      await button.click({ timeout: ATTEMPT_MS });
      return;
    } catch {
      // The bar was still folded, or folded again; nudge it and retry.
    }
  }
  throw new Error(`the ${label} button never became clickable within 30s`);
}

export async function openDockMenu(page: Page) {
  await clickDockButton(page, 'More actions');
}

/** The bar's Share button, there from 640px; narrower, Share is in the menu. */
export async function openDockShare(page: Page) {
  await clickDockButton(page, 'Share');
}
