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
  modifiers?: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
}

export interface PickingCleanup {
  (): void;
  clearHighlight(): void;
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
  resolveHighlightMeshes: (mesh: AbstractMesh) => readonly AbstractMesh[] = (mesh) => [mesh],
): PickingCleanup {
  const highlightLayer = new HighlightLayer("ai3d-pick-highlight", scene);
  const highlightColor = new Color3(0.15, 0.45, 1.0);
  let outlinedMeshes: AbstractMesh[] = [];

  function clearHighlight() {
    highlightLayer.removeAllMeshes();
    for (const outlinedMesh of outlinedMeshes) {
      if (!outlinedMesh.isDisposed()) {
        outlinedMesh.renderOutline = false;
        outlinedMesh.outlineWidth = 0;
      }
    }
    outlinedMeshes = [];
  }

  function applyHighlight(meshes: readonly AbstractMesh[]) {
    outlinedMeshes = meshes.filter((mesh) => !mesh.isDisposed());
    for (const mesh of outlinedMeshes) {
      // @ts-expect-error Babylon HighlightLayer accepts AbstractMesh at runtime.
      highlightLayer.addMesh(mesh as unknown, highlightColor);
      mesh.renderOutline = true;
      mesh.outlineColor = highlightColor;
      mesh.outlineWidth = 0.045;
    }
  }

  const observer = scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;

    const evt = pointerInfo.event as PointerEvent;
    const screenX = evt.clientX;
    const screenY = evt.clientY;
    const modifiers = {
      altKey: evt.altKey,
      ctrlKey: evt.ctrlKey,
      metaKey: evt.metaKey,
      shiftKey: evt.shiftKey,
    };

    const pickInfo = pointerInfo.pickInfo;
    if (pickInfo?.hit && pickInfo.pickedMesh) {
      if (shouldHighlight()) {
        const highlightMeshes = resolveHighlightMeshes(pickInfo.pickedMesh).filter((mesh) => !mesh.isDisposed());
        const sameHighlight = outlinedMeshes.length === highlightMeshes.length
          && outlinedMeshes.every((mesh, index) => mesh === highlightMeshes[index]);
        if (!sameHighlight) {
          clearHighlight();
          applyHighlight(highlightMeshes);
        }
      } else {
        clearHighlight();
      }
      onPick({ mesh: pickInfo.pickedMesh, pickedPoint: pickInfo.pickedPoint ?? null, screenX, screenY, modifiers });
    } else {
      clearHighlight();
      onPick({ mesh: null, pickedPoint: null, screenX, screenY, modifiers });
    }
  });

  const cleanup = (() => {
    clearHighlight();
    highlightLayer.dispose();
    scene.onPointerObservable.remove(observer);
  }) as PickingCleanup;
  cleanup.clearHighlight = clearHighlight;
  return cleanup;
}
