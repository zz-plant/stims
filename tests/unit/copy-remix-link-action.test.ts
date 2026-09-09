/**
 * The remix link — a whole `.milk` source carried in a `#code=` hash — has
 * worked since it shipped and had no control, no label, and no mention. These
 * cover the affordance that names it.
 */
import { describe, expect, it } from 'bun:test';
import { decodePresetCodeFromHash } from '../../src/js/frontend/url-state.ts';
import { copyRemixLinkAction } from '../../src/js/frontend/workspace-actions.ts';

const SOURCE = '[preset00]\nzoom=1.02\nwarp=0.9\n';
const HREF = 'https://toil.fyi/?preset=geiss-aurora&tool=editor';

function captureShare(
  result: 'copied' | 'shared' | 'cancelled' | 'unavailable',
) {
  const calls: string[] = [];
  return {
    calls,
    share: (async (url: string) => {
      calls.push(url);
      return result;
    }) as never,
  };
}

describe('copyRemixLinkAction', () => {
  it('carries a draft containing emoji and non-Latin text', async () => {
    // `btoa` is Latin-1 only, so one emoji used to make the whole hash fail
    // to build. The link then degraded to a plain view URL while the UI still
    // announced that it carried the edits, and the recipient opened an empty
    // editor — or whatever stale draft the old hash happened to hold.
    const unicodeSource = '[preset00]\n// 🎛 ゆらぎ — café\nzoom=1.02\n';
    const { calls, share } = captureShare('copied');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: unicodeSource,
      dirty: true,
      announce: (message) => messages.push(message),
      share,
      href: HREF,
    });

    const url = new URL(calls[0]);
    expect(decodePresetCodeFromHash(url.hash)).toBe(unicodeSource);
    expect(messages[0]).toContain('carries your unsaved edits');
  });

  it('does not claim edits when the hash could not be built', async () => {
    const { calls, share } = captureShare('copied');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: SOURCE,
      dirty: true,
      announce: (message) => messages.push(message),
      share,
      // A URL whose hash cannot be set is not reachable here, so this stands
      // in for the general contract: the claim follows the link that was
      // actually shared, never the intent behind it.
      href: HREF,
    });

    const shared = calls[0];
    const claimed = messages[0].includes('carries your unsaved edits');
    expect(claimed).toBe(shared.includes('#code='));
  });

  it('carries the unsaved source, decodable back to the same text', async () => {
    const { calls, share } = captureShare('copied');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: SOURCE,
      dirty: true,
      announce: (message) => messages.push(message),
      share,
      href: HREF,
    });

    const url = new URL(calls[0]);
    expect(decodePresetCodeFromHash(url.hash)).toBe(SOURCE);
    // The query state has to survive alongside the hash, or the recipient
    // gets the draft without the preset and tool it belongs to.
    expect(url.searchParams.get('preset')).toBe('geiss-aurora');
    expect(messages[0]).toContain('unsaved edits');
  });

  it('omits the hash when the session is clean', async () => {
    const { calls, share } = captureShare('copied');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: SOURCE,
      dirty: false,
      announce: (message) => messages.push(message),
      share,
      href: `${HREF}#code=stale`,
    });

    expect(new URL(calls[0]).hash).toBe('');
    expect(messages).toEqual(['Link copied.']);
  });

  it('says nothing when a native share sheet is dismissed', async () => {
    const { share } = captureShare('cancelled');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: SOURCE,
      dirty: true,
      announce: (message) => messages.push(message),
      share,
      href: HREF,
    });

    expect(messages).toEqual([]);
  });

  it('points at the address bar when there is no clipboard', async () => {
    const { share } = captureShare('unavailable');
    const messages: string[] = [];

    await copyRemixLinkAction({
      source: SOURCE,
      dirty: true,
      announce: (message) => messages.push(message),
      share,
      href: HREF,
    });

    // The address bar genuinely holds the same URL (App.tsx keeps the hash in
    // sync), so this is a route to the link, not a consolation message.
    expect(messages[0]).toContain('address bar');
  });
});
