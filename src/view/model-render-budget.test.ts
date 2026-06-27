import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  getFileSizeRenderBudget,
  getModelPathByteSize,
  getSummaryRenderBudget,
  looksLikeAbsoluteFilesystemPath,
} from "./model-render-budget";
import type { ModelPreviewSummary, PluginSettings } from "../domain/models";

const nodeShimMocks = vi.hoisted(() => ({
  moduleLoadCount: { value: 0 },
  stat: vi.fn(),
}));

vi.mock("../utils/node-shim", () => {
  nodeShimMocks.moduleLoadCount.value++;
  return {
    stat: nodeShimMocks.stat,
  };
});

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

function createAppWithVaultFileSize(path: string, size: number): App {
  return {
    vault: {
      getAbstractFileByPath: (candidate: string) => candidate === path ? { stat: { size } } : null,
    },
  } as unknown as App;
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

  it("detects cross-platform absolute filesystem paths without Node setup", () => {
    expect(looksLikeAbsoluteFilesystemPath("C:\\models\\part.glb")).toBe(true);
    expect(looksLikeAbsoluteFilesystemPath("C:/models/part.glb")).toBe(true);
    expect(looksLikeAbsoluteFilesystemPath("\\\\server\\share\\part.glb")).toBe(true);
    expect(looksLikeAbsoluteFilesystemPath("/Users/flash/models/part.glb")).toBe(true);
    expect(looksLikeAbsoluteFilesystemPath("models/part.glb")).toBe(false);
  });

  it("uses vault metadata for relative model paths without loading Node shims", async () => {
    nodeShimMocks.moduleLoadCount.value = 0;
    nodeShimMocks.stat.mockReset();

    await expect(getModelPathByteSize(createAppWithVaultFileSize("models/part.glb", 123456), "models/part.glb"))
      .resolves.toBe(123456);

    expect(nodeShimMocks.moduleLoadCount.value).toBe(0);
    expect(nodeShimMocks.stat).not.toHaveBeenCalled();
  });

  it("uses Node stat only for absolute filesystem paths", async () => {
    nodeShimMocks.moduleLoadCount.value = 0;
    nodeShimMocks.stat.mockResolvedValueOnce({ size: 654321 });

    await expect(getModelPathByteSize(createAppWithVaultFileSize("models/part.glb", 123456), "C:\\models\\part.glb"))
      .resolves.toBe(654321);

    expect(nodeShimMocks.moduleLoadCount.value).toBe(1);
    expect(nodeShimMocks.stat).toHaveBeenCalledWith("C:\\models\\part.glb");
  });
});
