import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { describe, expect, it } from "vitest";
import { createBabylonDisassemblyParts } from "./disassembly";
import {
  collectBabylonGltfComponentMetadata,
  createBabylonGroupedPartCandidates,
  createBabylonModelPreviewSummary,
  createBabylonNodePartPreviewSummary,
  createBabylonPartPreviewSummary,
  findBabylonSelectablePartNode,
  getBabylonMeshPreviewBounds,
  getBabylonMeshesPreviewBounds,
} from "./mesh-preview";

function createScene(): { scene: Scene; dispose: () => void } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return {
    scene,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
}

function createBox(scene: Scene, name: string, materialName: string): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
  const material = new StandardMaterial(materialName, scene);
  mesh.material = material;
  return mesh;
}

function encodeJson(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("babylon mesh preview helpers", () => {
  it("collects glTF node and mesh extras as component metadata", () => {
    const metadata = collectBabylonGltfComponentMetadata(encodeJson({
      nodes: [{ name: "node-a", extras: { componentId: "node-part", displayName: "Node Part" } }],
      meshes: [{ name: "mesh-a", extras: { partNumber: "mesh-part" } }],
    }), "gltf");

    expect(metadata.get("node:node-a")).toEqual({ componentId: "node-part", displayName: "Node Part" });
    expect(metadata.get("mesh:mesh-a")).toEqual({ partNumber: "mesh-part" });
  });

  it("promotes fallback component metadata on individual meshes", () => {
    const { scene, dispose } = createScene();
    try {
      const mesh = createBox(scene, "node-a", "steel");
      const metadata = new Map<string, unknown>([
        ["node:node-a", { componentId: "part-9", occurrenceId: "occ-1", displayName: "Needle Pin" }],
      ]);

      const part = createBabylonPartPreviewSummary(mesh, metadata);

      expect(part.name).toBe("Needle Pin");
      expect(part.source).toBe("component");
      expect(part.componentId).toBe("part-9");
      expect(part.occurrenceId).toBe("occ-1");
      expect(part.meshNames).toEqual(["node-a"]);
      expect(part.materialName).toBe("steel");
    } finally {
      dispose();
    }
  });

  it("groups named transform nodes without consuming unrelated meshes", () => {
    const { scene, dispose } = createScene();
    try {
      const cluster = new TransformNode("screw-cluster", scene);
      const meshA = createBox(scene, "screw-a", "black");
      const meshB = createBox(scene, "screw-b", "silver");
      const meshC = createBox(scene, "plate", "aluminum");
      meshA.parent = cluster;
      meshB.parent = cluster;
      meshB.position.x = 2;
      meshC.position.x = 8;

      const candidates = createBabylonGroupedPartCandidates([meshA, meshB, meshC], [cluster]);

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
    } finally {
      dispose();
    }
  });

  it("promotes picked child meshes to their explicit converted component node", () => {
    const { scene, dispose } = createScene();
    try {
      const component = new TransformNode("U4", scene);
      component.metadata = {
        ai3dPartId: "component-U4",
        componentPath: "PCB/U4",
      };
      const meshA = createBox(scene, "U4->0_primitive0", "plastic");
      const meshB = createBox(scene, "U4->0_primitive1", "copper");
      const other = createBox(scene, "board", "fr4");
      meshA.parent = component;
      meshB.parent = component;

      const selected = findBabylonSelectablePartNode(meshA, meshA, [meshA, meshB, other]);
      const part = createBabylonNodePartPreviewSummary(selected, [meshA, meshB, other]);

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
    } finally {
      dispose();
    }
  });

  it("prefers an ancestor registered component over smaller named surface groups", () => {
    const { scene, dispose } = createScene();
    try {
      const root = new Mesh("__root__", scene);
      const component = new TransformNode("J1", scene);
      component.parent = root;
      component.metadata = {
        ai3dPartId: "component-J1",
        componentPath: "PCB/J1",
      };
      const surfaceGroup = new TransformNode("terminal-face-cluster", scene);
      surfaceGroup.parent = component;
      const meshA = createBox(scene, "J1->0_primitive0", "plastic");
      const meshB = createBox(scene, "J1->0_primitive1", "plastic");
      const other = createBox(scene, "board", "fr4");
      meshA.parent = surfaceGroup;
      meshB.parent = surfaceGroup;
      other.parent = root;

      const selected = findBabylonSelectablePartNode(root, meshA, [meshA, meshB, other]);

      expect(selected).toBe(component);
    } finally {
      dispose();
    }
  });

  it("skips generated converted mesh bucket identities when a parent component exists", () => {
    const { scene, dispose } = createScene();
    try {
      const root = new Mesh("__root__", scene);
      const component = new TransformNode("CN1", scene);
      component.parent = root;
      component.metadata = {
        ai3d: {
          partId: "CN1",
          componentId: "CN1",
          occurrenceId: "CN1",
          componentPath: "CN1",
          displayName: "CN1",
        },
      };
      const meshBucket = new TransformNode("CN1->0", scene);
      meshBucket.parent = component;
      meshBucket.metadata = {
        ai3d: {
          partId: "CN1-_0",
          componentId: "CN1-_0",
          occurrenceId: "CN1-_0",
          componentPath: "CN1-_0",
          displayName: "CN1-_0",
        },
      };
      const meshA = createBox(scene, "CN1->0_primitive0", "plastic");
      const meshB = createBox(scene, "CN1->0_primitive1", "plastic");
      const other = createBox(scene, "board", "fr4");
      meshA.parent = meshBucket;
      meshB.parent = meshBucket;
      other.parent = root;

      const selected = findBabylonSelectablePartNode(root, meshA, [meshA, meshB, other]);
      const part = createBabylonNodePartPreviewSummary(selected, [meshA, meshB, other]);

      expect(selected).toBe(component);
      expect(part).toMatchObject({
        name: "CN1",
        componentId: "CN1",
        childCount: 2,
      });
    } finally {
      dispose();
    }
  });

  it("creates disassembly parts at component scope so moving a component moves all child meshes", () => {
    const { scene, dispose } = createScene();
    try {
      const root = new Mesh("__root__", scene);
      const component = new TransformNode("CN1", scene);
      component.parent = root;
      component.metadata = {
        ai3d: {
          partId: "CN1",
          componentId: "CN1",
          occurrenceId: "CN1",
          componentPath: "CN1",
          displayName: "CN1",
        },
      };
      const meshBucket = new TransformNode("CN1->0", scene);
      meshBucket.parent = component;
      meshBucket.metadata = {
        ai3d: {
          partId: "CN1-_0",
          componentId: "CN1-_0",
          occurrenceId: "CN1-_0",
          componentPath: "CN1-_0",
          displayName: "CN1-_0",
        },
      };
      const meshA = createBox(scene, "CN1->0_primitive0", "plastic");
      const meshB = createBox(scene, "CN1->0_primitive1", "plastic");
      const other = createBox(scene, "board", "fr4");
      meshB.position.x = 2;
      other.position.x = 8;
      meshA.parent = meshBucket;
      meshB.parent = meshBucket;
      other.parent = root;

      const parts = createBabylonDisassemblyParts(root, [meshA, meshB, other]);
      const componentPart = parts.find((part) => part.node === component);
      expect(componentPart?.meshes).toEqual([meshA, meshB]);

      const before = getBabylonMeshesPreviewBounds(componentPart?.meshes ?? []);
      component.position.x = 5;
      component.computeWorldMatrix(true);
      meshA.computeWorldMatrix(true);
      meshB.computeWorldMatrix(true);
      const after = getBabylonMeshesPreviewBounds(componentPart?.meshes ?? []);

      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(after!.min.x - before!.min.x).toBeCloseTo(5);
      expect(after!.max.x - before!.max.x).toBeCloseTo(5);
    } finally {
      dispose();
    }
  });

  it("summarizes Babylon mesh counts through the existing model summary contract", () => {
    const { scene, dispose } = createScene();
    try {
      const meshA = createBox(scene, "body", "mat-a");
      const meshB = createBox(scene, "pin", "mat-b");
      meshB.position.x = 2;

      const summary = createBabylonModelPreviewSummary(
        "assembly",
        getBabylonMeshPreviewBounds(meshA),
        [meshA, meshB],
        { resourceWarnings: ["missing texture"] },
      );

      expect(summary.rootName).toBe("assembly");
      expect(summary.meshCount).toBe(2);
      expect(summary.triangleCount).toBe(24);
      expect(summary.vertexCount).toBe(48);
      expect(summary.materialCount).toBe(2);
      expect(summary.resourceWarnings).toEqual(["missing texture"]);
    } finally {
      dispose();
    }
  });
});
