import { describe, expect, it } from "vitest";
import {
  PREVIEW_INTERACTION_RULES,
  resolvePreviewInteractionMode,
} from "./interaction";

describe("preview interaction rules", () => {
  it("resolves one deterministic exclusive mode", () => {
    expect(resolvePreviewInteractionMode({
      annotation: false,
      focus: true,
      disassembly: true,
      measurement: true,
      slice: true,
    })).toBe("slice");
    expect(resolvePreviewInteractionMode({
      annotation: true,
      focus: false,
      disassembly: false,
      measurement: false,
      slice: true,
    })).toBe("annotation");
  });

  it("keeps camera orbit and view overlays available in editing modes", () => {
    for (const mode of ["annotation", "focus", "disassembly", "measurement", "slice"] as const) {
      expect(PREVIEW_INTERACTION_RULES[mode].exclusive).toBe(true);
      expect(PREVIEW_INTERACTION_RULES[mode].allowsCameraOrbit).toBe(true);
      expect(PREVIEW_INTERACTION_RULES[mode].preservesViewOverlays).toBe(true);
    }
  });
});
