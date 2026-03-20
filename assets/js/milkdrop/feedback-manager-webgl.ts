import { createSharedMilkdropFeedbackManager } from './feedback-manager-shared.ts';
import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from './renderer-adapter.ts';

export function createMilkdropWebGLFeedbackManager(
  width: number,
  height: number,
) {
  return createSharedMilkdropFeedbackManager(
    width,
    height,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  );
}
