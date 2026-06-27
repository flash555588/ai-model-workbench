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
  return createAppWithVaultFiles({ [path]: { size } });
}

function createAppWithVaultFiles(files: Record<string, { size: number; text?: string }>): App {
  const fileMap = new Map(
    Object.entries(files).map(([path, file]) => [path, { path, stat: { size: file.size }, text: file.text }]),
  );
  return {
    vault: {
      getAbstractFileByPath: (candidate: string) => fileMap.get(candidate) ?? null,
      read: async (file: { path?: string; text?: string }) => {
        if (typeof file.text === "string") {
          return file.text;
        }
        const matched = file.path ? fileMap.get(file.path) : null;
        if (typeof matched?.text === "string") {
          return matched.text;
        }
        throw new Error("missing vault text fixture");
      },
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

  it("adds relative glTF external resource sizes without loading Node shims", async () => {
    nodeShimMocks.moduleLoadCount.value = 0;
    nodeShimMocks.stat.mockReset();

    const gltfText = JSON.stringify({
      buffers: [{ uri: "assembly.bin", byteLength: 128 }],
      images: [{ uri: "textures/diffuse%20map.png" }],
    });
    const app = createAppWithVaultFiles({
      "models/assembly.gltf": { size: 1024, text: gltfText },
      "models/assembly.bin": { size: 70 * 1024 * 1024 },
      "models/textures/diffuse map.png": { size: 2 * 1024 * 1024 },
    });

    await expect(getModelPathByteSize(app, "models/assembly.gltf"))
      .resolves.toBe(1024 + 72 * 1024 * 1024);

    expect(nodeShimMocks.moduleLoadCount.value).toBe(0);
    expect(nodeShimMocks.stat).not.toHaveBeenCalled();
  });

  it("deduplicates glTF resources after URI suffix normalization", async () => {
    const gltfText = JSON.stringify({
      buffers: [{ uri: "shared.bin" }],
      images: [{ uri: "shared.bin?cache=1" }],
    });
    const app = createAppWithVaultFiles({
      "models/assembly.gltf": { size: 1024, text: gltfText },
      "models/shared.bin": { size: 10 * 1024 * 1024 },
    });

    await expect(getModelPathByteSize(app, "models/assembly.gltf"))
      .resolves.toBe(1024 + 10 * 1024 * 1024);
  });

  it("resolves parent-directory glTF external resource paths from the model folder", async () => {
    const gltfText = JSON.stringify({
      images: [{ uri: "../textures/panel.png" }],
    });
    const app = createAppWithVaultFiles({
      "models/nested/assembly.gltf": { size: 1024, text: gltfText },
      "models/textures/panel.png": { size: 4 * 1024 * 1024 },
    });

    await expect(getModelPathByteSize(app, "models/nested/assembly.gltf"))
      .resolves.toBe(1024 + 4 * 1024 * 1024);
  });

  it("counts distinct glTF resources that share a filename in different folders", async () => {
    const gltfText = JSON.stringify({
      images: [
        { uri: "../textures/panel.png" },
        { uri: "textures/panel.png" },
      ],
    });
    const app = createAppWithVaultFiles({
      "models/nested/assembly.gltf": { size: 1024, text: gltfText },
      "models/textures/panel.png": { size: 4 * 1024 * 1024 },
      "models/nested/textures/panel.png": { size: 6 * 1024 * 1024 },
    });

    await expect(getModelPathByteSize(app, "models/nested/assembly.gltf"))
      .resolves.toBe(1024 + 10 * 1024 * 1024);
  });

  it("falls back to declared glTF buffer byteLength when external stat is missing", async () => {
    const gltfText = JSON.stringify({
      buffers: [{ uri: "missing.bin", byteLength: 68 * 1024 * 1024 }],
    });
    const app = createAppWithVaultFiles({
      "models/assembly.gltf": { size: 1024, text: gltfText },
    });

    await expect(getModelPathByteSize(app, "models/assembly.gltf"))
      .resolves.toBe(1024 + 68 * 1024 * 1024);
  });

  it("skips remote and data glTF resource URIs when estimating local byte size", async () => {
    const gltfText = JSON.stringify({
      buffers: [
        { uri: "https://cdn.example.com/huge.bin", byteLength: 512 * 1024 * 1024 },
        { uri: "data:application/octet-stream;base64,AA==", byteLength: 512 * 1024 * 1024 },
      ],
      images: [{ uri: "data:image/png;base64,AA==" }],
    });
    const app = createAppWithVaultFiles({
      "models/assembly.gltf": { size: 2048, text: gltfText },
    });

    await expect(getModelPathByteSize(app, "models/assembly.gltf"))
      .resolves.toBe(2048);
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
