export interface OfflineRenderOptions {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  onProgress?: (progress: {
    currentFrame: number;
    totalFrames: number;
    percent: number;
  }) => void;
}

export interface OfflineRenderFrame {
  frameIndex: number;
  timeSeconds: number;
  dataUrl?: string;
  blob?: Blob;
}

export interface OfflineSteppableEngine {
  stepFrame(deltaSeconds: number): void;
  renderToCanvas(canvas: HTMLCanvasElement): void;
}

export class OfflineFrameRenderer {
  private canvas: HTMLCanvasElement;
  private cancelled = false;

  constructor(canvas?: HTMLCanvasElement) {
    if (canvas) {
      this.canvas = canvas;
    } else if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
    } else {
      this.canvas = {} as HTMLCanvasElement;
    }
  }

  cancel(): void {
    this.cancelled = true;
  }

  async renderSequence(
    engine: OfflineSteppableEngine,
    options: OfflineRenderOptions,
  ): Promise<OfflineRenderFrame[]> {
    this.cancelled = false;
    const { width, height, fps, durationSeconds, onProgress } = options;
    const totalFrames = Math.max(1, Math.round(fps * durationSeconds));
    const deltaSeconds = 1 / fps;

    if (this.canvas.width !== undefined) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const frames: OfflineRenderFrame[] = [];

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (this.cancelled) break;

      const timeSeconds = frameIndex * deltaSeconds;
      engine.stepFrame(deltaSeconds);
      engine.renderToCanvas(this.canvas);

      frames.push({
        frameIndex,
        timeSeconds,
      });

      if (onProgress) {
        onProgress({
          currentFrame: frameIndex + 1,
          totalFrames,
          percent: Math.round(((frameIndex + 1) / totalFrames) * 100),
        });
      }

      // Yield control periodically to avoid locking the UI thread
      if (frameIndex % 30 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return frames;
  }
}
