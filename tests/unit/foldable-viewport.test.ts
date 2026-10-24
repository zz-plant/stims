import { describe, expect, test } from "bun:test";
import { readFoldableViewport } from "../../src/js/utils/foldable-viewport";

describe("foldable viewport progressive enhancement", () => {
  test("returns unknown posture and one segment when APIs are missing", () => {
    expect(readFoldableViewport({ innerWidth: 382, innerHeight: 580 })).toEqual({
      posture: "unknown", width: 382, height: 580,
      segments: [{ x: 0, y: 0, width: 382, height: 580 }],
    });
  });

  test("preserves a standards-style segmented viewport", () => {
    const state = readFoldableViewport({
      innerWidth: 900, innerHeight: 700,
      navigator: { devicePosture: { type: "folded" } },
      viewport: { segments: [
        { x: 0, y: 0, width: 440, height: 700 },
        { x: 460, y: 0, width: 440, height: 700 },
      ] },
    });
    expect(state.posture).toBe("folded");
    expect(state.segments).toHaveLength(2);
    expect(state.segments[1]?.x).toBe(460);
  });

  test("rejects invalid segment geometry and posture values", () => {
    const state = readFoldableViewport({
      innerWidth: 500, innerHeight: 600,
      navigator: { devicePosture: { type: "tent" } },
      viewport: { segments: [{ x: 0, y: 0, width: Number.NaN, height: 600 }] },
    });
    expect(state.posture).toBe("unknown");
    expect(state.segments).toEqual([{ x: 0, y: 0, width: 500, height: 600 }]);
  });
});
