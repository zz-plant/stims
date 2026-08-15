/**
 * Shared Playwright launch configuration for e2e suites that need a real
 * WebGL context in Chromium.
 *
 * Headed Chromium locally; CI has no GPU and runs headless under xvfb, where
 * a headed browser dies partway through the first test.
 */
export const HEADLESS = !!process.env.CI;

/**
 * Deterministic software rendering. SwiftShader produces bit-identical pixels
 * on every machine, which pixel-diff baselines require — and it is also the
 * only stable option on the GPU-less CI runner, where Chromium without an
 * explicit software renderer crashes mid-test and the failure surfaces as
 * "Target page, context or browser has been closed" from the cleanup block
 * rather than as the crash it actually is.
 */
export const SOFTWARE_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * Functional suites assert behavior, not pixels, so they don't need
 * SwiftShader's cross-machine determinism. Locally they render on the real
 * GPU (ANGLE's Metal backend on macOS) — measured 5x faster on an M1 Max,
 * and it exercises the same stack users actually run. CI still gets the
 * software renderer for stability. Pixel-baseline suites must import
 * SOFTWARE_RENDERER_ARGS instead, everywhere.
 */
export const WEBGL_RENDERER_ARGS = process.env.CI
  ? SOFTWARE_RENDERER_ARGS
  : [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      // With real-GPU rendering Chromium tracks window occlusion, so the
      // unfocused windows Playwright opens get marked hidden and Stims
      // pauses its render loop — every waitForFunction then times out.
      // SwiftShader never hit this because software GL disables occlusion
      // tracking. Keep the test windows always-foreground as far as the
      // scheduler is concerned.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ];
