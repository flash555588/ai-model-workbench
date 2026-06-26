import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { attachObjectToScenePreservingWorldTransform, createThreeDisassemblyParts } from "./disassembly";
import {
  createThreeGroupedPartCandidates,
  createThreeModelPreviewSummary,
  createThreeObjectPartPreviewSummary,
  createThreePartPreviewSummary,
  createThreeRenderableInfoBreakdown,
  createThreeRenderablePartPreviewSummary,
  findThreeSelectablePartObject,
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

  it("promotes picked child meshes to their explicit converted component", () => {
    const root = new Object3D();
    const component = new Object3D();
    component.name = "U4";
    component.userData = {
      ai3dPartId: "component-U4",
      componentPath: "PCB/U4",
    };
    const meshA = createBox("U4->0_primitive0", "plastic");
    const meshB = createBox("U4->0_primitive1", "copper");
    const other = createBox("board", "fr4");
    component.add(meshA, meshB);
    root.add(component, other);

    const selected = findThreeSelectablePartObject(root, meshA, [meshA, meshB, other]);
    const part = createThreeObjectPartPreviewSummary(selected, root, [meshA, meshB, other]);

    expect(selected).toBe(component);
    expect(part).toMatchObject({
      name: "U4",
      source: "component",
      componentId: "component-U4",
      componentPath: "PCB/U4",
      childCount: 2,
      meshNames: ["U4->0_primitive0", "U4->0_primitive1"],
      materialName: "2 materials",
    });
  });

  it("prefers an ancestor registered component over smaller named surface groups", () => {
    const root = new Object3D();
    const component = new Object3D();
    component.name = "J1";
    component.userData = {
      ai3dPartId: "component-J1",
      componentPath: "PCB/J1",
    };
    const surfaceGroup = new Object3D();
    surfaceGroup.name = "terminal-face-cluster";
    const meshA = createBox("J1->0_primitive0", "plastic");
    const meshB = createBox("J1->0_primitive1", "plastic");
    const other = createBox("board", "fr4");
    surfaceGroup.add(meshA, meshB);
    component.add(surfaceGroup);
    root.add(component, other);

    const selected = findThreeSelectablePartObject(root, meshA, [meshA, meshB, other]);

    expect(selected).toBe(component);
  });

  it("skips generated converted mesh bucket identities when a parent component exists", () => {
    const root = new Object3D();
    const component = new Object3D();
    component.name = "CN1";
    component.userData = {
      ai3d: {
        partId: "CN1",
        componentId: "CN1",
        occurrenceId: "CN1",
        componentPath: "CN1",
        displayName: "CN1",
      },
    };
    const meshBucket = new Object3D();
    meshBucket.name = "CN1->0";
    meshBucket.userData = {
      ai3d: {
        partId: "CN1-_0",
        componentId: "CN1-_0",
        occurrenceId: "CN1-_0",
        componentPath: "CN1-_0",
        displayName: "CN1-_0",
      },
    };
    const meshA = createBox("CN1->0_primitive0", "plastic");
    const meshB = createBox("CN1->0_primitive1", "plastic");
    const other = createBox("board", "fr4");
    meshBucket.add(meshA, meshB);
    component.add(meshBucket);
    root.add(component, other);

    const selected = findThreeSelectablePartObject(root, meshA, [meshA, meshB, other]);
    const part = createThreeObjectPartPreviewSummary(selected, root, [meshA, meshB, other]);

    expect(selected).toBe(component);
    expect(part).toMatchObject({
      name: "CN1",
      componentId: "CN1",
      childCount: 2,
    });
  });

  it("creates disassembly parts at component scope so moving a component moves all child meshes", () => {
    const root = new Object3D();
    const component = new Object3D();
    component.name = "CN1";
    component.userData = {
      ai3d: {
        partId: "CN1",
        componentId: "CN1",
        occurrenceId: "CN1",
        componentPath: "CN1",
        displayName: "CN1",
      },
    };
    const meshBucket = new Object3D();
    meshBucket.name = "CN1->0";
    meshBucket.userData = {
      ai3d: {
        partId: "CN1-_0",
        componentId: "CN1-_0",
        occurrenceId: "CN1-_0",
        componentPath: "CN1-_0",
        displayName: "CN1-_0",
      },
    };
    const meshA = createBox("CN1->0_primitive0", "plastic");
    const meshB = createBox("CN1->0_primitive1", "plastic");
    const other = createBox("board", "fr4");
    meshB.position.set(2, 0, 0);
    other.position.set(8, 0, 0);
    meshBucket.add(meshA, meshB);
    component.add(meshBucket);
    root.add(component, other);
    root.updateMatrixWorld(true);

    const parts = createThreeDisassemblyParts(root, [meshA, meshB, other]);
    const componentPart = parts.find((part) => part.object === component);
    expect(componentPart?.meshes).toEqual([meshA, meshB]);

    const before = new Box3().setFromObject(component);
    component.position.x = 5;
    root.updateMatrixWorld(true);
    const after = new Box3().setFromObject(component);

    expect(after.min.x - before.min.x).toBeCloseTo(5);
    expect(after.max.x - before.max.x).toBeCloseTo(5);
  });

  it("preserves world transform when lifting a nested component for Three disassembly drag", () => {
    const scene = new Scene();
    const root = new Object3D();
    const assembly = new Object3D();
    const component = new Object3D();

    root.position.set(10, -4, 2);
    root.rotation.set(0.2, -0.4, 0.1);
    assembly.position.set(1, 2, 3);
    assembly.rotation.set(-0.3, 0.25, 0.5);
    assembly.scale.setScalar(1.4);
    component.position.set(0.5, -0.25, 2);
    component.rotation.set(0.1, 0.6, -0.2);

    scene.add(root);
    root.add(assembly);
    assembly.add(component);
    scene.updateMatrixWorld(true);

    const beforePosition = component.getWorldPosition(new Vector3());
    const beforeQuaternion = component.getWorldQuaternion(new Quaternion());
    const beforeScale = component.getWorldScale(new Vector3());

    attachObjectToScenePreservingWorldTransform(scene, component);

    const afterPosition = component.getWorldPosition(new Vector3());
    const afterQuaternion = component.getWorldQuaternion(new Quaternion());
    const afterScale = component.getWorldScale(new Vector3());

    expect(component.parent).toBe(scene);
    expect(afterPosition.distanceTo(beforePosition)).toBeLessThan(0.000001);
    expect(afterQuaternion.angleTo(beforeQuaternion)).toBeLessThan(0.000001);
    expect(afterScale.distanceTo(beforeScale)).toBeLessThan(0.000001);
  });
});
