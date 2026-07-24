import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from './backend-behavior';
import { createSharedMilkdropFeedbackManager } from './feedback-manager-shared.ts';

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
