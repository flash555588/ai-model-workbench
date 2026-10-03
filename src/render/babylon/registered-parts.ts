import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { createBabylonNodePartPreviewSummary, getBabylonMeshPreviewBounds, type BabylonComponentMetadataMap } from "./mesh-preview";
import type { RegisteredPartCandidate, RegisteredPartGeometry } from "../preview/registered-parts";

export function collectBabylonRegisteredPartGeometry(
  meshes: readonly AbstractMesh[], nodes: readonly TransformNode[], metadata: BabylonComponentMetadataMap,
): { geometries: RegisteredPartGeometry[]; candidates: RegisteredPartCandidate[] } {
  const depth = (mesh: AbstractMesh): number => { let count = 0; for (let parent = mesh.parent; parent; parent = parent.parent) count++; return count; };
  const ordered = [...meshes].sort((a, b) => depth(a) - depth(b));
  const keys = new Map(meshes.map(mesh => [mesh, String(mesh.uniqueId)]));
  const geometries = ordered.map((mesh): RegisteredPartGeometry => {
    const position = mesh.position.clone();
    const bounds = getBabylonMeshPreviewBounds(mesh);
    const worldPosition = mesh.getAbsolutePosition().clone();
    const visible = mesh.isVisible;
    return {
      key: keys.get(mesh)!, names: [mesh.name], bounds, visible,
      setOffset(offset) {
        const target = worldPosition.add(new Vector3(offset.x, offset.y, offset.z));
        const parent = mesh.parent as TransformNode | null;
        mesh.position.copyFrom(parent ? Vector3.TransformCoordinates(target, parent.computeWorldMatrix(true).clone().invert()) : target);
        mesh.computeWorldMatrix(true);
      },
      setVisible(value) { mesh.isVisible = value; },
      restore() { if (mesh.isDisposed()) return; mesh.position.copyFrom(position); mesh.isVisible = visible; mesh.computeWorldMatrix(true); },
    };
  });
  const candidates = [...meshes, ...nodes].map(node => {
    const children = keys.has(node as AbstractMesh) ? [node as AbstractMesh] : node.getChildMeshes(false).filter(mesh => keys.has(mesh));
    return { identity: children.length ? createBabylonNodePartPreviewSummary(node, meshes, metadata) : {}, meshKeys: children.map(mesh => keys.get(mesh)!) };
  }).filter(candidate => candidate.meshKeys.length > 0);
  return { geometries, candidates };
}
