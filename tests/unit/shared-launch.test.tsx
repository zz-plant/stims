import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSharedLaunch } from '../../src/js/frontend/hooks/use-shared-launch.ts';

/**
 * What the page does with a payload the service worker has already accepted.
 *
 * The worker deliberately does not parse a shared link — it is unbundled
 * JavaScript that cannot import the app's YouTube parser, so it hands the raw
 * text over rather than growing a second copy of that regex. Which means the
 * decision of what a share *is* happens here, and is what these cover.
 */

type Deps = Parameters<typeof useSharedLaunch>[0];

function Harness(props: Deps) {
  useSharedLaunch(props);
  return null;
}

describe('shared launch', () => {
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  const restore: Array<() => void> = [];

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    host = null;
    root = null;
    for (const undo of restore.splice(0)) undo();
  });

  /** happy-dom's location is read-only; swap in a recording stand-in. */
  function stubLocation(href: string) {
    const replaced: string[] = [];
    const prior = Object.getOwnPropertyDescriptor(window, 'location');
    const url = new URL(href);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: url.href,
        search: url.search,
        pathname: url.pathname,
        hash: url.hash,
        origin: url.origin,
        replace: (next: string) => replaced.push(next),
      },
    });
    restore.push(() => {
      if (prior) Object.defineProperty(window, 'location', prior);
    });
    return replaced;
  }

  function stubFetch(handler: (input: string) => Response | null) {
    const prior = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: async (input: unknown) => {
        const hit = handler(String(input));
        return hit ?? new Response(null, { status: 404 });
      },
    });
    restore.push(() => {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: prior,
      });
    });
  }

  function render(over: Partial<Deps> = {}) {
    const messages: Array<string | null> = [];
    const started: string[] = [];
    const props = {
      routeState: { audioSource: null } as Deps['routeState'],
      commitRoute: () => {},
      startAudioSource: async (request: { source: string }) => {
        started.push(request.source);
      },
      setStatusMessage: (message: string | null) => messages.push(message),
      ...over,
    } as Deps;
    (
      globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<Harness {...props} />);
    });
    return { messages, started };
  }

  test('sends a shared YouTube link back in through the app deep link', () => {
    const replaced = stubLocation(
      'https://toil.fyi/?share=link&u=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D42',
    );
    render();

    expect(replaced).toHaveLength(1);
    const target = new URL(replaced[0]);
    expect(target.searchParams.get('audio')).toBe('youtube');
    expect(target.searchParams.get('yt')).toBe('dQw4w9WgXcQ');
    expect(target.searchParams.get('t')).toBe('42');
    // The share markers must not survive into the link it hands back, or the
    // next load would try to consume the same share again.
    expect(target.searchParams.has('share')).toBe(false);
    expect(target.searchParams.has('u')).toBe(false);
  });

  test('says so when a shared link is nothing it can play', () => {
    const replaced = stubLocation(
      'https://toil.fyi/?share=link&u=https%3A%2F%2Fexample.com%2Fnope',
    );
    const { messages } = render();

    expect(replaced).toHaveLength(0);
    expect(messages[0]).toContain('not something Stims can play');
  });

  test('collects a shared file from the key the worker stashes it under', async () => {
    // Playing it needs a real <audio> and AudioContext, so the end of that
    // path is covered in a browser rather than here. What this pins is the
    // contract that can silently drift: `public/service-worker.js` is
    // unbundled, so nothing but agreement on this path connects the two
    // halves, and a rename on either side would fail closed and silently.
    stubLocation('https://toil.fyi/?share=audio');
    const requested: string[] = [];
    stubFetch((input) => {
      requested.push(input);
      return null;
    });
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(requested).toEqual(['/__stims-shared-audio']);
  });

  test('says so when the stash is empty', async () => {
    stubLocation('https://toil.fyi/?share=audio');
    stubFetch(() => null);
    const { messages, started } = render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(started).toEqual([]);
    expect(messages.some((m) => m?.includes('could not be read'))).toBe(true);
  });

  test('does nothing on an ordinary load', () => {
    const replaced = stubLocation('https://toil.fyi/?preset=geiss-bipolar-x');
    const { messages, started } = render();

    expect(replaced).toEqual([]);
    expect(messages).toEqual([]);
    expect(started).toEqual([]);
  });
});
