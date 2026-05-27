import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Nullable } from "@babylonjs/core/types.js";
import type { Node } from "@babylonjs/core/node.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Ray } from "@babylonjs/core/Culling/ray.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import "@babylonjs/core/Rendering/boundingBoxRenderer.js";
import {
  applyPreviewRotationDrag,
  createPreviewPlane,
  createPreviewLineOfSight,
  intersectPreviewRayWithPlane,
  isPreviewHitOccluded,
  type PreviewPlane,
  toPreviewQuaternion,
  toPreviewWorldPoint,
} from "../preview/geometry";
import {
  createPreviewDisassemblyController,
  type PreviewDisassemblyAdapter,
  type PreviewDisassemblyController,
  type PreviewDisassemblySubscriptions,
} from "../preview/disassembly";

interface PartTransform {
  parent: Nullable<Node>;
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: AbstractMesh["rotationQuaternion"];
  scaling: Vector3;
}

interface DragState {
  mesh: AbstractMesh;
  mode: "move" | "rotate";
  plane: PreviewPlane;
  startPoint: Vector3;
  startPosition: Vector3;
  startRotationQuaternion: AbstractMesh["rotationQuaternion"];
  pivot: Vector3;
  pointerX: number;
  pointerY: number;
}

class BabylonDisassemblyAdapter
  implements PreviewDisassemblyAdapter<AbstractMesh, PartTransform, DragState> {
  private static readonly BBOX_VISIBLE = new Color3(0.25, 0.7, 1);
  private static readonly BBOX_OCCLUDED = new Color3(0.1, 0.25, 0.4);

  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly meshes: AbstractMesh[];
  private readonly occlusionDirection = Vector3.Zero();
  private readonly occlusionRay = new Ray(Vector3.Zero(), Vector3.Zero(), 1);
  private lastOccluded = false;
  private selected: AbstractMesh | null = null;
  private partPointerActive = false;
  private activePointerId: number | null = null;

  constructor(scene: Scene, camera: ArcRotateCamera, meshes: AbstractMesh[]) {
    this.scene = scene;
    this.camera = camera;
    this.meshes = meshes;
    this.setBoundingBoxColor(BabylonDisassemblyAdapter.BBOX_VISIBLE);
  }

  getParts(): readonly AbstractMesh[] {
    return this.meshes;
  }

  getPartId(part: AbstractMesh): number {
    return part.uniqueId;
  }

  isDisposed(part: AbstractMesh): boolean {
    return part.isDisposed();
  }

  captureTransform(part: AbstractMesh): PartTransform {
    return {
      parent: part.parent,
      position: part.position.clone(),
      rotation: part.rotation.clone(),
      rotationQuaternion: part.rotationQuaternion?.clone() ?? null,
      scaling: part.scaling.clone(),
    };
  }

  restoreTransform(part: AbstractMesh, transform: PartTransform): void {
    part.setParent(transform.parent);
    part.position.copyFrom(transform.position);
    part.rotation.copyFrom(transform.rotation);
    part.rotationQuaternion = transform.rotationQuaternion?.clone() ?? null;
    part.scaling.copyFrom(transform.scaling);
    part.computeWorldMatrix(true);
  }

  subscribe(subscriptions: PreviewDisassemblySubscriptions): () => void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    canvas?.classList.add("ai3d-disassembly-active");

    const pointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
      const event = pointerInfo.event as PointerEvent;
      if (event.isPrimary === false) return;
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        if (event.button !== 0) return;
        const target = pointerInfo.pickInfo?.pickedMesh ?? null;
        this.partPointerActive = !!this.resolvePart(target);
        if (this.partPointerActive) {
          event.preventDefault();
          event.stopPropagation();
          this.activePointerId = event.pointerId;
          try {
            canvas?.setPointerCapture?.(event.pointerId);
          } catch {
            // Synthetic verification events may not be active pointer captures.
          }
          this.camera.detachControl();
        }
        subscriptions.onPointerDown(target, event);
      } else if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
        if (this.partPointerActive) {
          event.preventDefault();
          event.stopPropagation();
        }
        subscriptions.onPointerMove(event);
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
        if (this.partPointerActive) {
          event.preventDefault();
          event.stopPropagation();
        }
        subscriptions.onPointerUp(event);
        if (this.activePointerId !== null && canvas?.hasPointerCapture?.(this.activePointerId)) {
          try {
            canvas.releasePointerCapture(this.activePointerId);
          } catch {
            // Pointer capture may already be gone after canceled touch/pointer sequences.
          }
        }
        this.partPointerActive = false;
        this.activePointerId = null;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
      }
    });
    const renderObserver = this.scene.onAfterRenderCameraObservable.add((camera) => {
      if (camera === this.camera) {
        subscriptions.onRender();
      }
    });

    return () => {
      this.scene.onPointerObservable.remove(pointerObserver);
      this.scene.onAfterRenderCameraObservable.remove(renderObserver);
      canvas?.classList.remove("ai3d-disassembly-active", "ai3d-disassembly-dragging");
      if (this.activePointerId !== null && canvas?.hasPointerCapture?.(this.activePointerId)) {
        try {
          canvas.releasePointerCapture(this.activePointerId);
        } catch {
          // Pointer capture may already be gone after canceled touch/pointer sequences.
        }
      }
      this.partPointerActive = false;
      this.activePointerId = null;
      this.camera.attachControl(canvas, true);
    };
  }

  resolvePart(target: unknown): AbstractMesh | null {
    if (!target || typeof target !== "object") return null;
    if (this.isMeshInSet(target as AbstractMesh)) {
      return target as AbstractMesh;
    }
    const parent = (target as AbstractMesh).parent;
    if (parent && "uniqueId" in parent && this.isMeshInSet(parent as AbstractMesh)) {
      return parent as AbstractMesh;
    }
    return null;
  }

  setSelected(part: AbstractMesh | null): void {
    if (this.selected && !this.selected.isDisposed()) {
      this.selected.showBoundingBox = false;
    }
    this.selected = part;
    this.lastOccluded = false;
    this.setBoundingBoxColor(BabylonDisassemblyAdapter.BBOX_VISIBLE);
    if (this.selected && !this.selected.isDisposed()) {
      this.selected.showBoundingBox = true;
    }
  }

  beginDrag(part: AbstractMesh, event: PointerEvent): DragState | null {
    const startPoint = this.getPointOnDragPlane(part, event);
    if (!startPoint) {
      return null;
    }

    event.preventDefault();
    event.stopPropagation();
    this.scene.getEngine().getRenderingCanvas()?.classList.add("ai3d-disassembly-dragging");

    part.setParent(null);
    part.computeWorldMatrix(true);

    if (event.shiftKey && !part.rotationQuaternion) {
      part.rotationQuaternion = Quaternion.FromEulerVector(part.rotation);
      part.rotation.set(0, 0, 0);
    }

    const pivot = part.getBoundingInfo().boundingBox.centerWorld.clone();
    const plane = createPreviewPlane(
      toPreviewWorldPoint(startPoint),
      toPreviewWorldPoint(this.camera.getForwardRay().direction),
    );
    if (!plane) {
      return null;
    }
    const dragState: DragState = {
      mesh: part,
      mode: event.shiftKey ? "rotate" : "move",
      plane,
      startPoint,
      startPosition: part.position.clone(),
      startRotationQuaternion: part.rotationQuaternion?.clone() ?? null,
      pivot,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };

    this.camera.detachControl();
    return dragState;
  }

  updateDrag(state: DragState, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (state.mode === "rotate") {
      this.updateRotation(state, event);
      return;
    }

    const point = this.getRayPlanePoint(event, state.plane);
    if (!point) return;

    const offset = point.subtract(state.startPoint);
    state.mesh.position = state.startPosition.add(offset);
    state.mesh.computeWorldMatrix(true);
  }

  endDrag(state: DragState | null): void {
    this.scene.getEngine().getRenderingCanvas()?.classList.remove("ai3d-disassembly-dragging");
    this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    if (!state) return;
  }

  updateSelectionOcclusion(part: AbstractMesh): void {
    const center = part.getBoundingInfo().boundingBox.centerWorld;
    const cameraPosition = this.camera.position;
    const lineOfSight = createPreviewLineOfSight(
      toPreviewWorldPoint(cameraPosition),
      toPreviewWorldPoint(center),
    );
    if (!lineOfSight) {
      return;
    }
    const direction = this.occlusionDirection;
    direction.set(
      lineOfSight.direction.x,
      lineOfSight.direction.y,
      lineOfSight.direction.z,
    );
    this.occlusionRay.origin = cameraPosition;
    this.occlusionRay.direction = direction;
    this.occlusionRay.length = lineOfSight.distance;
    const hit = this.scene.pickWithRay(this.occlusionRay);
    const occluded = !!hit?.hit
      && isPreviewHitOccluded(hit.distance, lineOfSight.distance, lineOfSight.epsilon);

    if (occluded !== this.lastOccluded) {
      this.lastOccluded = occluded;
      this.setBoundingBoxColor(
        occluded
          ? BabylonDisassemblyAdapter.BBOX_OCCLUDED
          : BabylonDisassemblyAdapter.BBOX_VISIBLE,
      );
    }
  }

  private isMeshInSet(mesh: AbstractMesh): boolean {
    return this.meshes.includes(mesh);
  }

  private setBoundingBoxColor(color: Color3): void {
    const renderer = this.scene.getBoundingBoxRenderer?.();
    if (!renderer) return;
    renderer.frontColor = color;
    renderer.backColor = color;
  }

  private updateRotation(state: DragState, event: PointerEvent): void {
    if (!state.startRotationQuaternion) {
      return;
    }
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    const result = applyPreviewRotationDrag({
      startPosition: toPreviewWorldPoint(state.startPosition),
      pivot: toPreviewWorldPoint(state.pivot),
      startRotationQuaternion: toPreviewQuaternion(state.startRotationQuaternion),
      yawAxis: toPreviewWorldPoint(this.camera.getDirection(Vector3.Up()).normalize()),
      pitchAxis: toPreviewWorldPoint(this.camera.getDirection(Vector3.Right()).normalize()),
      deltaX: dx,
      deltaY: dy,
      sensitivity: 0.01,
    });
    if (!result) {
      return;
    }
    state.mesh.position = new Vector3(result.position.x, result.position.y, result.position.z);
    state.mesh.rotationQuaternion = new Quaternion(
      result.rotationQuaternion.x,
      result.rotationQuaternion.y,
      result.rotationQuaternion.z,
      result.rotationQuaternion.w,
    );
    state.mesh.rotation.set(0, 0, 0);
    state.mesh.computeWorldMatrix(true);
  }

  private getPointOnDragPlane(mesh: AbstractMesh, event: PointerEvent): Vector3 | null {
    const center = mesh.getBoundingInfo().boundingBox.centerWorld.clone();
    const plane = createPreviewPlane(
      toPreviewWorldPoint(center),
      toPreviewWorldPoint(this.camera.getForwardRay().direction),
    );
    return plane ? this.getRayPlanePoint(event, plane) ?? center : center;
  }

  private getRayPlanePoint(event: PointerEvent, plane: PreviewPlane): Vector3 | null {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    const point = intersectPreviewRayWithPlane(
      {
        origin: toPreviewWorldPoint(ray.origin),
        direction: toPreviewWorldPoint(ray.direction),
      },
      plane,
    );
    return point ? new Vector3(point.x, point.y, point.z) : null;
  }
}

export function createBabylonDisassemblyController(
  scene: Scene,
  camera: ArcRotateCamera,
  meshes: AbstractMesh[],
): PreviewDisassemblyController {
  return createPreviewDisassemblyController(new BabylonDisassemblyAdapter(scene, camera, meshes));
}
