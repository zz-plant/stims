/**
 * The `canvas-video-exporter` package bound to the stage.
 *
 * Two of the package's hooks are Stims services. Frames are recorded from a
 * presented copy of the stage (`createPresentedStageCanvas`,
 * stage-presentation.ts), never from the stage canvas itself: the flash
 * governor's dimming and the D blackout and Y flash are not canvas pixels,
 * and a recording carries them. It leaves out the visitor's brightness
 * ceiling (`readRecordedStagePresentation` says why). The copy paints in the
 * render loop's frame-drawn notification, which the loop keeps sending from a
 * background timer while a recording runs in a hidden tab
 * (animation-loop.ts), so the copy needs no clock of its own. A native format
 * copies at the size the renderer was given; any other crops the stage to
 * fill its frame. And the recording flag (recording-state.ts) is what keeps
 * the hidden-tab policy and the power-saving frame cap from stalling the
 * frames while one runs.
 */
import {
  CanvasVideoExporter,
  type CanvasVideoExporterEnvironment,
  type CanvasVideoExportRuntime,
} from 'canvas-video-exporter';
import { setRecordingActive } from '../../core/services/recording-state.ts';
import {
  createPresentedStageCanvas,
  readRecordedStagePresentation,
} from '../../core/services/stage-presentation.ts';

export function createStageVideoExporter({
  canvas,
  runtime = null,
  getStage = () => null,
  environment,
}: {
  canvas: HTMLCanvasElement;
  runtime?: CanvasVideoExportRuntime | null;
  /** The element the stage's luminance filter is written on. */
  getStage?: () => HTMLElement | null;
  /** Test seam: the browser capabilities the recorder uses. */
  environment?: CanvasVideoExporterEnvironment;
}): CanvasVideoExporter {
  return new CanvasVideoExporter(canvas, environment, runtime, {
    createFrames: ({ size, createCanvas }) =>
      createPresentedStageCanvas({
        getCanvas: () => canvas,
        presentation: () => readRecordedStagePresentation(getStage()),
        size,
        createCanvas,
      }),
    onRecordingChange: setRecordingActive,
  });
}
