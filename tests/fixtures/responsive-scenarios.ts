/** CSS-pixel layout scenarios for responsive screenshot regression tests.
 * These describe window geometry, not device hardware or browser posture APIs.
 * Each case is intentionally usable in any Chromium Playwright project.
 */
export type ResponsiveScenario = Readonly<{
  name: string;
  viewport: Readonly<{ width: number; height: number }>;
  description: string;
}>;

export const responsiveScenarios: readonly ResponsiveScenario[] = [
  { name: "narrow-portrait", viewport: { width: 382, height: 580 }, description: "Small portrait browser window" },
  { name: "medium-portrait", viewport: { width: 669, height: 867 }, description: "Tall medium-width layout" },
  { name: "wide-short", viewport: { width: 951, height: 585 }, description: "Wide, short layout" },
  { name: "split-window", viewport: { width: 385, height: 571 }, description: "Side-by-side multitasking window" },
  { name: "desktop", viewport: { width: 1280, height: 720 }, description: "Ordinary desktop regression" },
] as const;

/** Use inside Playwright tests: await page.setViewportSize(scenario.viewport).
 * This does not emulate the Device Posture or Viewport Segments APIs.
 */
export function findResponsiveScenario(name: string): ResponsiveScenario {
  const scenario = responsiveScenarios.find((candidate) => candidate.name === name);
  if (!scenario) throw new RangeError(`Unknown responsive scenario: ${name}`);
  return scenario;
}
