/**
 * What the flash worker does with each message, apart from `self` and
 * `OffscreenCanvas`, so a test can run the real protocol without a browser.
 *
 * Two jobs. A plain readback returns the frame's pixels and leaves the rest to
 * the caller. A judged capture goes further: it converts the pixels and runs
 * the governor here, because that work is what cost frames on the main thread.
 * At 6x CPU throttle it took about 9ms per capture there, enough to push a
 * frame with 8ms of its own work past vsync, while the snapshot and readback
 * cost no measurable frames.
 */
import { createFields, fillFields, type SampledFields } from './fields.ts';
import {
  createFlashGovernor,
  type FlashGovernor,
  type FlashGovernorDecision,
  type FlashGovernorOptions,
} from './governor.ts';

export type FlashReadbackRequest = {
  type?: undefined;
  id: number;
  bitmap: ImageBitmap;
  cols: number;
  rows: number;
};

export type FlashJudgeConfiguration = {
  type: 'configure';
  /** Tiles across and down. */
  cols: number;
  rows: number;
  /** Samples along each tile edge. */
  density: number;
  generation: number;
  governor?: FlashGovernorOptions;
};

export type FlashJudgeRequest = {
  type: 'judge';
  id: number;
  bitmap: ImageBitmap;
  nowMs: number;
  viewScale: number;
  generation: number;
};

export type FlashWorkerRequest =
  | FlashReadbackRequest
  | FlashJudgeConfiguration
  | FlashJudgeRequest
  | { type: 'prime'; hold: number }
  | { type: 'reset'; generation: number };

export type FlashWorkerReply =
  | { id: number; pixels: Uint8ClampedArray | null }
  | { id: number; decision: FlashGovernorDecision | null };

export type FlashWorkerEnvironment = {
  /** Reads a bitmap to RGBA bytes and closes it; null if it cannot. */
  readBitmap: (
    bitmap: ImageBitmap,
    cols: number,
    rows: number,
  ) => Uint8ClampedArray | null;
  reply: (message: FlashWorkerReply, transfer?: Transferable[]) => void;
};

export function createFlashWorkerHandler({
  readBitmap,
  reply,
}: FlashWorkerEnvironment) {
  let configuration: FlashJudgeConfiguration | null = null;
  let governor: FlashGovernor | null = null;
  let fields: SampledFields | null = null;
  let generation = 0;

  function judge(request: FlashJudgeRequest): FlashGovernorDecision | null {
    if (!configuration || !governor || !fields) {
      request.bitmap.close();
      return null;
    }
    const { cols, rows, density } = configuration;
    const pixels = readBitmap(request.bitmap, cols * density, rows * density);
    // A frame from before a reset belongs to the history that reset cleared.
    if (!pixels || request.generation !== generation) return null;
    fillFields(fields, pixels);
    return governor.sample(request.nowMs, fields.luminance, cols, rows, {
      density,
      viewScale: request.viewScale,
      red: fields.red,
    });
  }

  return (request: FlashWorkerRequest) => {
    switch (request.type) {
      case 'configure': {
        configuration = request;
        governor = createFlashGovernor(request.governor);
        fields = createFields(
          request.cols * request.density * request.rows * request.density,
        );
        generation = request.generation;
        return;
      }
      case 'prime':
        governor?.prime(request.hold);
        return;
      case 'reset':
        governor?.reset();
        generation = request.generation;
        return;
      case 'judge':
        reply({ id: request.id, decision: judge(request) });
        return;
      default: {
        const pixels = readBitmap(request.bitmap, request.cols, request.rows);
        if (pixels) {
          reply({ id: request.id, pixels }, [pixels.buffer as ArrayBuffer]);
        } else {
          reply({ id: request.id, pixels: null });
        }
      }
    }
  };
}
