import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
} from "three";
import { describe, expect, it } from "vitest";
import {
  createThreeGroupedPartCandidates,
  createThreeModelPreviewSummary,
  createThreePartPreviewSummary,
  createThreeRenderableInfoBreakdown,
  createThreeRenderablePartPreviewSummary,
} from "./mesh-preview";

function createBox(name: string, materialName: string): Mesh {
  const material = new MeshStandardMaterial({ name: materialName });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.name = name;
  return mesh;
}

describe("three mesh preview helpers", () => {
  it("summarizes renderable meshes without scene coordination state", () => {
    const root = new Object3D();
    root.name = "root-model";
    const material = new MeshStandardMaterial({ name: "shared" });
    const meshA = new Mesh(new BoxGeometry(2, 4, 6), material);
    const meshB = new Mesh(new BoxGeometry(1, 1, 1), material);
    root.add(meshA, meshB);

    const summary = createThreeModelPreviewSummary(root, [meshA, meshB], ["missing texture"]);

    expect(summary.rootName).toBe("root-model");
    expect(summary.meshCount).toBe(2);
    expect(summary.triangleCount).toBe(24);
    expect(summary.vertexCount).toBe(48);
    expect(summary.materialCount).toBe(1);
    expect(summary.resourceWarnings).toEqual(["missing texture"]);
    expect(summary.boundingSize).toEqual({ x: 2, y: 4, z: 6 });
  });

  it("summarizes point clouds as renderable evidence without faking triangles", () => {
    const root = new Object3D();
    root.name = "scan-root";
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([
      0, 0, 0,
      0.01, 0, 0,
      0, 0.02, 0,
    ]), 3));
    const points = new Points(geometry, new PointsMaterial({ name: "scan-points" }));
    points.name = "micro-scan";
    root.add(points);

    const summary = createThreeModelPreviewSummary(root, [points]);
    const part = createThreeRenderablePartPreviewSummary(points, root);
    const breakdown = createThreeRenderableInfoBreakdown(points);

    expect(summary).toMatchObject({
      meshCount: 1,
      triangleCount: 0,
      vertexCount: 3,
      materialCount: 1,
      rootName: "scan-root",
    });
    expect(part).toMatchObject({
      name: "micro-scan",
      triangleCount: 0,
      vertexCount: 3,
      materialName: "scan-points",
      source: "mesh",
      meshNames: ["micro-scan"],
    });
    expect(breakdown).toMatchObject({
      name: "micro-scan",
      triangleCount: null,
      vertexCount: 3,
      materialName: "scan-points",
    });
  });

  it("promotes explicit component metadata on individual meshes", () => {
    const root = new Object3D();
    const mesh = createBox("pin-body", "steel");
    mesh.userData = {
      ai3dPartId: "part-17",
      ai3dOccurrenceId: "occ-2",
      displayName: "Precision Pin",
    };
    root.add(mesh);

    const part = createThreePartPreviewSummary(mesh, root);

    expect(part.name).toBe("Precision Pin");
    expect(part.source).toBe("component");
    expect(part.componentId).toBe("part-17");
    expect(part.occurrenceId).toBe("occ-2");
    expect(part.meshNames).toEqual(["pin-body"]);
    expect(part.childCount).toBe(1);
  });

  it("groups named child assemblies while leaving unrelated meshes ungrouped", () => {
    const root = new Object3D();
    const assembly = new Object3D();
    assembly.name = "screw-cluster";
    const meshA = createBox("screw-a", "black");
    const meshB = createBox("screw-b", "silver");
    const meshC = createBox("plate", "aluminum");
    meshB.position.set(2, 0, 0);
    meshC.position.set(8, 0, 0);
    assembly.add(meshA, meshB);
    root.add(assembly, meshC);

    const candidates = createThreeGroupedPartCandidates(root, [meshA, meshB, meshC]);

    expect(candidates.groupedMeshes.has(meshA)).toBe(true);
    expect(candidates.groupedMeshes.has(meshB)).toBe(true);
    expect(candidates.groupedMeshes.has(meshC)).toBe(false);
    expect(candidates.parts).toHaveLength(1);
    expect(candidates.parts[0]).toMatchObject({
      name: "screw-cluster",
      source: "group",
      childCount: 2,
      materialName: "2 materials",
      meshNames: ["screw-a", "screw-b"],
    });
  });
});
