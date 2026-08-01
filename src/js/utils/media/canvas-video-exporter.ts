/** Records a live visualizer canvas, including native renderer capture at 4K. */

export type ExportPresetTarget =
  | 'spotify-canvas'
  | 'tiktok-shorts'
  | 'youtube-shorts'
  | 'hd-landscape'
  | '4k-landscape'
  | 'custom';

export interface CanvasVideoExporterOptions {
  preset?: ExportPresetTarget;
  mimeType?: string;
  videoBitsPerSecond?: number;
  fps?: number;
}

export interface PresetDimensions {
  width: number;
  height: number;
  label: string;
  aspectRatio: string;
}

export interface CanvasVideoExporterEnvironment {
  mediaRecorderAvailable: boolean;
  isMimeTypeSupported(mimeType: string): boolean;
  createCanvas(): HTMLCanvasElement;
  createMediaRecorder(
    stream: MediaStream,
    options: MediaRecorderOptions,
  ): MediaRecorder;
  createMediaStream(tracks: MediaStreamTrack[]): MediaStream;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export type NativeCanvasCaptureStartResult =
  | { ok: true; restore(): void }
  | { ok: false; reason: string };

export interface CanvasVideoExportRuntime {
  beginNativeCapture(dimensions: {
    width: number;
    height: number;
  }): NativeCanvasCaptureStartResult;
  getAudioStream(): MediaStream | null;
}

export type CanvasVideoExporterSupport =
  | { supported: true; mimeType: string; reason: null }
  | { supported: false; mimeType: null; reason: string };

export type CanvasRecordingStartResult =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

export const EXPORT_PRESETS: Record<ExportPresetTarget, PresetDimensions> = {
  'spotify-canvas': {
    width: 1080,
    height: 1920,
    label: 'Spotify Canvas (9:16 Vertical)',
    aspectRatio: '9:16',
  },
  'tiktok-shorts': {
    width: 1080,
    height: 1920,
    label: 'TikTok Video (9:16 60FPS)',
    aspectRatio: '9:16',
  },
  'youtube-shorts': {
    width: 1080,
    height: 1920,
    label: 'YouTube Shorts (9:16 60FPS)',
    aspectRatio: '9:16',
  },
  'hd-landscape': {
    width: 1920,
    height: 1080,
    label: 'Full HD Landscape (16:9)',
    aspectRatio: '16:9',
  },
  '4k-landscape': {
    width: 3840,
    height: 2160,
    label: 'Ultra HD 4K (16:9)',
    aspectRatio: '16:9',
  },
  custom: {
    width: 1280,
    height: 720,
    label: 'Custom Viewport',
    aspectRatio: 'custom',
  },
};

const MIME_TYPE_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const;

function createBrowserEnvironment(): CanvasVideoExporterEnvironment {
  return {
    mediaRecorderAvailable: typeof MediaRecorder !== 'undefined',
    isMimeTypeSupported: (mimeType) =>
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(mimeType),
    createCanvas: () => document.createElement('canvas'),
    createMediaRecorder: (stream, options) =>
      new MediaRecorder(stream, options),
    createMediaStream: (tracks) => new MediaStream(tracks),
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => cancelAnimationFrame(handle),
  };
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export class CanvasVideoExporter {
  private readonly canvas: HTMLCanvasElement;
  private readonly environment: CanvasVideoExporterEnvironment;
  private readonly runtime: CanvasVideoExportRuntime | null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private recordingFrame: number | null = null;
  private restoreNativeCapture: (() => void) | null = null;
  private isRecording = false;

  constructor(
    canvas: HTMLCanvasElement,
    environment: CanvasVideoExporterEnvironment = createBrowserEnvironment(),
    runtime: CanvasVideoExportRuntime | null = null,
  ) {
    this.canvas = canvas;
    this.environment = environment;
    this.runtime = runtime;
  }

  static getSupportedMimeTypes(): string[] {
    const environment = createBrowserEnvironment();
    if (!environment.mediaRecorderAvailable) return [];
    return MIME_TYPE_CANDIDATES.filter((mimeType) =>
      environment.isMimeTypeSupported(mimeType),
    );
  }

  getSupport(requestedMimeType?: string): CanvasVideoExporterSupport {
    if (!this.environment.mediaRecorderAvailable) {
      return {
        supported: false,
        mimeType: null,
        reason: 'Video recording is not supported by this browser.',
      };
    }
    if (typeof this.canvas.captureStream !== 'function') {
      return {
        supported: false,
        mimeType: null,
        reason: 'Canvas recording is not supported by this browser.',
      };
    }
    const mimeType = requestedMimeType
      ? this.environment.isMimeTypeSupported(requestedMimeType)
        ? requestedMimeType
        : null
      : (MIME_TYPE_CANDIDATES.find((candidate) =>
          this.environment.isMimeTypeSupported(candidate),
        ) ?? null);
    if (!mimeType) {
      return {
        supported: false,
        mimeType: null,
        reason: 'This browser does not provide a supported video format.',
      };
    }
    return { supported: true, mimeType, reason: null };
  }

  startRecording(
    options: CanvasVideoExporterOptions = {},
  ): CanvasRecordingStartResult {
    if (this.isRecording) {
      return { ok: false, reason: 'A recording is already in progress.' };
    }
    const support = this.getSupport(options.mimeType);
    if (!support.supported) {
      return { ok: false, reason: support.reason };
    }

    const fps = options.fps ?? 60;
    const presetId = options.preset ?? 'hd-landscape';
    const preset = EXPORT_PRESETS[presetId];
    const nativeCapture = presetId === '4k-landscape';
    let outputCanvas: HTMLCanvasElement;
    let context: CanvasRenderingContext2D | null = null;

    if (nativeCapture) {
      if (!this.runtime) {
        return {
          ok: false,
          reason:
            'Native 4K export is unavailable because the visualizer renderer is not ready.',
        };
      }
      const result = this.runtime.beginNativeCapture({
        width: preset.width,
        height: preset.height,
      });
      if (!result.ok) {
        return result;
      }
      this.restoreNativeCapture = result.restore;
      outputCanvas = this.canvas;
    } else {
      outputCanvas = this.environment.createCanvas();
      outputCanvas.width = preset.width;
      outputCanvas.height = preset.height;
      context = outputCanvas.getContext('2d', { alpha: false });
    }

    if (
      (!nativeCapture && !context) ||
      typeof outputCanvas.captureStream !== 'function'
    ) {
      this.restoreNativeRenderer();
      return {
        ok: false,
        reason: 'Canvas recording is not supported by this browser.',
      };
    }

    let unownedAudioTracks: MediaStreamTrack[] = [];
    try {
      const videoStream = outputCanvas.captureStream(fps);
      const audioTracks =
        this.runtime
          ?.getAudioStream()
          ?.getAudioTracks()
          .map((track) => track.clone()) ?? [];
      unownedAudioTracks = audioTracks;
      const stream =
        audioTracks.length > 0
          ? this.environment.createMediaStream([
              ...videoStream.getVideoTracks(),
              ...audioTracks,
            ])
          : videoStream;
      this.recordingStream = stream;
      unownedAudioTracks = [];
      const recorder = this.environment.createMediaRecorder(stream, {
        mimeType: support.mimeType,
        videoBitsPerSecond: options.videoBitsPerSecond ?? 12_000_000,
      });
      this.recordedChunks = [];
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data?.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };
      recorder.start(100);
      this.isRecording = true;

      const drawFrame = () => {
        if (!this.isRecording) return;
        const sourceWidth = Math.max(1, this.canvas.width);
        const sourceHeight = Math.max(1, this.canvas.height);
        const scale = Math.max(
          preset.width / sourceWidth,
          preset.height / sourceHeight,
        );
        const cropWidth = preset.width / scale;
        const cropHeight = preset.height / scale;
        const cropX = (sourceWidth - cropWidth) / 2;
        const cropY = (sourceHeight - cropHeight) / 2;
        context?.drawImage(
          this.canvas,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          preset.width,
          preset.height,
        );
        this.recordingFrame = this.environment.requestAnimationFrame(drawFrame);
      };
      if (!nativeCapture) {
        drawFrame();
      }
      return { ok: true, mimeType: support.mimeType };
    } catch (error) {
      this.isRecording = false;
      unownedAudioTracks.forEach((track) => track.stop());
      stopStream(this.recordingStream);
      this.recordingStream = null;
      this.mediaRecorder = null;
      this.restoreNativeRenderer();
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : 'The browser could not start recording.',
      };
    }
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this.isRecording || !this.mediaRecorder) return null;
    this.isRecording = false;
    if (this.recordingFrame !== null) {
      this.environment.cancelAnimationFrame(this.recordingFrame);
      this.recordingFrame = null;
    }

    const recorder = this.mediaRecorder;
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const blob =
          this.recordedChunks.length > 0
            ? new Blob(this.recordedChunks, { type: mimeType })
            : null;
        stopStream(this.recordingStream);
        this.recordingStream = null;
        this.mediaRecorder = null;
        this.restoreNativeRenderer();
        resolve(blob);
      };
      try {
        recorder.stop();
      } catch {
        stopStream(this.recordingStream);
        this.recordingStream = null;
        this.mediaRecorder = null;
        this.restoreNativeRenderer();
        resolve(null);
      }
    });
  }

  private restoreNativeRenderer() {
    const restore = this.restoreNativeCapture;
    this.restoreNativeCapture = null;
    restore?.();
  }

  downloadVideo(blob: Blob, filename = 'stims-visualizer-export.webm'): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 100);
  }

  getRecordingStatus(): boolean {
    return this.isRecording;
  }
}
