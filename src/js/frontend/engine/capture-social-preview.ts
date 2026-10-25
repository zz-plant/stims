/** Capture what the stage presents, through the engine's frame notification. */
import { subscribeToFrameDrawn } from '../../core/frame-drawn.ts';
import {
  createPresentedStageCanvas,
  readRecordedStagePresentation,
} from '../../core/services/stage-presentation.ts';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
} from '../../utils/media/preview-flipbook.ts';
import { collectPreviewFrames } from '../../utils/media/preview-frame-collector.ts';

export async function captureSocialPreview(
  stage: HTMLElement,
  signal: AbortSignal,
  isCurrent: () => boolean,
) {
  const presented = createPresentedStageCanvas({
    getCanvas: () => stage.querySelector('canvas'),
    presentation: () => readRecordedStagePresentation(stage),
    size: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
  });
  if (!presented)
    throw new Error('Preview capture is unavailable in this browser.');
  const context = presented.canvas.getContext('2d');
  if (!context) {
    presented.dispose();
    throw new Error('Preview capture is unavailable.');
  }
  try {
    return await collectPreviewFrames({
      subscribe: subscribeToFrameDrawn,
      read: () =>
        context.getImageData(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT).data,
      signal,
      isCurrent,
    });
  } finally {
    presented.dispose();
  }
}
