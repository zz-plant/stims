import * as THREE from 'three';

export type AxisFunction = 'sin' | 'cos';

export interface AxisMotionOptions {
  amplitude: number;
  frequency?: number;
  phase?: number;
  fn?: AxisFunction;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface LookAtConfig {
  target?: Vector3Like | THREE.Vector3;
  oscillation?: Partial<Record<'x' | 'y' | 'z', AxisMotionOptions>>;
}

export interface CameraMotionConfig {
  basePosition?: Vector3Like | THREE.Vector3;
  oscillation?: Partial<Record<'x' | 'y' | 'z', AxisMotionOptions>>;
  lookAt?: LookAtConfig;
}

const DEFAULT_AXIS_FUNCTION: AxisFunction = 'sin';
const DEFAULT_FREQUENCY = 1;

const asVector3 = (value?: Vector3Like | THREE.Vector3): THREE.Vector3 => {
  if (!value) return new THREE.Vector3();
  return value instanceof THREE.Vector3
    ? value.clone()
    : new THREE.Vector3(value.x, value.y, value.z);
};

const applyAxisMotion = (
  base: number,
  elapsedSeconds: number,
  motion?: AxisMotionOptions
): number => {
  if (!motion) return base;

  const fn = motion.fn ?? DEFAULT_AXIS_FUNCTION;
  const frequency = motion.frequency ?? DEFAULT_FREQUENCY;
  const phase = motion.phase ?? 0;
  const oscillator = fn === 'cos' ? Math.cos : Math.sin;

  return (
    base + oscillator(elapsedSeconds * frequency + phase) * motion.amplitude
  );
};

export function updateCameraMotion(
  camera: THREE.Camera,
  elapsedSeconds: number,
  config: CameraMotionConfig
) {
  const basePosition = asVector3(config.basePosition ?? camera.position);
  const positionMotion = config.oscillation ?? {};

  camera.position.set(
    applyAxisMotion(basePosition.x, elapsedSeconds, positionMotion.x),
    applyAxisMotion(basePosition.y, elapsedSeconds, positionMotion.y),
    applyAxisMotion(basePosition.z, elapsedSeconds, positionMotion.z)
  );

  const lookAtConfig = config.lookAt;
  if (lookAtConfig) {
    const baseTarget = asVector3(lookAtConfig.target);
    const targetMotion = lookAtConfig.oscillation ?? {};
    const target = new THREE.Vector3(
      applyAxisMotion(baseTarget.x, elapsedSeconds, targetMotion.x),
      applyAxisMotion(baseTarget.y, elapsedSeconds, targetMotion.y),
      applyAxisMotion(baseTarget.z, elapsedSeconds, targetMotion.z)
    );
    camera.lookAt(target);
  }
}
