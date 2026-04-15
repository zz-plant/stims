import { expect, test } from 'bun:test';
import {
  clampMilkdropCurrentFrameBoost,
  getMilkdropFeedbackBlurBlendAmount,
  getMilkdropFeedbackBlurSampleOffsetMultiplier,
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
  MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
} from '../assets/js/milkdrop/feedback-composite-profile.ts';
import { createSharedMilkdropFeedbackManager } from '../assets/js/milkdrop/feedback-manager-shared.ts';
import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from '../assets/js/milkdrop/renderer-adapter.ts';

test('uses the shared milkdrop feedback blur profile across backends', () => {
  expect(getMilkdropFeedbackBlurSampleOffsetMultiplier(0)).toBeCloseTo(
    MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
    6,
  );
  expect(getMilkdropFeedbackBlurSampleOffsetMultiplier(0.65)).toBeCloseTo(
    1.075,
    6,
  );
  expect(getMilkdropFeedbackBlurBlendAmount(0.65)).toBeCloseTo(0.2925, 6);
  expect(getMilkdropFeedbackBlurBlendAmount(10)).toBe(
    MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  );
});

test('clamps current-frame boost to the shared parity cap', () => {
  expect(clampMilkdropCurrentFrameBoost(-1)).toBe(0);
  expect(clampMilkdropCurrentFrameBoost(0.2)).toBeCloseTo(0.2, 6);
  expect(clampMilkdropCurrentFrameBoost(1)).toBe(
    MILKDROP_FEEDBACK_CURRENT_FRAME_BOOST_CAP,
  );
});

test('keeps overlay replace mode distinct from overlay mix mode in the shared feedback shader', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'bool overlayReplace = overlayTextureMode > 0.5 && overlayTextureMode < 1.5;',
    );
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'bool overlayBlend = overlayTextureMode >= 1.5 && overlayTextureAmount > 0.0001;',
    );
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'if (overlayTextureSource > 0.5 && (overlayReplace || overlayBlend)) {',
    );
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'if (overlayTextureMode < 1.5) {\n              color = overlayColor;',
    );
  } finally {
    manager.dispose();
  }
});

test('samples warp textures in warp-stage UV space inside the shared feedback shader', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;',
    );
    expect(manager.compositeMaterial.fragmentShader).not.toContain(
      'vec2 warpUv = vUv * warpTextureScale + warpTextureOffset;',
    );
  } finally {
    manager.dispose();
  }
});

test('keeps the shared legacy echo path projectM-like by avoiding extra frame-mix fusion', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'clamp(videoEchoAlpha, 0.0, 1.0)',
    );
    expect(manager.compositeMaterial.fragmentShader).not.toContain(
      'clamp(mixAlpha, 0.0, 1.0)',
    );
    expect(manager.compositeMaterial.fragmentShader).not.toContain(
      'color = mix(color, current.rgb, clamp(currentFrameBoost',
    );
  } finally {
    manager.dispose();
  }
});

test('applies comp-stage color controls and overlay work before legacy post effects in the shared shader', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    const { fragmentShader } = manager.compositeMaterial;
    const hueIndex = fragmentShader.indexOf(
      'color = hueRotate(color, hueShift);',
    );
    const overlayIndex = fragmentShader.indexOf(
      'bool overlayReplace = overlayTextureMode > 0.5 && overlayTextureMode < 1.5;',
    );
    const brightenIndex = fragmentShader.indexOf(
      'if (brighten > 0.01 || brightenBoost > 0.01) {',
    );
    const gammaIndex = fragmentShader.indexOf(
      'color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));',
    );

    expect(hueIndex).toBeGreaterThanOrEqual(0);
    expect(overlayIndex).toBeGreaterThan(hueIndex);
    expect(brightenIndex).toBeGreaterThan(overlayIndex);
    expect(gammaIndex).toBeGreaterThan(brightenIndex);
  } finally {
    manager.dispose();
  }
});
