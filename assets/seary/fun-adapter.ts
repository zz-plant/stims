import {
  FUN_PALETTES,
  type MotionMode,
  type PaletteName,
} from '../ui/fun-controls';

interface SearyUniforms {
  paletteTint: WebGLUniformLocation | null;
  motionScale: WebGLUniformLocation | null;
  audioMix: WebGLUniformLocation | null;
}

function hexToVec3(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [r, g, b];
}

export function createSearyAdapter(
  gl: WebGLRenderingContext,
  uniforms: SearyUniforms
) {
  let motionIntensity = 0.6;
  let motionMode: MotionMode = 'calm';
  let audioReactive = true;

  function currentMotionScale() {
    const base = 0.8 + motionIntensity * 1.2;
    return motionMode === 'party' ? base * 1.4 : base;
  }

  function applyPalette(name: PaletteName) {
    const tint = hexToVec3(FUN_PALETTES[name][0]);
    if (uniforms.paletteTint) {
      gl.uniform3f(uniforms.paletteTint, tint[0], tint[1], tint[2]);
    }
  }

  function setMotion(intensity: number, mode: MotionMode) {
    motionIntensity = intensity;
    motionMode = mode;
    const scale = currentMotionScale();
    if (uniforms.motionScale) {
      gl.uniform1f(uniforms.motionScale, scale);
    }
  }

  function setAudioReactive(enabled: boolean) {
    audioReactive = enabled;
    if (uniforms.audioMix) {
      gl.uniform1f(uniforms.audioMix, enabled ? 1 : 0);
    }
  }

  function scaleFrequencies(low: number, mid: number, high: number) {
    const scale = currentMotionScale();
    if (!audioReactive) {
      return {
        low: 0.25 * scale,
        mid: 0.2 * scale,
        high: 0.18 * scale,
      };
    }
    return {
      low: low * scale,
      mid: mid * scale,
      high: high * scale,
    };
  }

  return { applyPalette, setMotion, setAudioReactive, scaleFrequencies };
}
