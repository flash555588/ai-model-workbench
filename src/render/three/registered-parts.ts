import { Vector3, type Object3D } from "three";
import { createThreeObjectPartPreviewSummary, getThreeObjectDisplayName, getThreeObjectPreviewBounds, isThreeMesh, type ThreeRenderableObject } from "./mesh-preview";
import type { RegisteredPartCandidate, RegisteredPartGeometry } from "../preview/registered-parts";

export function collectThreeRegisteredPartGeometry(
  root: Object3D, objects: readonly ThreeRenderableObject[],
): { geometries: RegisteredPartGeometry[]; candidates: RegisteredPartCandidate[] } {
  const keys = new Map(objects.map(object => [object, object.uuid]));
  // root.traverse() and the renderer's renderable list have parent-first order.
  const geometries = objects.map((object): RegisteredPartGeometry => {
    const position = object.position.clone();
    const bounds = getThreeObjectPreviewBounds(object);
    const worldPosition = object.getWorldPosition(new Vector3());
    const visible = object.visible;
    const layers = object.layers.mask;
    return {
      key: object.uuid, names: [object.name, getThreeObjectDisplayName(object, object.name)], bounds, visible,
      setOffset(offset) {
        const target = worldPosition.clone().add(new Vector3(offset.x, offset.y, offset.z));
        object.position.copy(object.parent ? object.parent.worldToLocal(target) : target);
        object.updateWorldMatrix(false, true);
      },
      // Layers suppress this object's draw/pick without hiding its children.
      setVisible(value) { object.layers.mask = value ? layers : 0; },
      restore() { object.position.copy(position); object.visible = visible; object.layers.mask = layers; object.updateWorldMatrix(false, true); },
    };
  });
  const meshObjects = objects.filter(isThreeMesh);
  const candidates: RegisteredPartCandidate[] = [];
  root.traverse(node => {
    const children: ThreeRenderableObject[] = [];
    if (keys.has(node as ThreeRenderableObject)) children.push(node as ThreeRenderableObject);
    else node.traverse(child => { if (keys.has(child as ThreeRenderableObject)) children.push(child as ThreeRenderableObject); });
    if (children.length) candidates.push({ identity: createThreeObjectPartPreviewSummary(node, root, meshObjects), meshKeys: children.map(child => keys.get(child)!) });
  });
  return { geometries, candidates };
}
