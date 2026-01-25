export type MotionPermissionState =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported';

type MotionPermissionRequest = {
  requestPermission?: () => Promise<PermissionState>;
};

export const supportsDeviceOrientation = () =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

export const requiresMotionPermission = () =>
  supportsDeviceOrientation() &&
  typeof DeviceOrientationEvent !== 'undefined' &&
  'requestPermission' in DeviceOrientationEvent;

export const requestMotionPermission =
  async (): Promise<MotionPermissionState> => {
    if (!supportsDeviceOrientation()) return 'unsupported';

    if (!requiresMotionPermission()) {
      return 'granted';
    }

    try {
      const response = await (
        DeviceOrientationEvent as unknown as MotionPermissionRequest
      ).requestPermission?.();

      if (response === 'granted') {
        return 'granted';
      }

      if (response === 'denied') {
        return 'denied';
      }

      return 'prompt';
    } catch (error) {
      console.warn('Motion permission request failed', error);
      return 'denied';
    }
  };
