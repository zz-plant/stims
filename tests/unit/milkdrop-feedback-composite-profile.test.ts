import { expect, test } from 'bun:test';
import {
  getMilkdropFeedbackBlurBlendAmount,
  getMilkdropFeedbackBlurSampleOffsetMultiplier,
  MILKDROP_FEEDBACK_BLUR_BLEND_CAP,
  MILKDROP_FEEDBACK_BLUR_OFFSET_BASE,
} from '../../src/js/milkdrop/feedback-composite-profile.ts';
import {
  createSharedMilkdropFeedbackManager,
  resolveMilkdropBlurShaderRanges,
} from '../../src/js/milkdrop/feedback-manager-shared.ts';
import { WEBGL_MILKDROP_BACKEND_BEHAVIOR } from '../../src/js/milkdrop/renderer-adapter.ts';

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

test('avoids reserved GLSL identifiers in the shared blur shader', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    blurHMaterial: { fragmentShader: string };
    blurVMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    for (const material of [manager.blurHMaterial, manager.blurVMaterial]) {
      expect(material.fragmentShader).not.toContain('vec4 sample =');
      expect(material.fragmentShader).toContain('texture2D(sourceTex');
    }
  } finally {
    manager.dispose();
  }
});

test('samples warp textures in warp-stage UV space inside the feedback blend shader', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    feedbackBlendMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    expect(manager.feedbackBlendMaterial.fragmentShader).toContain(
      'vec2 warpUv = currentUv * warpTextureScale + warpTextureOffset;',
    );
    expect(manager.feedbackBlendMaterial.fragmentShader).not.toContain(
      'vec2 warpUv = vUv * warpTextureScale + warpTextureOffset;',
    );
  } finally {
    manager.dispose();
  }
});

/**
 * The internal frame carries the feedback loop for every preset. It used to
 * blend history in by `videoEchoAlpha` for control-driven presets, which
 * meant a preset with no video echo threw its history away every frame —
 * fDecay was inert and no warp variable could accumulate.
 */
test('carries feedback for control-driven presets, not just echo ones', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    feedbackBlendMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    const shader = manager.feedbackBlendMaterial.fragmentShader;
    // History is composited under this frame's geometry by its coverage...
    expect(shader).toContain('previousColor * (1.0 - coverage) + current.rgb');
    // ...and never gated on the echo amount.
    expect(shader).not.toContain('clamp(videoEchoAlpha, 0.0, 1.0)');
    expect(shader).not.toContain('clamp(mixAlpha, 0.0, 1.0)');
    expect(shader).not.toContain(
      'color = mix(color, current.rgb, clamp(currentFrameBoost',
    );
  } finally {
    manager.dispose();
  }
});

test('keeps the composite pass display-only over the internal frame', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: { fragmentShader: string };
    feedbackBlendMaterial: { fragmentShader: string };
    dispose: () => void;
  };

  try {
    // The composite (display) pass must read the feedback-blend output
    // instead of re-deriving the frame — feeding comp/post output back into
    // the loop compounds those effects every frame.
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'texture2D(internalTex, sampleUv(vUv, textureWrap)).rgb',
    );
    expect(manager.compositeMaterial.fragmentShader).toContain(
      'vec4 sampleCompFrame(vec2 sampleCoord)',
    );
    expect(manager.feedbackBlendMaterial.fragmentShader).not.toContain(
      'gammaAdj',
    );
  } finally {
    manager.dispose();
  }
});

test('provides MilkDrop blur scale and bias inputs to direct WebGL shaders', () => {
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    compositeMaterial: {
      fragmentShader: string;
      uniforms: Record<string, { value: number }>;
    };
    dispose: () => void;
    warpMaterial: {
      fragmentShader: string;
      uniforms: Record<string, { value: number }>;
    };
  };

  try {
    for (const material of [manager.warpMaterial, manager.compositeMaterial]) {
      for (const blurLevel of [1, 2, 3]) {
        expect(material.fragmentShader).toContain(
          `uniform float scale${blurLevel};`,
        );
        expect(material.fragmentShader).toContain(
          `uniform float bias${blurLevel};`,
        );
        expect(material.uniforms[`scale${blurLevel}`]?.value).toBe(1);
        expect(material.uniforms[`bias${blurLevel}`]?.value).toBe(0);
      }
    }
  } finally {
    manager.dispose();
  }
});

test('maps nested MilkDrop blur ranges to direct shader scale and bias values', () => {
  const ranges = resolveMilkdropBlurShaderRanges({
    blur1_min: 0.1,
    blur1_max: 0.9,
    blur2_min: 0.2,
    blur2_max: 0.7,
    blur3_min: 0.3,
    blur3_max: 0.6,
  });

  expect(ranges.map((range) => range.bias)).toEqual([0.1, 0.2, 0.3]);
  expect(ranges[0]?.scale).toBeCloseTo(0.8, 6);
  expect(ranges[1]?.scale).toBeCloseTo(0.5, 6);
  expect(ranges[2]?.scale).toBeCloseTo(0.3, 6);
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
    // projectM post-effects order: brighten → darken → solarize → invert →
    // gamma_adj (last). Gamma is applied after all other post effects.
    expect(gammaIndex).toBeGreaterThan(brightenIndex);
  } finally {
    manager.dispose();
  }
});

test('every material written each frame declares the texsize builtin', () => {
  // Regression: MILKDROP_SHADER_BUILTIN_DECLARATIONS declares `uniform vec4
  // texsize` for every custom shader body, and two paths write it every frame
  // (swap() and applyCompositeState). The warp material never actually created
  // the uniform, so the first write threw "Cannot read properties of undefined
  // (reading 'value')" inside the adapter's try/catch — every frame logged
  // "render failed (potentially during fallback/transition)" and returned
  // false, so nothing drew at all. The catch turned a crash into a silent
  // stall, and the e2e waiting for canvas content timed out instead.
  const manager = createSharedMilkdropFeedbackManager(
    320,
    180,
    WEBGL_MILKDROP_BACKEND_BEHAVIOR,
  ) as {
    warpMaterial: { uniforms: Record<string, { value: unknown } | undefined> };
    compositeMaterial: {
      uniforms: Record<string, { value: unknown } | undefined>;
    };
    feedbackBlendMaterial: {
      uniforms: Record<string, { value: unknown } | undefined>;
    };
    dispose: () => void;
  };

  try {
    for (const [label, material] of [
      ['warp', manager.warpMaterial],
      ['composite', manager.compositeMaterial],
      ['feedbackBlend', manager.feedbackBlendMaterial],
    ] as const) {
      const texsize = material.uniforms.texsize;
      expect(`${label}: ${texsize ? 'declared' : 'MISSING'}`).toBe(
        `${label}: declared`,
      );
      // vec4 (width, height, 1/width, 1/height) — a Vector2 here would compile
      // but silently truncate the .zw one-texel offset neighbour taps read.
      expect(texsize?.value).toHaveProperty('w');
    }
  } finally {
    manager.dispose();
  }
});
