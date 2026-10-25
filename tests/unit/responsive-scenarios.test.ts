import { describe, expect, test } from "bun:test";
import { findResponsiveScenario, responsiveScenarios } from "../fixtures/responsive-scenarios";

describe("responsive scenario fixtures", () => {
  test("all scenarios have unique names and valid dimensions", () => {
    expect(new Set(responsiveScenarios.map(({ name }) => name)).size).toBe(responsiveScenarios.length);
    for (const item of responsiveScenarios) {
      expect(Number.isInteger(item.viewport.width)).toBe(true);
      expect(Number.isInteger(item.viewport.height)).toBe(true);
      expect(item.viewport.width).toBeGreaterThan(0);
      expect(item.viewport.height).toBeGreaterThan(0);
    }
  });
  test("retrieves exact scenarios without device identification", () => {
    expect(findResponsiveScenario("split-window").viewport).toEqual({ width: 385, height: 571 });
    expect(() => findResponsiveScenario("nonexistent")).toThrow(RangeError);
  });
});
