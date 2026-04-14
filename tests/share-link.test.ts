import { afterEach, describe, expect, test } from 'bun:test';
import {
  type ShareLinkResult,
  shareOrCopyLink,
} from '../assets/js/utils/share-link.ts';
import { replaceProperty } from './test-helpers.ts';

const restores: Array<() => void> = [];

function trackRestore(restore: () => void) {
  restores.push(restore);
}

afterEach(() => {
  while (restores.length > 0) {
    restores.pop()?.();
  }
});

function createNavigatorStub() {
  return {} as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
    clipboard?: Clipboard;
  };
}

async function expectShareResult(
  setup: (nav: ReturnType<typeof createNavigatorStub>) => void,
) {
  const nav = createNavigatorStub();
  setup(nav);
  return shareOrCopyLink('https://toil.fyi/?preset=signal-bloom', {
    doc: document,
    navigator: nav,
    title: 'Stims visualizer',
    text: 'Open this Stims visualizer view.',
  });
}

describe('share link helper', () => {
  test('prefers the native share sheet when available', async () => {
    let shared: ShareData | undefined;

    const result = await expectShareResult((nav) => {
      nav.canShare = () => true;
      nav.share = async (data) => {
        shared = data;
      };
    });

    expect(result).toBe<ShareLinkResult>('shared');
    expect(shared).toEqual({
      title: 'Stims visualizer',
      text: 'Open this Stims visualizer view.',
      url: 'https://toil.fyi/?preset=signal-bloom',
    });
  });

  test('treats cancelled native shares as a neutral result', async () => {
    const result = await expectShareResult((nav) => {
      nav.canShare = () => true;
      nav.share = async () => {
        throw new DOMException('cancelled', 'AbortError');
      };
    });

    expect(result).toBe<ShareLinkResult>('cancelled');
  });

  test('falls back to clipboard copy when share is unavailable', async () => {
    let copied = '';

    const result = await expectShareResult((nav) => {
      nav.clipboard = {
        writeText: async (value: string) => {
          copied = value;
        },
      } as Clipboard;
    });

    expect(result).toBe<ShareLinkResult>('copied');
    expect(copied).toBe('https://toil.fyi/?preset=signal-bloom');
  });

  test('falls back to legacy execCommand copy when clipboard is unavailable', async () => {
    let copied = false;
    trackRestore(
      replaceProperty(document, 'execCommand', (command: string) => {
        copied = command === 'copy';
        return copied;
      }),
    );

    const result = await expectShareResult((_nav) => {});

    expect(result).toBe<ShareLinkResult>('copied');
    expect(copied).toBe(true);
  });

  test('returns unavailable when share and copy paths are missing', async () => {
    trackRestore(replaceProperty(document, 'execCommand', undefined));

    const result = await expectShareResult((_nav) => {});

    expect(result).toBe<ShareLinkResult>('unavailable');
  });
});
