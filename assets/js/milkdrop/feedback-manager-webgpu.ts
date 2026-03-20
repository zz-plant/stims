import {
  createCompositeFragmentShaderVariant,
  createSharedMilkdropFeedbackManager,
} from './feedback-manager-shared.ts';
import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './renderer-adapter.ts';

export function createMilkdropWebGPUFeedbackManager(
  width: number,
  height: number,
) {
  const manager = createSharedMilkdropFeedbackManager(
    width,
    height,
    WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
  );
  manager.compositeMaterial.fragmentShader =
    createCompositeFragmentShaderVariant(
      manager.compositeMaterial.fragmentShader,
      {
        enhancedFeedbackBlur: true,
        currentFrameBoostCap: 0.4,
      },
    ).replace(
      'color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));',
      `
          vec2 spectralUvA = vUv * vec2(1.4 + signalBass * 0.8, 1.1 + signalMid * 0.6) +
            vec2(signalTime * 0.035, -signalTime * 0.02);
          vec2 spectralUvB = vUv * vec2(2.0 + signalTreb * 0.9, 1.7 + signalBass * 0.5) -
            vec2(signalTime * 0.018, -signalTime * 0.026);
          vec3 spectralA = sampleAuxTexture(2.0, spectralUvA).rgb;
          vec3 spectralB = sampleAuxTexture(5.0, spectralUvB).rgb;
          float spectralPulse = sin((vUv.x + vUv.y) * 18.0 + signalTime * 2.4 + signalBeat * 3.14159) * 0.15;
          float spectralField = smoothstep(
            0.38,
            0.92,
            dot(mix(spectralA, spectralB, 0.5), vec3(0.3333333)) + spectralPulse
          );
          vec3 spectralTint = vec3(
            0.35 + signalBass * 0.9,
            0.25 + signalMid * 0.8,
            0.45 + signalTreb * 1.1
          );
          color += spectralTint * spectralField * (0.06 + signalEnergy * 0.18 + signalBeat * 0.08);
          color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));
    `,
    );
  manager.compositeMaterial.needsUpdate = true;
  return manager;
}
