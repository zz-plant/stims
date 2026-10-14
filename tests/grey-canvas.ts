/**
 * One-pixel canvases for tests of what a copy of the stage shows.
 *
 * happy-dom's canvas has no 2D context, and a list of draw calls would pin
 * how a frame is painted rather than what it shows. Each fake holds one grey
 * level, 0 to 255, and composites onto it the way source-over does with an
 * opaque source: `drawImage` and `fillRect` blend by `globalAlpha`. Like an
 * `alpha: false` canvas, a fake is black when created and whenever a
 * dimension is assigned.
 *
 * A source whose `level` is null cannot be read, and drawing it changes
 * nothing. That is what a paused WebGL stage gives back
 * (stage-presentation.ts has the measurement).
 */

export type GreyCanvas = HTMLCanvasElement & {
  level: number | null;
  /** The source rectangle of every drawImage onto this canvas. */
  readonly sourceRects: number[][];
  /** The frame rates captureStream was called with. */
  readonly captures: Array<number | undefined>;
  /** True once every track it handed out has been stopped. */
  readonly captureStopped: boolean;
};

const FILL_LEVELS: Record<string, number> = { '#000000': 0, '#ffffff': 255 };

export function greyCanvas(
  level: number | null = 0,
  { width = 1280, height = 720 } = {},
): GreyCanvas {
  let w = width;
  let h = height;
  const tracks: Array<{ stopped: boolean }> = [];
  const canvas = {
    level,
    sourceRects: [] as number[][],
    captures: [] as Array<number | undefined>,
    get captureStopped() {
      return tracks.length > 0 && tracks.every((track) => track.stopped);
    },
    get width() {
      return w;
    },
    set width(value: number) {
      w = value;
      canvas.level = 0;
    },
    get height() {
      return h;
    },
    set height(value: number) {
      h = value;
      canvas.level = 0;
    },
    getContext: (type: string) => (type === '2d' ? context : null),
    captureStream(fps?: number) {
      canvas.captures.push(fps);
      const state = { stopped: false };
      tracks.push(state);
      // `canvas` as on a real CanvasCaptureMediaStreamTrack, so a test can
      // tell which canvas a video is playing.
      const track = {
        kind: 'video',
        canvas,
        stop: () => {
          state.stopped = true;
        },
      };
      return {
        getTracks: () => [track],
        getVideoTracks: () => [track],
        getAudioTracks: () => [],
      };
    },
  };
  const blend = (over: number, alpha: number) => {
    canvas.level = over * alpha + (canvas.level ?? 0) * (1 - alpha);
  };
  const context = {
    globalAlpha: 1,
    fillStyle: '#000000',
    drawImage(source: GreyCanvas, ...args: number[]) {
      if (args.length === 8) canvas.sourceRects.push(args.slice(0, 4));
      if (source.level === null) return;
      blend(source.level, context.globalAlpha);
    },
    fillRect() {
      const fill = FILL_LEVELS[context.fillStyle];
      if (fill === undefined) {
        throw new Error(`grey canvas cannot fill ${context.fillStyle}`);
      }
      blend(fill, context.globalAlpha);
    },
  };
  return canvas as unknown as GreyCanvas;
}

/** A createCanvas seam that keeps every canvas it made. */
export function greyCanvasFactory() {
  const made: GreyCanvas[] = [];
  return {
    made,
    create: () => {
      const canvas = greyCanvas(0, { width: 300, height: 150 });
      made.push(canvas);
      return canvas as HTMLCanvasElement;
    },
  };
}
