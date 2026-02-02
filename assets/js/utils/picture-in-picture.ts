let activeVideo: HTMLVideoElement | null = null;
let activeStream: MediaStream | null = null;
let activeCanvas: HTMLCanvasElement | null = null;

export function isPictureInPictureSupported(doc: Document) {
  const hasVideoApi =
    typeof HTMLVideoElement !== 'undefined' &&
    'requestPictureInPicture' in HTMLVideoElement.prototype;
  const hasCanvasStream =
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  return Boolean(doc.pictureInPictureEnabled && hasVideoApi && hasCanvasStream);
}

export function isToyPictureInPictureActive(doc: Document) {
  return Boolean(doc.pictureInPictureElement);
}

export function getActiveToyCanvas(doc: Document) {
  return (
    doc.querySelector<HTMLCanvasElement>('#active-toy-container canvas') ??
    doc.querySelector<HTMLCanvasElement>('.toy-canvas')
  );
}

function ensureVideoElement(doc: Document) {
  if (activeVideo && activeVideo.ownerDocument === doc) {
    return activeVideo;
  }

  const video = doc.createElement('video');
  video.className = 'pip-video-helper';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  doc.body.appendChild(video);
  activeVideo = video;
  return video;
}

function updateStream(canvas: HTMLCanvasElement) {
  if (activeCanvas === canvas && activeStream) {
    return activeStream;
  }

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
  }

  activeStream = canvas.captureStream();
  activeCanvas = canvas;
  return activeStream;
}

export function getToyPictureInPictureVideo(doc: Document) {
  return ensureVideoElement(doc);
}

export async function requestToyPictureInPicture(doc: Document) {
  const canvas = getActiveToyCanvas(doc);
  if (!canvas) {
    throw new Error('No active toy canvas available.');
  }

  const video = ensureVideoElement(doc);
  const stream = updateStream(canvas);
  video.srcObject = stream;

  const playPromise = video.play();
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await playPromise;
  } else {
    void playPromise.catch(() => undefined);
  }

  return video.requestPictureInPicture();
}

export async function exitToyPictureInPicture(doc: Document) {
  if (!doc.pictureInPictureElement) return;
  await doc.exitPictureInPicture();
}

export function resetToyPictureInPicture(doc: Document) {
  if (doc.pictureInPictureElement) {
    void doc.exitPictureInPicture();
  }

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }

  if (activeVideo) {
    activeVideo.remove();
    activeVideo = null;
  }

  activeCanvas = null;
}
