/**
 * Preset entries as real links.
 *
 * A preset in a list is a link to its page (`/?preset=<id>`, the URL the
 * sitemap and the edge's canonical name it by), so crawlers can follow it and
 * a visitor can open it in a new tab or copy it. Inside the app a plain click
 * still switches presets in place: following the link would reload the app
 * and end the audio session. Every other click (a modifier, the middle button)
 * and the context menu stay the browser's.
 */
import type { MouseEvent } from 'react';

export { presetPageHref } from '../../../functions/shared/preset-page.ts';

/**
 * True for the one click a page may take over: the primary button with no
 * modifier. Enter on a focused link arrives as exactly this click.
 */
export function isPlainPrimaryClick(
  event: Pick<
    MouseEvent,
    | 'button'
    | 'metaKey'
    | 'ctrlKey'
    | 'shiftKey'
    | 'altKey'
    | 'defaultPrevented'
  >,
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * `onClick` for a preset link: runs `open` in place of navigation on a plain
 * click, and leaves every other click to the browser.
 */
export function openPresetInPlace(
  event: MouseEvent<HTMLAnchorElement>,
  open: () => void,
): void {
  if (!isPlainPrimaryClick(event)) return;
  event.preventDefault();
  open();
}
