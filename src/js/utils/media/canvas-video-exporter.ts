/**
 * Records a live visualizer canvas through a preset-sized mirror canvas.
 *
 * The source canvas is never resized or stopped: each animation frame is
 * copied with a cover crop into the recording surface while the renderer
 * continues its normal frame loop.
 */

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
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
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
  private mediaRecorder: MediaRecorder | null = null;
  private recordingStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private recordingFrame: number | null = null;
  private isRecording = false;

  constructor(
    canvas: HTMLCanvasElement,
    environment: CanvasVideoExporterEnvironment = createBrowserEnvironment(),
  ) {
    this.canvas = canvas;
    this.environment = environment;
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
    const preset = EXPORT_PRESETS[options.preset ?? 'hd-landscape'];
    const outputCanvas = this.environment.createCanvas();
    outputCanvas.width = preset.width;
    outputCanvas.height = preset.height;
    const context = outputCanvas.getContext('2d', { alpha: false });
    if (!context || typeof outputCanvas.captureStream !== 'function') {
      return {
        ok: false,
        reason: 'Canvas recording is not supported by this browser.',
      };
    }

    try {
      const stream = outputCanvas.captureStream(fps);
      const recorder = this.environment.createMediaRecorder(stream, {
        mimeType: support.mimeType,
        videoBitsPerSecond: options.videoBitsPerSecond ?? 12_000_000,
      });
      this.recordedChunks = [];
      this.recordingStream = stream;
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
        context.drawImage(
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
      drawFrame();
      return { ok: true, mimeType: support.mimeType };
    } catch (error) {
      this.isRecording = false;
      stopStream(this.recordingStream);
      this.recordingStream = null;
      this.mediaRecorder = null;
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
        resolve(blob);
      };
      recorder.stop();
    });
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
