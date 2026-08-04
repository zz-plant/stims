/**
 * Shared Playwright launch configuration for e2e suites that need a real
 * WebGL context in Chromium.
 *
 * Headed Chromium exercises a real GPU locally, which is the point of these
 * suites on a developer machine. CI has no GPU: it runs under xvfb, and a
 * headed browser there dies partway through the first test. Headless plus a
 * software renderer is stable there and still produces real canvas content.
 */
export const HEADLESS = !!process.env.CI;

/**
 * CI runs headed Chromium under xvfb with no real GPU. Without an explicit
 * software renderer the browser crashes mid-test, and the failure surfaces as
 * "Target page, context or browser has been closed" from the cleanup block
 * rather than as the crash it actually is.
 */
export const WEBGL_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
