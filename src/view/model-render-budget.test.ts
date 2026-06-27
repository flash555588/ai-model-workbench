import { describe, expect, it } from "vitest";
import { getFileSizeRenderBudget, getSummaryRenderBudget } from "./model-render-budget";
import type { ModelPreviewSummary, PluginSettings } from "../domain/models";

const baseSettings: Pick<PluginSettings, "renderQuality" | "renderScale"> = {
  renderQuality: "high",
  renderScale: 1.5,
};

function summary(tier: ModelPreviewSummary["performanceTier"]): ModelPreviewSummary {
  return {
    meshCount: 1,
    triangleCount: 1,
    vertexCount: 3,
    materialCount: 1,
    performanceTier: tier,
    performanceHint: tier,
    resourceWarnings: [],
    boundingSize: { x: 1, y: 1, z: 1 },
    rootName: "fixture",
  };
}

describe("model render budget", () => {
  it("keeps configured quality for unknown and small files", () => {
    expect(getFileSizeRenderBudget(baseSettings, null)).toEqual(baseSettings);
    expect(getFileSizeRenderBudget(baseSettings, 8 * 1024 * 1024)).toEqual(baseSettings);
  });

  it("caps medium-sized files before model parsing", () => {
    expect(getFileSizeRenderBudget(baseSettings, 80 * 1024 * 1024)).toEqual({
      renderQuality: "medium",
      renderScale: 0.85,
    });
  });

  it("caps very large files before model parsing", () => {
    expect(getFileSizeRenderBudget(baseSettings, 240 * 1024 * 1024)).toEqual({
      renderQuality: "low",
      renderScale: 0.65,
    });
  });

  it("uses summary tiers for final large-model budget", () => {
    expect(getSummaryRenderBudget(baseSettings, summary("heavy"))).toEqual({
      renderQuality: "medium",
      renderScale: 0.85,
    });
    expect(getSummaryRenderBudget(baseSettings, summary("extreme"))).toEqual({
      renderQuality: "low",
      renderScale: 0.65,
    });
  });
});
