import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
} from 'three';
import { isMobileDevice } from '../../utils/device-detect.ts';

type CaptureDrawSurface = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

type VideoFrameCallbackVideo = HTMLVideoElement & {
  cancelVideoFrameCallback?: (handle: number) => void;
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp) => void,
  ) => number;
};

const MIN_CAPTURE_SIZE = 64;
const DESKTOP_MAX_CAPTURE_WIDTH = 960;
const DESKTOP_MAX_CAPTURE_HEIGHT = 540;
const MOBILE_MAX_CAPTURE_WIDTH = 640;
const MOBILE_MAX_CAPTURE_HEIGHT = 360;
const DESKTOP_FALLBACK_CAPTURE_FPS = 60;
const MOBILE_FALLBACK_CAPTURE_FPS = 24;

export function resolveCapturedVideoLimits(isMobile = isMobileDevice()) {
  return isMobile
    ? {
        maxWidth: MOBILE_MAX_CAPTURE_WIDTH,
        maxHeight: MOBILE_MAX_CAPTURE_HEIGHT,
        fallbackFrameIntervalMs: 1000 / MOBILE_FALLBACK_CAPTURE_FPS,
      }
    : {
        maxWidth: DESKTOP_MAX_CAPTURE_WIDTH,
        maxHeight: DESKTOP_MAX_CAPTURE_HEIGHT,
        fallbackFrameIntervalMs: 1000 / DESKTOP_FALLBACK_CAPTURE_FPS,
      };
}

let activeStream: MediaStream | null = null;
let captureReady = false;
let captureVideo: HTMLVideoElement | null = null;
let captureSurface: CaptureDrawSurface | null = null;
let captureTexture: Texture | null = null;

let cachedViewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
let cachedViewportHeight =
  typeof window !== 'undefined' ? window.innerHeight : 0;

function updateViewportCache() {
  if (typeof window === 'undefined') return;
  cachedViewportWidth = window.innerWidth;
  cachedViewportHeight = window.innerHeight;
}

let viewportResizeListenerAttached = false;
function ensureViewportCacheListener() {
  if (viewportResizeListenerAttached || typeof window === 'undefined') return;
  viewportResizeListenerAttached = true;
  window.addEventListener('resize', updateViewportCache, { passive: true });
}
let captureCropTarget: Element | null = null;
let captureFrameId: number | null = null;
let captureVideoFrameId: number | null = null;
let activeTrackCleanup: (() => void) | null = null;

function configureTexture<T extends Texture>(
  texture: T,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace = SRGBColorSpace,
) {
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = colorSpace;
  return texture;
}

function ensureCaptureVideo() {
  if (captureVideo || typeof document === 'undefined') {
    return captureVideo;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  captureVideo = video;
  return captureVideo;
}

function ensureCaptureSurface() {
  if (captureSurface || typeof document === 'undefined') {
    return captureSurface;
  }

  const canvas = document.createElement('canvas');
  const limits = resolveCapturedVideoLimits();
  canvas.width = limits.maxWidth;
  canvas.height = limits.maxHeight;
  const context = canvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  });
  if (!context) {
    return null;
  }

  captureSurface = { canvas, context };
  return captureSurface;
}

function ensureCaptureTexture() {
  if (captureTexture) {
    return captureTexture;
  }

  const surface = ensureCaptureSurface();
  if (surface) {
    captureTexture = configureTexture(new CanvasTexture(surface.canvas));
    return captureTexture;
  }

  captureTexture = configureTexture(new Texture(), NoColorSpace);
  return captureTexture;
}

function stopCaptureLoop() {
  if (captureFrameId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(captureFrameId);
  }
  captureFrameId = null;

  const video = captureVideo as VideoFrameCallbackVideo | null;
  if (
    captureVideoFrameId !== null &&
    video &&
    typeof video.cancelVideoFrameCallback === 'function'
  ) {
    video.cancelVideoFrameCallback(captureVideoFrameId);
  }
  captureVideoFrameId = null;
}

function resolveViewportRect(target: Element | null) {
  if (
    !target ||
    typeof window === 'undefined' ||
    typeof target.getBoundingClientRect !== 'function'
  ) {
    return null;
  }

  ensureViewportCacheListener();
  const rect = target.getBoundingClientRect();
  const viewportWidth = Math.max(1, cachedViewportWidth || rect.width || 1);
  const viewportHeight = Math.max(1, cachedViewportHeight || rect.height || 1);
  const left = Math.max(0, Math.min(viewportWidth, rect.left));
  const top = Math.max(0, Math.min(viewportHeight, rect.top));
  const right = Math.max(left, Math.min(viewportWidth, rect.right));
  const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom));
  const width = right - left;
  const height = bottom - top;

  if (width < 8 || height < 8) {
    return null;
  }

  return { left, top, width, height };
}

function resolveSourceRect(video: HTMLVideoElement) {
  const viewportRect = resolveViewportRect(captureCropTarget);
  const sourceWidth = Math.max(1, video.videoWidth || 1);
  const sourceHeight = Math.max(1, video.videoHeight || 1);

  if (!viewportRect || typeof window === 'undefined') {
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
    };
  }

  const scaleX = sourceWidth / Math.max(1, cachedViewportWidth || 1);
  const scaleY = sourceHeight / Math.max(1, cachedViewportHeight || 1);
  const sx = Math.max(0, Math.round(viewportRect.left * scaleX));
  const sy = Math.max(0, Math.round(viewportRect.top * scaleY));
  const remainingWidth = Math.max(1, sourceWidth - sx);
  const remainingHeight = Math.max(1, sourceHeight - sy);
  return {
    sx,
    sy,
    sw: Math.min(
      remainingWidth,
      Math.max(MIN_CAPTURE_SIZE, Math.round(viewportRect.width * scaleX)),
    ),
    sh: Math.min(
      remainingHeight,
      Math.max(MIN_CAPTURE_SIZE, Math.round(viewportRect.height * scaleY)),
    ),
  };
}

function resizeCaptureSurface(width: number, height: number) {
  const surface = ensureCaptureSurface();
  if (!surface) {
    return null;
  }

  const scale = Math.min(
    1,
    resolveCapturedVideoLimits().maxWidth / Math.max(1, width),
    resolveCapturedVideoLimits().maxHeight / Math.max(1, height),
  );
  const nextWidth = Math.max(MIN_CAPTURE_SIZE, Math.round(width * scale));
  const nextHeight = Math.max(MIN_CAPTURE_SIZE, Math.round(height * scale));
  if (
    surface.canvas.width !== nextWidth ||
    surface.canvas.height !== nextHeight
  ) {
    surface.canvas.width = nextWidth;
    surface.canvas.height = nextHeight;
  }

  return surface;
}

function drawCaptureFrame() {
  const video = captureVideo;
  if (!video || video.readyState < 2) {
    captureReady = false;
    return;
  }

  const { sx, sy, sw, sh } = resolveSourceRect(video);
  const surface = resizeCaptureSurface(sw, sh);
  if (!surface) {
    captureReady = false;
    return;
  }

  const { canvas, context } = surface;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const texture = ensureCaptureTexture();
  texture.needsUpdate = true;
  captureReady = true;
}

function startCaptureLoop() {
  stopCaptureLoop();
  const video = captureVideo as VideoFrameCallbackVideo | null;
  if (video && typeof video.requestVideoFrameCallback === 'function') {
    const step = () => {
      drawCaptureFrame();
      if (!activeStream || captureVideo !== video) {
        captureVideoFrameId = null;
        return;
      }
      captureVideoFrameId =
        video.requestVideoFrameCallback?.(() => step()) ?? null;
    };

    captureVideoFrameId = video.requestVideoFrameCallback(() => step());
    return;
  }

  if (typeof requestAnimationFrame !== 'function') {
    return;
  }

  const limits = resolveCapturedVideoLimits();
  let lastDrawAt = -Infinity;
  const step = (now: number) => {
    if (now - lastDrawAt >= limits.fallbackFrameIntervalMs) {
      drawCaptureFrame();
      lastDrawAt = now;
    }
    captureFrameId = requestAnimationFrame(step);
  };

  captureFrameId = requestAnimationFrame(step);
}

function resetTrackCleanup() {
  activeTrackCleanup?.();
  activeTrackCleanup = null;
}

function bindTrackCleanup(stream: MediaStream) {
  resetTrackCleanup();
  const handleEnded = () => {
    if (activeStream !== stream) {
      return;
    }
    clearMilkdropCapturedVideoStream();
  };
  const videoTracks = stream.getVideoTracks();
  videoTracks.forEach((track) => {
    track.addEventListener('ended', handleEnded);
  });
  activeTrackCleanup = () => {
    videoTracks.forEach((track) => {
      track.removeEventListener('ended', handleEnded);
    });
  };
}

async function waitForCaptureReady(video: HTMLVideoElement) {
  if (video.readyState >= 2) {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('playing', handleReady);
    };
    video.addEventListener('loadeddata', handleReady, { once: true });
    video.addEventListener('canplay', handleReady, { once: true });
    video.addEventListener('playing', handleReady, { once: true });
  });
}

export function getSharedMilkdropCapturedVideoTexture() {
  return ensureCaptureTexture();
}

export function getMilkdropCapturedVideoCanvas() {
  return ensureCaptureSurface()?.canvas ?? null;
}

export function hasActiveMilkdropCapturedVideoStream() {
  return Boolean(activeStream?.getVideoTracks().length);
}

export function isMilkdropCapturedVideoReady() {
  return captureReady && hasActiveMilkdropCapturedVideoStream();
}

export function setMilkdropCapturedVideoCropTarget(target: Element | null) {
  captureCropTarget = target;
}

export async function setMilkdropCapturedVideoStream(
  stream: MediaStream | null,
  { cropTarget = null }: { cropTarget?: Element | null } = {},
) {
  captureCropTarget = cropTarget;
  activeStream = stream;
  captureReady = false;

  const texture = ensureCaptureTexture();
  texture.needsUpdate = true;

  if (!stream || stream.getVideoTracks().length === 0) {
    clearMilkdropCapturedVideoStream();
    return false;
  }

  const video = ensureCaptureVideo();
  if (!video) {
    return false;
  }

  bindTrackCleanup(stream);
  video.srcObject = stream;

  try {
    const playPromise = video.play().catch(() => {});
    await Promise.race([
      waitForCaptureReady(video),
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
    ]);
    await playPromise;
  } catch (_error) {
    // Keep the loop alive; some browsers resolve readiness only after play starts.
  }

  startCaptureLoop();
  drawCaptureFrame();
  return true;
}

export function clearMilkdropCapturedVideoStream() {
  activeStream = null;
  captureReady = false;
  captureCropTarget = null;
  resetTrackCleanup();
  stopCaptureLoop();

  if (captureVideo) {
    captureVideo.pause();
    captureVideo.srcObject = null;
  }

  const surface = ensureCaptureSurface();
  if (surface) {
    surface.context.clearRect(
      0,
      0,
      surface.canvas.width,
      surface.canvas.height,
    );
  }

  const texture = ensureCaptureTexture();
  texture.needsUpdate = true;
}

export const __milkdropCapturedVideoTextureTestUtils = {
  resolveViewportRect,
  resolveSourceRect,
  resolveCapturedVideoLimits,
};
