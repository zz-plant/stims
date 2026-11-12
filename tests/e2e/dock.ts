/**
 * Opening the dock's More actions menu, the way a visitor does.
 *
 * The dock folds away after a few idle seconds (useAutoHideActivity), and
 * while folded its buttons leave the accessibility tree, so a plain role
 * query can wait out its whole timeout on a slow boot: the bar's 3-second
 * countdown starts at mount, long before the engine finishes booting. The
 * pointer goes over the stage first — the gesture that brings the bar back —
 * and the press targets a visible, non-inert button, since the dock is
 * rendered twice (desktop and phone).
 *
 * A slow, software-rendered runner can miss the first nudge or fold the bar
 * again before the press. Retrying the gesture is what a visitor does, and it
 * is not hiding a product assertion: the press still has to land on a
 * visible, non-inert button within the deadline.
 *
 * Both buttons say when their menu is open (`aria-expanded`), and that is
 * what the caller wants, so it ends the wait. A press that landed used to be
 * counted as a miss when Playwright ran out of time after it; the retries
 * then met the open menu's scrim (embed-snippet on CI, 2026-11-08 to 11-10).
 *
 * The press is not Playwright's click. That click is several round trips to
 * the page (wait for the button's box to hold still across two animation
 * frames, scroll to it, move, press, release), and on a runner whose main
 * thread is busy for seconds at a time each one waits its turn. It went
 * wrong on CI twice more:
 *
 *  - The frame wait did not finish in a 3-second attempt, with the button
 *    visible and on top throughout (2026-11-12).
 *  - A forced click, which skips that wait, was sent after a separate check
 *    that the button was on top. The helper returned with no menu open and
 *    the caller's next step timed out (main, 2026-11-12). At 3x CPU throttle
 *    here, a forced click sent with the button on top landed on the stage
 *    canvas: the attempt before it lasts 3 seconds, as long as the bar waits
 *    before it folds.
 *
 * So one evaluate checks that a copy of the button is visible, not inert and
 * the element at its own centre, and clicks it in the same task: nothing can
 * fold the bar or cover the button between the check and the press. The
 * button toggles its menu, so after one press the helper never presses
 * again; it waits for `aria-expanded`, which the same evaluate usually sees.
 * A failure lists what each copy of the button looked like while no press
 * was possible.
 *
 * Why that main thread is busy, measured here at the same throttle: once
 * the flash guard drops its readback worker as stalled
 * (packages/flash-guard/src/sampler.ts), it reads frames back on the main
 * thread, from one to five seconds a read, until it tries the worker again
 * 30 seconds later.
 */
import type { Page } from 'playwright';

/** How long the bar has to come back and take the press. */
const PRESS_DEADLINE_MS = 30_000;
/** How long the pressed button has to say its menu is open. */
const OPEN_DEADLINE_MS = 30_000;

async function clickDockButton(page: Page, label: string) {
  const stage = page.locator('.stims-shell__stage-frame');
  // `button`: the open menu panel carries the same aria-label.
  const expanded = page.locator(
    `button[aria-label="${label}"][aria-expanded="true"]:visible`,
  );
  const menuOpen = async () => (await expanded.count()) > 0;
  const deadline = Date.now() + PRESS_DEADLINE_MS;
  const refusals: string[] = [];

  while (Date.now() < deadline) {
    if (await menuOpen()) return;
    const box = await stage.boundingBox();
    if (!box) throw new Error('the stage has no box to point at');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const press = await page.evaluate(pressIfOnTop, label);
    if (press.pressed) {
      // Pressed once. A second press would close the menu this one opens.
      if (press.open) return;
      const opened = await expanded
        .first()
        .waitFor({ timeout: OPEN_DEADLINE_MS })
        .then(
          () => true,
          () => false,
        );
      if (opened || (await menuOpen())) return;
      throw new Error(
        `the ${label} button was pressed and its menu did not open within 30s`,
      );
    }
    // The bar was still folded, or folded again; nudge it and look again.
    if (refusals.at(-1) !== press.copies) refusals.push(press.copies);
  }
  if (await menuOpen()) return;
  throw new Error(
    `the ${label} button could not be pressed within 30s. Each copy of it, as it changed:\n` +
      refusals.map((line, index) => `  ${index + 1}. ${line}`).join('\n'),
  );
}

type Press =
  | { pressed: true; open: boolean }
  | { pressed: false; copies: string };

/**
 * Runs in the page. Clicks the first copy of the button that a press at its
 * centre would hit, and says whether the button already reports its menu
 * open: React renders the click in a microtask, so one tick later the answer
 * is usually there and the caller needs no further round trip. With no such
 * copy it clicks nothing and returns each copy's visibility and the element
 * at its centre.
 */
async function pressIfOnTop(name: string): Promise<Press> {
  const nameOf = (node: Element | null) =>
    node
      ? `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}`
      : 'nothing';
  const copies: string[] = [];
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${name}"]`,
  )) {
    const inert = button.closest('[inert]') !== null;
    const visibility = getComputedStyle(button).visibility;
    const box = button.getBoundingClientRect();
    const hasBox = box.width > 0 && box.height > 0;
    const top = hasBox
      ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      : null;
    const onTop = top !== null && (top === button || button.contains(top));
    if (!inert && !button.disabled && visibility === 'visible' && onTop) {
      button.click();
      await Promise.resolve();
      return {
        pressed: true,
        open: button.getAttribute('aria-expanded') === 'true',
      };
    }
    copies.push(
      `${visibility}${inert ? ' inert' : ''}${button.disabled ? ' disabled' : ''}, ${
        !hasBox ? 'no box' : onTop ? 'on top' : `under ${nameOf(top)}`
      }`,
    );
  }
  return {
    pressed: false,
    copies: copies.join('; ') || 'no such button in the page',
  };
}

export async function openDockMenu(page: Page) {
  await clickDockButton(page, 'More actions');
}

/** The bar's Share button, there from 640px; narrower, Share is in the menu. */
export async function openDockShare(page: Page) {
  await clickDockButton(page, 'Share');
}
