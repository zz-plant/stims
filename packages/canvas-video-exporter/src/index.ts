/**
 * Records a canvas to video with `MediaRecorder`, at output presets.
 *
 * Three ways the frames reach the encoder, chosen per recording:
 *
 * - **Native.** For the 4K, 9:16 and 1:1 presets, when a
 *   `CanvasVideoExportRuntime` is given, the host renderer is asked to draw
 *   at the preset's size for the duration (`beginNativeCapture`) and the
 *   source canvas itself is captured. A 4K export is only ever native: a
 *   Full HD canvas scaled up is not 4K.
 * - **Copied.** For any other preset, or without a runtime, a copy of the
 *   source cropped to fill the preset's size is painted every frame
 *   (`createCanvasFrameCopy`) and that copy is captured.
 * - **Yours.** `hooks.createFrames` replaces both: the app this was
 *   extracted from paints its copy from the render loop's own frame
 *   notification and bakes in the dimming its stage shows over the canvas.
 *
 * The runtime's audio stream, when it has one, is cloned onto the recording.
 * `hooks.onRecordingChange` reports when a recording starts and ends, for a
 * host that must keep rendering while one runs in a hidden tab.
 */
import {
  createCanvasFrameCopy,
  type FrameSubscription,
  type RecordableFrames,
} from './frame-copy.ts';

export {
  createCanvasFrameCopy,
  type FrameSubscription,
  type RecordableFrames,
  subscribeToAnimationFrames,
} from './frame-copy.ts';

export type ExportPresetTarget =
  | 'spotify-canvas'
  | 'tiktok-shorts'
  | 'youtube-shorts'
  | 'square-post'
  | 'hd-landscape'
  | '4k-landscape'
  | 'custom';

export interface CanvasVideoExporterOptions {
  preset?: ExportPresetTarget;
  mimeType?: string;
  videoBitsPerSecond?: number;
  fps?: number;
  /** Set false to record a cropped copy even where a native capture could run. */
  native?: boolean;
}

export interface PresetDimensions {
  width: number;
  height: number;
  label: string;
  aspectRatio: string;
}

/** The browser capabilities the exporter uses; replace them under test. */
export interface CanvasVideoExporterEnvironment {
  mediaRecorderAvailable: boolean;
  isMimeTypeSupported(mimeType: string): boolean;
  createCanvas(): HTMLCanvasElement;
  createMediaRecorder(
    stream: MediaStream,
    options: MediaRecorderOptions,
  ): MediaRecorder;
  createMediaStream(tracks: MediaStreamTrack[]): MediaStream;
}

export type NativeCanvasCaptureStartResult =
  | { ok: true; restore(): void }
  | { ok: false; reason: string };

/** What the host renderer can do for a recording. */
export interface CanvasVideoExportRuntime {
  /**
   * Draw at this size until `restore` is called. Return `ok: false` with a
   * reason when the backend cannot, and the recording is refused with it.
   */
  beginNativeCapture(dimensions: {
    width: number;
    height: number;
  }): NativeCanvasCaptureStartResult;
  /** Audio to record alongside the picture, or null for a silent file. */
  getAudioStream(): MediaStream | null;
}

export interface CanvasVideoExporterHooks {
  /**
   * The canvas the recording is encoded from. `size` is set for a copied
   * recording and absent for a native one, where the source is drawn at the
   * preset's size already. Return null when no copy can be made. Defaults to
   * `createCanvasFrameCopy` of the source when `size` is set, and the source
   * canvas itself otherwise.
   */
  createFrames?: (options: {
    size?: { width: number; height: number };
    createCanvas: () => HTMLCanvasElement;
  }) => RecordableFrames | null;
  /** When the default copy paints. See `createCanvasFrameCopy`. */
  subscribeToFrames?: FrameSubscription;
  /** Called with true when a recording starts and false when it ends. */
  onRecordingChange?: (active: boolean) => void;
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
    label: 'Spotify Canvas (9:16 vertical)',
    aspectRatio: '9:16',
  },
  'tiktok-shorts': {
    width: 1080,
    height: 1920,
    label: 'TikTok video (9:16, 60 fps)',
    aspectRatio: '9:16',
  },
  'youtube-shorts': {
    width: 1080,
    height: 1920,
    label: 'YouTube Shorts (9:16, 60 fps)',
    aspectRatio: '9:16',
  },
  'square-post': {
    width: 1080,
    height: 1080,
    label: 'Square post (1:1, 1080×1080)',
    aspectRatio: '1:1',
  },
  'hd-landscape': {
    width: 1920,
    height: 1080,
    label: 'Full HD landscape (16:9)',
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
    label: 'Custom viewport',
    aspectRatio: 'custom',
  },
};

/** Tried in order when no `mimeType` is requested. */
export const MIME_TYPE_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const;

export function createBrowserEnvironment(): CanvasVideoExporterEnvironment {
  return {
    mediaRecorderAvailable: typeof MediaRecorder !== 'undefined',
    isMimeTypeSupported: (mimeType) =>
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(mimeType),
    createCanvas: () => document.createElement('canvas'),
    createMediaRecorder: (stream, options) =>
      new MediaRecorder(stream, options),
    createMediaStream: (tracks) => new MediaStream(tracks),
  };
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export class CanvasVideoExporter {
  private readonly canvas: HTMLCanvasElement;
  private readonly environment: CanvasVideoExporterEnvironment;
  private readonly runtime: CanvasVideoExportRuntime | null;
  private readonly hooks: CanvasVideoExporterHooks;
  private mediaRecorder: MediaRecorder | null = null;
  private recordingStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private frames: RecordableFrames | null = null;
  private restoreNativeCapture: (() => void) | null = null;
  private isRecording = false;

  constructor(
    canvas: HTMLCanvasElement,
    environment: CanvasVideoExporterEnvironment = createBrowserEnvironment(),
    runtime: CanvasVideoExportRuntime | null = null,
    hooks: CanvasVideoExporterHooks = {},
  ) {
    this.canvas = canvas;
    this.environment = environment;
    this.runtime = runtime;
    this.hooks = hooks;
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
    const isNativeCandidate =
      presetId === '4k-landscape' ||
      preset.aspectRatio === '9:16' ||
      preset.aspectRatio === '1:1';
    const nativeCapture =
      options.native !== false && Boolean(this.runtime) && isNativeCandidate;

    if (nativeCapture) {
      if (!this.runtime) {
        return {
          ok: false,
          reason:
            'Native video export is unavailable because the renderer is not ready.',
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
    } else if (presetId === '4k-landscape') {
      return {
        ok: false,
        reason:
          'Native 4K export is unavailable because the renderer is not ready.',
      };
    }

    // A native format captures at whatever size the renderer was just given;
    // any other crops the source to fill its own frame.
    const frames = this.createFrames(
      nativeCapture
        ? undefined
        : { width: preset.width, height: preset.height },
    );
    if (!frames || typeof frames.canvas.captureStream !== 'function') {
      frames?.dispose();
      this.restoreNativeRenderer();
      return {
        ok: false,
        reason: 'Canvas recording is not supported by this browser.',
      };
    }
    this.frames = frames;

    let unownedAudioTracks: MediaStreamTrack[] = [];
    try {
      const videoStream = frames.canvas.captureStream(fps);
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
      this.hooks.onRecordingChange?.(true);
      return { ok: true, mimeType: support.mimeType };
    } catch (error) {
      this.isRecording = false;
      unownedAudioTracks.forEach((track) => track.stop());
      stopStream(this.recordingStream);
      this.recordingStream = null;
      this.mediaRecorder = null;
      this.releaseFrames();
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
    this.hooks.onRecordingChange?.(false);

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
        this.releaseFrames();
        this.restoreNativeRenderer();
        resolve(blob);
      };
      try {
        recorder.stop();
      } catch {
        stopStream(this.recordingStream);
        this.recordingStream = null;
        this.mediaRecorder = null;
        this.releaseFrames();
        this.restoreNativeRenderer();
        resolve(null);
      }
    });
  }

  private createFrames(
    size: { width: number; height: number } | undefined,
  ): RecordableFrames | null {
    const createCanvas = () => this.environment.createCanvas();
    if (this.hooks.createFrames) {
      return this.hooks.createFrames({ size, createCanvas });
    }
    if (!size) {
      return { canvas: this.canvas, dispose: () => {} };
    }
    return createCanvasFrameCopy({
      getCanvas: () => this.canvas,
      size,
      createCanvas,
      subscribe: this.hooks.subscribeToFrames,
    });
  }

  private releaseFrames() {
    this.frames?.dispose();
    this.frames = null;
  }

  private restoreNativeRenderer() {
    const restore = this.restoreNativeCapture;
    this.restoreNativeCapture = null;
    restore?.();
  }

  downloadVideo(blob: Blob, filename = 'canvas-recording.webm'): void {
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
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }

  getRecordingStatus(): boolean {
    return this.isRecording;
  }
}
