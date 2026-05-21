import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Vector3 as BVector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { HighlightLayer } from "@babylonjs/core/Layers/highlightLayer.js";
import "@babylonjs/core/Layers/effectLayerSceneComponent.js";

export interface PickResult {
  mesh: AbstractMesh | null;
  pickedPoint: BVector3 | null;
  /** Screen coordinates from the pointer event (clientX, clientY). */
  screenX: number;
  screenY: number;
}

/**
 * Set up click-to-pick on a scene using onPointerObservable.
 * Uses a HighlightLayer so picking never mutates or replaces model materials.
 * Returns a cleanup function.
 */
export function setupPicking(
  scene: Scene,
  onPick: (result: PickResult) => void,
  shouldHighlight: () => boolean = () => true,
): () => void {
  const highlightLayer = new HighlightLayer("ai3d-pick-highlight", scene);
  const highlightColor = new Color3(0.15, 0.45, 1.0);
  let outlinedMesh: AbstractMesh | null = null;

  function clearHighlight() {
    highlightLayer.removeAllMeshes();
    if (outlinedMesh && !outlinedMesh.isDisposed()) {
      outlinedMesh.renderOutline = false;
      outlinedMesh.outlineWidth = 0;
    }
    outlinedMesh = null;
  }

  function applyHighlight(mesh: AbstractMesh) {
    if (mesh.isDisposed()) return;
    // @ts-expect-error Babylon HighlightLayer accepts AbstractMesh at runtime.
    highlightLayer.addMesh(mesh as unknown, highlightColor);
    mesh.renderOutline = true;
    mesh.outlineColor = highlightColor;
    mesh.outlineWidth = 0.045;
    outlinedMesh = mesh;
  }

  const observer = scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;

    const evt = pointerInfo.event as PointerEvent;
    const screenX = evt.clientX;
    const screenY = evt.clientY;

    clearHighlight();
    const pickInfo = pointerInfo.pickInfo;
    if (pickInfo?.hit && pickInfo.pickedMesh) {
      if (shouldHighlight()) {
        applyHighlight(pickInfo.pickedMesh);
      }
      onPick({ mesh: pickInfo.pickedMesh, pickedPoint: pickInfo.pickedPoint ?? null, screenX, screenY });
    } else {
      onPick({ mesh: null, pickedPoint: null, screenX, screenY });
    }
  });

  return () => {
    clearHighlight();
    highlightLayer.dispose();
    scene.onPointerObservable.remove(observer);
  };
}
