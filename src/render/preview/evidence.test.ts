import { describe, expect, it } from "vitest";
import { createPreviewEvidence, createPreviewMaterialSummaryLabel } from "./evidence";

describe("preview evidence helpers", () => {
  it("builds evidence from grouped and ungrouped meshes without leaving grouped meshes behind", () => {
    const groupedMesh = { id: "grouped", materialNames: ["Steel", "Glass"] };
    const meshA = { id: "mesh-a", materialNames: ["Rubber", "Steel"] };
    const meshB = { id: "mesh-b", materialNames: [undefined, "Aluminum"] };

    const evidence = createPreviewEvidence({
      summary: {
        meshCount: 3,
        triangleCount: 42,
        vertexCount: 84,
        materialCount: 3,
        boundingSize: { x: 1, y: 2, z: 3 },
        rootName: "assembly",
      },
      renderableMeshes: [groupedMesh, meshA, meshB],
      groupedPartCandidates: {
        parts: [{
          name: "Grouped Part",
          triangleCount: 24,
          vertexCount: 48,
          materialName: "2 materials",
          boundingSize: { x: 1, y: 1, z: 1 },
          center: { x: 0, y: 0, z: 0 },
          source: "group",
          meshNames: ["grouped"],
          childCount: 1,
        }],
        groupedMeshes: new Set([groupedMesh]),
      },
      createMeshPart: (mesh) => ({
        name: mesh.id,
        triangleCount: 1,
        vertexCount: 2,
        materialName: mesh.materialNames[0] ?? null,
        boundingSize: { x: 1, y: 1, z: 1 },
        center: { x: 0, y: 0, z: 0 },
        source: "mesh",
      }),
      getMeshMaterialNames: (mesh) => mesh.materialNames,
      resourceWarnings: ["missing texture"],
      capturedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(evidence.parts.map((part) => part.name)).toEqual(["Grouped Part", "mesh-a", "mesh-b"]);
    expect(evidence.materialNames).toEqual(["Aluminum", "Glass", "Rubber", "Steel"]);
    expect(evidence.resourceWarnings).toEqual(["missing texture"]);
    expect(evidence.capturedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("summarizes grouped material names consistently", () => {
    expect(createPreviewMaterialSummaryLabel(new Set())).toBeNull();
    expect(createPreviewMaterialSummaryLabel(new Set(["Steel"]))).toBe("Steel");
    expect(createPreviewMaterialSummaryLabel(new Set(["Steel", "Glass"]))).toBe("2 materials");
  });
});
