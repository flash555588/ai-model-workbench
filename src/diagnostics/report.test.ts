import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/constants";
import type { PluginState } from "../domain/models";
import { buildDiagnosticsReport } from "./report";

vi.mock("obsidian", () => ({
  apiVersion: "1.12.7",
  Platform: { isMobile: false },
}));

function createState(): PluginState {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      useThreeRenderer: true,
      previewRendererRollout: "three-direct-glb",
    },
    currentModelPath: "models/example.glb",
    convertedAssetRecords: [],
    modelAssetProfiles: {
      "models/example.glb": {
        tags: [],
        notes: "",
        annotations: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    agentDraft: "",
    agentPlan: null,
    modelPreview: {
      meshCount: 1,
      triangleCount: 12,
      vertexCount: 24,
      materialCount: 1,
      boundingSize: { x: 1, y: 1, z: 1 },
      rootName: "example",
    },
    selectedPart: null,
    lastKnowledgeGeneration: null,
  };
}

describe("diagnostics report", () => {
  it("includes renderer route capability and color pipeline context", () => {
    const report = buildDiagnosticsReport({
      manifest: {
        id: "ai-model-workbench",
        name: "AI Model Workbench",
        version: "0.5.8",
        minAppVersion: "1.5.0",
        description: "",
        author: "",
      },
      state: createState(),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(report).toContain("Current route: three");
    expect(report).toContain("Route capability profile: three; formats=glb/gltf/stl/ply/obj");
    expect(report).toContain("Route color pipeline: sRGB output, no tone mapping");
    expect(report).toContain("Path: <redacted .glb>");
  });
});
