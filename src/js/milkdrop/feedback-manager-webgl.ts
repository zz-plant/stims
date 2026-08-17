import { isMobileDevice } from '../utils/browser/device-detect';
import {
  getFeedbackBackendProfile,
  WEBGL_MILKDROP_BACKEND_BEHAVIOR,
} from './backend-behavior';
import { createSharedMilkdropFeedbackManager } from './feedback-manager-shared.ts';

export function createMilkdropWebGLFeedbackManager(
  width: number,
  height: number,
) {
  return createSharedMilkdropFeedbackManager(
    width,
    height,
    isMobileDevice()
      ? {
          ...WEBGL_MILKDROP_BACKEND_BEHAVIOR,
          feedbackProfile: getFeedbackBackendProfile('webgl', {
            mobile: true,
          }),
        }
      : WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  );
}
