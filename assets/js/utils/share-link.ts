type ShareNavigator = Navigator & {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  clipboard?: Clipboard;
};

export type ShareLinkResult = 'shared' | 'copied' | 'cancelled' | 'unavailable';

function canUseNativeShare(url: string, nav: ShareNavigator) {
  if (typeof nav.share !== 'function') {
    return false;
  }

  if (typeof nav.canShare === 'function') {
    try {
      return nav.canShare({ url });
    } catch (_error) {
      return false;
    }
  }

  return true;
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'NotAllowedError')
  );
}

function tryLegacyCopy(url: string, doc: Document) {
  if (typeof doc.execCommand !== 'function') {
    return false;
  }

  const helper = doc.createElement('textarea');
  helper.value = url;
  helper.setAttribute('readonly', 'true');
  helper.style.position = 'fixed';
  helper.style.top = '-1000px';
  doc.body.appendChild(helper);
  helper.select();
  const copied = doc.execCommand('copy');
  helper.remove();
  return copied;
}

export async function shareOrCopyLink(
  url: string,
  {
    doc = document,
    navigator: nav = navigator as ShareNavigator,
    title,
    text,
  }: {
    doc?: Document;
    navigator?: ShareNavigator;
    title?: string;
    text?: string;
  } = {},
): Promise<ShareLinkResult> {
  if (canUseNativeShare(url, nav)) {
    try {
      await nav.share?.({ title, text, url });
      return 'shared';
    } catch (error) {
      if (isAbortLikeError(error)) {
        return 'cancelled';
      }
    }
  }

  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(url);
      return 'copied';
    }
  } catch (_error) {
    // Fall through to legacy copy.
  }

  try {
    if (tryLegacyCopy(url, doc)) {
      return 'copied';
    }
  } catch (_error) {
    // Fall through to unavailable.
  }

  return 'unavailable';
}
