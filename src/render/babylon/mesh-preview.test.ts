import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { describe, expect, it } from "vitest";
import {
  collectBabylonGltfComponentMetadata,
  createBabylonGroupedPartCandidates,
  createBabylonModelPreviewSummary,
  createBabylonPartPreviewSummary,
  getBabylonMeshPreviewBounds,
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
