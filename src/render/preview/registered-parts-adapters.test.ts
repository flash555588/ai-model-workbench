import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 as ThreeVector3 } from "three";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { collectThreeRegisteredPartGeometry } from "../three/registered-parts";
import { collectBabylonRegisteredPartGeometry } from "../babylon/registered-parts";

describe("registered part geometry adapters", () => {
  it("translates nested rotated/scaled Three nodes in world space and hides a parent without hiding its child", () => {
    const root = new Group(); const wrapper = new Group();
    wrapper.scale.set(2, 3, 4); wrapper.rotation.z = 0.7; root.add(wrapper);
    const geometry = new BoxGeometry(); const material = new MeshBasicMaterial();
    const parent = new Mesh(geometry, material); parent.name = "shell"; parent.position.set(2, 1, -1); wrapper.add(parent);
    const child = new Mesh(geometry, material); child.name = "pin"; child.position.set(0.5, 2, 1); parent.add(child);
    root.updateWorldMatrix(true, true);
    const before = [parent, child].map(mesh => mesh.getWorldPosition(new ThreeVector3()));
    const local = [parent, child].map(mesh => mesh.position.clone());
    const collected = collectThreeRegisteredPartGeometry(root, [parent, child]);
    const offset = { x: 5, y: 2, z: -3 };
    for (const target of collected.geometries) target.setOffset(offset);
    for (const [index, mesh] of [parent, child].entries()) {
      expect(mesh.getWorldPosition(new ThreeVector3()).distanceTo(before[index].clone().add(new ThreeVector3(5, 2, -3)))).toBeLessThan(1e-10);
    }
    collected.geometries[0].setVisible(false);
    expect(parent.visible).toBe(true); expect(parent.layers.mask).toBe(0); expect(child.layers.mask).toBe(1);
    for (const target of collected.geometries) target.restore();
    expect(parent.position.equals(local[0])).toBe(true); expect(child.position.equals(local[1])).toBe(true); expect(parent.layers.mask).toBe(1);
    geometry.dispose(); material.dispose();
  });
  it("translates Babylon parent/child geometry once and restores the original local coordinates", () => {
    const engine = new NullEngine(); const scene = new Scene(engine);
    try {
      const wrapper = new TransformNode("wrapper", scene); wrapper.scaling.set(2, 3, 4); wrapper.rotation.z = 0.7;
      const parent = MeshBuilder.CreateBox("shell", {}, scene); parent.parent = wrapper; parent.position.set(2, 1, -1);
      const child = MeshBuilder.CreateBox("pin", {}, scene); child.parent = parent; child.position.set(0.5, 2, 1);
      parent.computeWorldMatrix(true); child.computeWorldMatrix(true);
      const before = [parent, child].map(mesh => mesh.getAbsolutePosition().clone());
      const local = [parent, child].map(mesh => mesh.position.clone());
      const { geometries } = collectBabylonRegisteredPartGeometry([child, parent], [wrapper], new Map());
      for (const target of geometries) target.setOffset({ x: 5, y: 2, z: -3 });
      for (const [index, mesh] of [parent, child].entries()) {
        const after = mesh.getAbsolutePosition();
        expect(after.x - before[index].x).toBeCloseTo(5, 5);
        expect(after.y - before[index].y).toBeCloseTo(2, 5);
        expect(after.z - before[index].z).toBeCloseTo(-3, 5);
      }
      for (const target of geometries) target.restore();
      expect(parent.position.equals(local[0])).toBe(true); expect(child.position.equals(local[1])).toBe(true);
    } finally { scene.dispose(); engine.dispose(); }
  });
});
