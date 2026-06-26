import { describe, expect, it } from "vitest";
import { createPreviewEvidence, createPreviewMaterialSummaryLabel } from "./evidence";
import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";

interface TestMesh {
  id: string;
  materialNames: Array<string | undefined>;
  size?: number;
  source?: ModelPartSummary["source"];
}

function createSummary(span = 10): ModelPreviewSummary {
  return {
    meshCount: 3,
    triangleCount: 42,
    vertexCount: 84,
    materialCount: 3,
    boundingSize: { x: span, y: span, z: span },
    rootName: "assembly",
  };
}

function createMeshPart(mesh: TestMesh): ModelPartSummary {
  const size = mesh.size ?? 1;
  return {
    name: mesh.id,
    triangleCount: 10,
    vertexCount: 20,
    materialName: mesh.materialNames[0] ?? null,
    boundingSize: { x: size, y: size, z: size },
    center: { x: 0, y: 0, z: 0 },
    source: mesh.source ?? "mesh",
    meshNames: [mesh.id],
    childCount: 1,
  };
}

describe("preview evidence helpers", () => {
  it("builds evidence from grouped and ungrouped meshes without leaving grouped meshes behind", () => {
    const groupedMesh: TestMesh = { id: "grouped", materialNames: ["Steel", "Glass"] };
    const meshA: TestMesh = { id: "named-shell", materialNames: ["Rubber", "Steel"] };
    const meshB: TestMesh = { id: "named-cover", materialNames: [undefined, "Aluminum"] };

    const evidence = createPreviewEvidence({
      summary: createSummary(3),
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
      createMeshPart,
      getMeshMaterialNames: (mesh) => mesh.materialNames,
      resourceWarnings: ["missing texture"],
      capturedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(evidence.parts.map((part) => part.name)).toEqual(["Grouped Part", "named-shell", "named-cover"]);
    expect(evidence.materialNames).toEqual(["Aluminum", "Glass", "Rubber", "Steel"]);
    expect(evidence.resourceWarnings).toEqual(["missing texture"]);
    expect(evidence.capturedAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("clusters generic tiny mesh fragments into a single detail part", () => {
    const meshA: TestMesh = { id: "mesh-101", materialNames: ["Steel"], size: 0.2 };
    const meshB: TestMesh = { id: "points-102", materialNames: ["Steel"], size: 0.15 };
    const namedSmallPart: TestMesh = { id: "tiny_screw_01", materialNames: ["Steel"], size: 0.12 };

    const evidence = createPreviewEvidence({
      summary: createSummary(10),
      renderableMeshes: [meshA, meshB, namedSmallPart],
      groupedPartCandidates: { parts: [], groupedMeshes: new Set<TestMesh>() },
      createMeshPart,
      getMeshMaterialNames: (mesh) => mesh.materialNames,
      capturedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(evidence.parts.map((part) => part.name)).toEqual(["Small detail cluster", "tiny_screw_01"]);
    expect(evidence.parts[0]).toMatchObject({
      source: "detail-cluster",
      childCount: 2,
      meshNames: ["mesh-101", "points-102"],
      materialName: "Steel",
    });
  });

  it("keeps semantically named tiny mesh parts separate", () => {
    const screw: TestMesh = { id: "tiny_screw_01", materialNames: ["Steel"], size: 0.1 };
    const pin: TestMesh = { id: "pin_02", materialNames: ["Copper"], size: 0.1 };

    const evidence = createPreviewEvidence({
      summary: createSummary(10),
      renderableMeshes: [screw, pin],
      groupedPartCandidates: { parts: [], groupedMeshes: new Set<TestMesh>() },
      createMeshPart,
      getMeshMaterialNames: (mesh) => mesh.materialNames,
      capturedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(evidence.parts.map((part) => part.name)).toEqual(["tiny_screw_01", "pin_02"]);
    expect(evidence.parts.every((part) => part.source === "mesh")).toBe(true);
  });

  it("preserves explicit group and component candidates while clustering generic mesh fragments", () => {
    const groupedMesh: TestMesh = { id: "grouped", materialNames: ["Paint"] };
    const componentMesh: TestMesh = { id: "component-mesh", materialNames: ["Copper"] };
    const meshA: TestMesh = { id: "mesh-1", materialNames: ["Plastic"], size: 0.1 };
    const meshB: TestMesh = { id: "mesh-2", materialNames: ["Plastic"], size: 0.1 };

    const evidence = createPreviewEvidence({
      summary: createSummary(10),
      renderableMeshes: [groupedMesh, componentMesh, meshA, meshB],
      groupedPartCandidates: {
        parts: [
          {
            name: "Named Housing",
            triangleCount: 30,
            vertexCount: 60,
            materialName: "Paint",
            boundingSize: { x: 2, y: 2, z: 2 },
            center: { x: 0, y: 0, z: 0 },
            source: "group",
            meshNames: ["grouped"],
            childCount: 1,
          },
          {
            name: "Component Pin Bank",
            triangleCount: 20,
            vertexCount: 40,
            materialName: "Copper",
            boundingSize: { x: 1, y: 1, z: 1 },
            center: { x: 1, y: 1, z: 1 },
            source: "component",
            meshNames: ["component-mesh"],
            childCount: 1,
            componentId: "pin-bank",
          },
        ],
        groupedMeshes: new Set([groupedMesh, componentMesh]),
      },
      createMeshPart,
      getMeshMaterialNames: (mesh) => mesh.materialNames,
      capturedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(evidence.parts.map((part) => [part.name, part.source])).toEqual([
      ["Named Housing", "group"],
      ["Component Pin Bank", "component"],
      ["Small detail cluster", "detail-cluster"],
    ]);
  });

  it("summarizes grouped material names consistently", () => {
    expect(createPreviewMaterialSummaryLabel(new Set())).toBeNull();
    expect(createPreviewMaterialSummaryLabel(new Set(["Steel"]))).toBe("Steel");
    expect(createPreviewMaterialSummaryLabel(new Set(["Steel", "Glass"]))).toBe("2 materials");
  });
});
