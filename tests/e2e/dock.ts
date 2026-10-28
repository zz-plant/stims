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
 */
import type { Page } from 'playwright';

export async function openDockMenu(page: Page) {
  const box = await page.locator('.stims-shell__stage-frame').boundingBox();
  if (!box) throw new Error('the stage has no box to point at');
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page
    .locator('[aria-label="More actions"]:not([inert]):visible')
    .first()
    .click({ timeout: 15_000 });
}
