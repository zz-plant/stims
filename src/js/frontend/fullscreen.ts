type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenHostElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
] as const;

export function getFullscreenElement(doc: Document = document): Element | null {
  const fullscreenDocument = doc as FullscreenDocument;
  return (
    fullscreenDocument.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    null
  );
}

export function subscribeToFullscreenChange(
  listener: () => void,
  doc: Document = document,
) {
  FULLSCREEN_CHANGE_EVENTS.forEach((eventName) => {
    doc.addEventListener(eventName, listener);
  });

  return () => {
    FULLSCREEN_CHANGE_EVENTS.forEach((eventName) => {
      doc.removeEventListener(eventName, listener);
    });
  };
}

export async function toggleElementFullscreen(
  element: HTMLElement,
  doc: Document = document,
) {
  const fullscreenDocument = doc as FullscreenDocument;
  const fullscreenElement = element as FullscreenHostElement;

  if (getFullscreenElement(doc)) {
    if (typeof fullscreenDocument.exitFullscreen === 'function') {
      await fullscreenDocument.exitFullscreen();
      return true;
    }

    if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
      await fullscreenDocument.webkitExitFullscreen();
      return true;
    }

    return false;
  }

  if (typeof fullscreenElement.requestFullscreen === 'function') {
    await fullscreenElement.requestFullscreen();
    return true;
  }

  if (typeof fullscreenElement.webkitRequestFullscreen === 'function') {
    await fullscreenElement.webkitRequestFullscreen();
    return true;
  }

  return false;
}
