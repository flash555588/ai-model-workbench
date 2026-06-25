import { describe, expect, it } from "vitest";
import type { ModelPreviewSummary } from "../domain/models";
import {
  formatDirectWorkbenchBackendName,
  formatDirectWorkbenchBounds,
  formatDirectWorkbenchCount,
} from "./direct-workbench-panel";

function createSummary(partial: Partial<ModelPreviewSummary> = {}): ModelPreviewSummary {
  return {
    meshCount: 1,
    triangleCount: 12,
    vertexCount: 24,
    materialCount: 1,
    boundingSize: { x: 1.234, y: 5, z: 0.009 },
    rootName: "fixture",
    ...partial,
  };
}

describe("direct workbench panel helpers", () => {
  it("formats backend labels for renderer status", () => {
    expect(formatDirectWorkbenchBackendName("three")).toBe("Three.js");
    expect(formatDirectWorkbenchBackendName("babylon")).toBe("Babylon.js");
  });

  it("formats counts and missing values consistently", () => {
    expect(formatDirectWorkbenchCount(1234.4)).toBe("1,234");
    expect(formatDirectWorkbenchCount(undefined)).toBe("0");
  });

  it("formats model bounds using stable two-decimal axes", () => {
    expect(formatDirectWorkbenchBounds(createSummary())).toBe("1.23 x 5.00 x 0.01");
  });
});
