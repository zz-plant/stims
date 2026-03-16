import {
  getActiveMotionPreference,
  subscribeToMotionPreference,
} from '../../core/motion-preferences';
import {
  createControlPanelCheckbox,
  createControlPanelNote,
} from '../../utils/control-panel-elements';
import type { MilkdropPresetToyBehaviorFactory } from '../milkdrop-preset-behavior';

type MotionAccessState = 'prompt' | 'granted' | 'denied' | 'unavailable';

type GravityVector = {
  x: number;
  y: number;
  z: number;
};

const DEFAULT_GRAVITY: GravityVector = {
  x: 0,
  y: -1,
  z: -0.28,
};

function normalizeGravity(vector: GravityVector) {
  const length =
    Math.hypot(vector.x, vector.y, vector.z) ||
    Math.hypot(DEFAULT_GRAVITY.x, DEFAULT_GRAVITY.y, DEFAULT_GRAVITY.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function cloneGravity(vector: GravityVector): GravityVector {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function mapOrientationToGravity(event: DeviceOrientationEvent) {
  const gamma = Math.max(-70, Math.min(70, event.gamma ?? 0));
  const beta = Math.max(-70, Math.min(70, event.beta ?? 0));
  return normalizeGravity({
    x: gamma / 70,
    y: -1,
    z: -0.2 + beta / 90,
  });
}

export const createTactileSandTableBehavior: MilkdropPresetToyBehaviorFactory =
  () => {
    const deviceMotionSupported =
      typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    let motionPreferenceEnabled = getActiveMotionPreference().enabled;
    let motionSupported = deviceMotionSupported && motionPreferenceEnabled;
    let motionAccess: MotionAccessState = motionSupported
      ? 'prompt'
      : 'unavailable';
    let motionListener: ((event: DeviceOrientationEvent) => void) | null = null;
    let unsubscribeMotionPreference: (() => void) | null = null;

    let gravityLocked = true;
    let gravityVector = normalizeGravity(cloneGravity(DEFAULT_GRAVITY));
    let gravityTarget = normalizeGravity(cloneGravity(DEFAULT_GRAVITY));

    let gravityLockInput: HTMLInputElement | null = null;
    let motionStatus: HTMLParagraphElement | null = null;
    let motionButton: HTMLButtonElement | null = null;

    const resetGravity = () => {
      gravityTarget = normalizeGravity(cloneGravity(DEFAULT_GRAVITY));
      gravityVector = normalizeGravity(cloneGravity(DEFAULT_GRAVITY));
    };

    const setGravityLocked = (locked: boolean) => {
      gravityLocked = locked;
      if (gravityLockInput) {
        gravityLockInput.checked = locked;
      }
      if (locked) {
        resetGravity();
      }
    };

    const cleanupMotionListener = () => {
      if (!motionListener || typeof window === 'undefined') {
        return;
      }
      window.removeEventListener('deviceorientation', motionListener);
      motionListener = null;
    };

    const registerMotionListener = () => {
      if (typeof window === 'undefined') {
        return;
      }
      cleanupMotionListener();
      motionListener = (event: DeviceOrientationEvent) => {
        if (gravityLocked) {
          return;
        }
        gravityTarget = mapOrientationToGravity(event);
      };
      window.addEventListener('deviceorientation', motionListener);
    };

    const updateMotionUI = () => {
      if (!motionStatus || !motionButton) {
        return;
      }
      if (gravityLockInput) {
        gravityLockInput.disabled = motionAccess !== 'granted';
      }

      if (!motionSupported) {
        motionButton.disabled = true;
        motionButton.textContent = deviceMotionSupported
          ? 'Motion disabled'
          : 'Motion unsupported';
        motionStatus.textContent = deviceMotionSupported
          ? 'Motion input is off. Enable it in global settings to steer the sand.'
          : 'Device motion is unavailable; gravity remains locked.';
        setGravityLocked(true);
        return;
      }

      if (motionAccess === 'granted') {
        motionButton.disabled = true;
        motionButton.textContent = 'Motion enabled';
        motionStatus.textContent =
          'Motion control is active. Tilt to steer gravity.';
        return;
      }

      if (motionAccess === 'denied') {
        motionButton.disabled = true;
        motionButton.textContent = 'Motion permission denied';
        motionStatus.textContent =
          'Motion access was denied. Gravity remains locked to default.';
        setGravityLocked(true);
        return;
      }

      motionButton.disabled = false;
      motionButton.textContent = 'Enable motion control';
      motionStatus.textContent =
        'Enable device motion to steer the sand with tilt.';
      setGravityLocked(true);
    };

    const requestMotionAccess = async () => {
      if (!motionSupported) {
        return;
      }

      try {
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          'requestPermission' in DeviceOrientationEvent
        ) {
          const result = await (
            DeviceOrientationEvent as unknown as {
              requestPermission?: () => Promise<PermissionState>;
            }
          ).requestPermission?.();
          if (result !== 'granted') {
            motionAccess = result === 'denied' ? 'denied' : 'prompt';
            updateMotionUI();
            return;
          }
        }

        registerMotionListener();
        motionAccess = 'granted';
        setGravityLocked(false);
        updateMotionUI();
      } catch (_error) {
        motionAccess = 'denied';
        updateMotionUI();
      }
    };

    return {
      getSignalOverrides() {
        const motionX = gravityVector.x;
        const motionY = gravityVector.z;
        const motionZ = gravityVector.y;
        const activeMotion =
          motionAccess === 'granted' && !gravityLocked ? 1 : 0;
        const motionStrength = Math.min(1, Math.hypot(motionX, motionY));

        return {
          motionX,
          motionY,
          motionZ,
          motion_x: motionX,
          motion_y: motionY,
          motion_z: motionZ,
          motionEnabled: activeMotion,
          motion_enabled: activeMotion,
          motionStrength,
          motion_strength: motionStrength,
        };
      },

      onFrame({ frame }) {
        const deltaSeconds = Math.max(0.001, frame.deltaMs / 1000);
        const lerpFactor = 1 - 0.0004 ** deltaSeconds;
        gravityVector = normalizeGravity({
          x: gravityVector.x + (gravityTarget.x - gravityVector.x) * lerpFactor,
          y: gravityVector.y + (gravityTarget.y - gravityVector.y) * lerpFactor,
          z: gravityVector.z + (gravityTarget.z - gravityVector.z) * lerpFactor,
        });
      },

      setupPanel(panel) {
        const gravityRow = panel.addSection(
          'Gravity',
          'Lock to the default downward pull on desktop, or use tilt to steer the sand.',
        );
        const { input, toggle } = createControlPanelCheckbox({
          id: 'tactile-gravity-lock',
          label: 'Lock gravity',
          checked: gravityLocked,
          onChange: (checked) => {
            setGravityLocked(checked);
          },
        });
        gravityLockInput = input;

        const recenterButton = document.createElement('button');
        recenterButton.type = 'button';
        recenterButton.className = 'cta-button';
        recenterButton.textContent = 'Re-center';
        recenterButton.addEventListener('click', () => {
          resetGravity();
          setGravityLocked(true);
        });

        motionStatus = createControlPanelNote({
          text: 'Enable device motion to steer the sand with tilt.',
        });
        motionButton = document.createElement('button');
        motionButton.type = 'button';
        motionButton.className = 'cta-button';
        motionButton.textContent = 'Enable motion control';
        motionButton.addEventListener('click', () => {
          void requestMotionAccess();
        });

        gravityRow.append(toggle, recenterButton, motionStatus, motionButton);
        updateMotionUI();

        unsubscribeMotionPreference = subscribeToMotionPreference(
          (preference) => {
            motionPreferenceEnabled = preference.enabled;
            motionSupported = deviceMotionSupported && motionPreferenceEnabled;
            if (!motionSupported) {
              cleanupMotionListener();
              motionAccess = deviceMotionSupported ? 'prompt' : 'unavailable';
              setGravityLocked(true);
            } else if (motionAccess === 'unavailable') {
              motionAccess = 'prompt';
            }
            updateMotionUI();
          },
        );
      },

      dispose() {
        cleanupMotionListener();
        unsubscribeMotionPreference?.();
        unsubscribeMotionPreference = null;
      },
    };
  };
