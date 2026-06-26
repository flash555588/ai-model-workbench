import { describe, expect, it } from "vitest";
import type { ModelAssetProfile } from "../domain/models";
import { buildHeadingPinMap, containsHeadingLinkedAnnotations } from "./heading-pin-map";

function profile(annotations: ModelAssetProfile["annotations"]): ModelAssetProfile {
  return {
    tags: [],
    notes: "",
    annotations,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildHeadingPinMap", () => {
  it("skips profiles without heading-bound pins", () => {
    const map = buildHeadingPinMap({
      "models/a.glb": profile([
        { id: "plain", position: [0, 0, 0], label: "Plain", color: "#fff", createdAt: "now" },
      ]),
      "models/b.glb": profile([]),
    });

    expect(map.size).toBe(0);
  });

  it("normalizes headings and groups bound pins", () => {
    const map = buildHeadingPinMap({
      "models/a.glb": profile([
        { id: "pin-a", position: [0, 0, 0], label: "A", color: "#f00", headingRef: "  Motor Housing  ", createdAt: "now" },
      ]),
      "models/b.glb": profile([
        { id: "pin-b", position: [1, 0, 0], label: "B", color: "#0f0", headingRef: "Motor   Housing", createdAt: "now" },
      ]),
    });

    expect(map.get("Motor Housing")).toEqual([
      { pinId: "pin-a", modelPath: "models/a.glb", color: "#f00" },
      { pinId: "pin-b", modelPath: "models/b.glb", color: "#0f0" },
    ]);
  });
});

describe("containsHeadingLinkedAnnotations", () => {
  it("detects normalized non-empty heading refs", () => {
    expect(containsHeadingLinkedAnnotations({
      "models/a.glb": profile([
        { id: "plain", position: [0, 0, 0], label: "Plain", color: "#fff", headingRef: "   ", createdAt: "now" },
      ]),
      "models/b.glb": profile([
        { id: "pin-b", position: [1, 0, 0], label: "B", color: "#0f0", headingRef: "  Motor   Housing ", createdAt: "now" },
      ]),
    })).toBe(true);
  });

  it("skips profiles without heading refs", () => {
    expect(containsHeadingLinkedAnnotations({
      "models/a.glb": profile([
        { id: "plain", position: [0, 0, 0], label: "Plain", color: "#fff", createdAt: "now" },
      ]),
      "models/b.glb": profile([]),
    })).toBe(false);
  });
});
