import { describe, expect, it, vi } from "vitest";
import type { ModelEvidence, ModelPreviewSummary } from "../../domain/models";
import { buildLocalAnalysisResult } from "./analysis-result";

vi.mock("../../utils/resolve-path", () => ({
  getPortableStem: (path: string) => path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? path,
}));

const preview: ModelPreviewSummary = {
  meshCount: 1,
  triangleCount: 420,
  vertexCount: 210,
  materialCount: 1,
  boundingSize: { x: 1.6, y: 0.8, z: 0.45 },
  rootName: "pcb",
};

describe("buildLocalAnalysisResult format lineage", () => {
  it("preserves source and effective formats on part records and drafting input", () => {
    const evidence: ModelEvidence = {
      summary: preview,
      formatLineage: {
        sourcePath: "models/pcb.step",
        sourceFormat: "step",
        effectiveFormat: "glb",
        loadStrategy: "convert",
      },
      parts: [{
        name: "R1",
        source: "component",
        componentId: "R0603-10K",
        occurrenceId: "PCB/R1",
        componentPath: "PCB/R1",
        meshNames: ["R1"],
        childCount: 1,
        triangleCount: 420,
        vertexCount: 210,
        materialName: "component matte",
        boundingSize: { x: 1.6, y: 0.8, z: 0.45 },
        center: { x: 1, y: 2, z: 0.5 },
      }],
      materialNames: ["component matte"],
      resourceWarnings: [],
      capturedAt: "2026-06-22T00:00:00.000Z",
    };

    const analysis = buildLocalAnalysisResult({
      modelPath: "models/pcb.step",
      preview,
      evidence,
    });

    expect(analysis.asset).toMatchObject({
      format: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
    expect(analysis.evidence?.formatLineage).toEqual(evidence.formatLineage);
    expect(analysis.draftingInput?.model).toMatchObject({
      format: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
    expect(analysis.parts[0]).toMatchObject({
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
    expect(analysis.parts[0].observations).toContain("Format lineage: STEP -> GLB (convert).");
    expect(analysis.draftingInput?.partCandidates[0]).toMatchObject({
      sourceFormat: "step",
      effectiveFormat: "glb",
      loadStrategy: "convert",
    });
  });

  it("caps persisted mesh references for highly fragmented parts", () => {
    const evidence: ModelEvidence = {
      summary: {
        ...preview,
        meshCount: 120,
      },
      parts: [{
        name: "Small detail cluster",
        source: "detail-cluster",
        meshNames: Array.from({ length: 180 }, (_value, index) => `mesh-${index}`),
        childCount: 180,
        triangleCount: 2_400,
        vertexCount: 1_800,
        materialName: "board",
        boundingSize: { x: 1, y: 1, z: 0.2 },
        center: { x: 0, y: 0, z: 0 },
      }],
      materialNames: ["board"],
      resourceWarnings: [],
      capturedAt: "2026-06-22T00:00:00.000Z",
    };

    const analysis = buildLocalAnalysisResult({
      modelPath: "models/board.step",
      preview: evidence.summary,
      evidence,
    });

    expect(analysis.parts[0].meshRefs).toHaveLength(64);
    expect(analysis.draftingInput?.partCandidates[0].meshRefs).toHaveLength(64);
  });
});
