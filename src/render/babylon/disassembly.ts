import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
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
  findBabylonSelectablePartNode,
  getBabylonMeshesPreviewBounds,
  type BabylonComponentMetadataMap,
  type BabylonSelectablePartNode,
} from "./mesh-preview";
import {
  createPreviewDisassemblyController,
  type PreviewDisassemblyAdapter,
  type PreviewDisassemblyController,
  type PreviewDisassemblySubscriptions,
} from "../preview/disassembly";

export interface BabylonDisassemblyPart {
  id: number;
  node: BabylonSelectablePartNode;
  meshes: AbstractMesh[];
}

interface PartTransform {
  parent: Nullable<Node>;
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: Quaternion | null;
  scaling: Vector3;
}

interface DragState {
  part: BabylonDisassemblyPart;
  mode: "move" | "rotate";
  plane: PreviewPlane;
  startPoint: Vector3;
  startPosition: Vector3;
  startRotationQuaternion: Quaternion | null;
  pivot: Vector3;
  pointerX: number;
  pointerY: number;
}

function isBabylonDisassemblyPart(value: unknown): value is BabylonDisassemblyPart {
  return !!value && typeof value === "object" && "node" in value && "meshes" in value;
}

function getNodeUniqueId(node: BabylonSelectablePartNode): number {
  return (node as TransformNode).uniqueId;
}

function isNodeDisposed(node: BabylonSelectablePartNode): boolean {
  return typeof node.isDisposed === "function" ? node.isDisposed() : false;
}

function getPartCenter(part: BabylonDisassemblyPart): Vector3 {
  const bounds = getBabylonMeshesPreviewBounds(part.meshes);
  if (!bounds) {
    return part.node.getAbsolutePosition().clone();
  }
  return new Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  );
}

export function createBabylonDisassemblyParts(
  root: AbstractMesh,
  meshes: readonly AbstractMesh[],
  componentMetadata?: BabylonComponentMetadataMap,
): BabylonDisassemblyPart[] {
  const byNode = new Map<BabylonSelectablePartNode, BabylonDisassemblyPart>();
  for (const mesh of meshes) {
    const node = findBabylonSelectablePartNode(root, mesh, meshes, componentMetadata);
    let part = byNode.get(node);
    if (!part) {
      part = { id: getNodeUniqueId(node), node, meshes: [] };
      byNode.set(node, part);
    }
    part.meshes.push(mesh);
  }
  return Array.from(byNode.values());
}

class BabylonDisassemblyAdapter
  implements PreviewDisassemblyAdapter<BabylonDisassemblyPart, PartTransform, DragState> {
  private static readonly BBOX_VISIBLE = new Color3(0.25, 0.7, 1);
  private static readonly BBOX_OCCLUDED = new Color3(0.1, 0.25, 0.4);

  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly meshes: AbstractMesh[];
  private readonly parts: BabylonDisassemblyPart[];
  private readonly meshToPart = new Map<number, BabylonDisassemblyPart>();
  private readonly occlusionDirection = Vector3.Zero();
  private readonly occlusionRay = new Ray(Vector3.Zero(), Vector3.Zero(), 1);
  private lastOccluded = false;
  private selected: BabylonDisassemblyPart | null = null;
  private partPointerActive = false;
  private activePointerId: number | null = null;

  constructor(
    scene: Scene,
    camera: ArcRotateCamera,
    root: AbstractMesh,
    meshes: AbstractMesh[],
    componentMetadata?: BabylonComponentMetadataMap,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.meshes = meshes;
    this.parts = createBabylonDisassemblyParts(root, meshes, componentMetadata);
    for (const part of this.parts) {
      for (const mesh of part.meshes) {
        this.meshToPart.set(mesh.uniqueId, part);
      }
    }
    this.setBoundingBoxColor(BabylonDisassemblyAdapter.BBOX_VISIBLE);
  }

  getParts(): readonly BabylonDisassemblyPart[] {
    return this.parts;
  }

  getPartId(part: BabylonDisassemblyPart): number {
    return part.id;
  }

  isDisposed(part: BabylonDisassemblyPart): boolean {
    return isNodeDisposed(part.node) || part.meshes.every((mesh) => mesh.isDisposed());
  }

  captureTransform(part: BabylonDisassemblyPart): PartTransform {
    return {
      parent: part.node.parent,
      position: part.node.position.clone(),
      rotation: part.node.rotation.clone(),
      rotationQuaternion: part.node.rotationQuaternion?.clone() ?? null,
      scaling: part.node.scaling.clone(),
    };
  }

  restoreTransform(part: BabylonDisassemblyPart, transform: PartTransform): void {
    part.node.setParent(transform.parent);
    part.node.position.copyFrom(transform.position);
    part.node.rotation.copyFrom(transform.rotation);
    part.node.rotationQuaternion = transform.rotationQuaternion?.clone() ?? null;
    part.node.scaling.copyFrom(transform.scaling);
    part.node.computeWorldMatrix(true);
    for (const mesh of part.meshes) {
      mesh.computeWorldMatrix(true);
    }
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

  resolvePart(target: unknown): BabylonDisassemblyPart | null {
    if (isBabylonDisassemblyPart(target)) {
      return this.parts.includes(target) ? target : null;
    }
    if (!target || typeof target !== "object") return null;
    return this.meshToPart.get((target as AbstractMesh).uniqueId) ?? null;
  }

  setSelected(part: BabylonDisassemblyPart | null): void {
    if (this.selected) {
      for (const mesh of this.selected.meshes) {
        if (!mesh.isDisposed()) {
          mesh.showBoundingBox = false;
        }
      }
    }
    this.selected = part;
    this.lastOccluded = false;
    this.setBoundingBoxColor(BabylonDisassemblyAdapter.BBOX_VISIBLE);
    if (this.selected && !this.isDisposed(this.selected)) {
      for (const mesh of this.selected.meshes) {
        if (!mesh.isDisposed()) {
          mesh.showBoundingBox = true;
        }
      }
    }
  }

  beginDrag(part: BabylonDisassemblyPart, event: PointerEvent): DragState | null {
    const startPoint = this.getPointOnDragPlane(part, event);
    if (!startPoint) {
      return null;
    }

    event.preventDefault();
    event.stopPropagation();
    this.scene.getEngine().getRenderingCanvas()?.classList.add("ai3d-disassembly-dragging");

    part.node.setParent(null);
    part.node.computeWorldMatrix(true);
    for (const mesh of part.meshes) {
      mesh.computeWorldMatrix(true);
    }

    if (event.shiftKey && !part.node.rotationQuaternion) {
      part.node.rotationQuaternion = Quaternion.FromEulerVector(part.node.rotation);
      part.node.rotation.set(0, 0, 0);
    }

    const pivot = getPartCenter(part);
    const plane = createPreviewPlane(
      toPreviewWorldPoint(startPoint),
      toPreviewWorldPoint(this.camera.getForwardRay().direction),
    );
    if (!plane) {
      return null;
    }
    const dragState: DragState = {
      part,
      mode: event.shiftKey ? "rotate" : "move",
      plane,
      startPoint,
      startPosition: part.node.position.clone(),
      startRotationQuaternion: part.node.rotationQuaternion?.clone() ?? null,
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
    state.part.node.position = state.startPosition.add(offset);
    state.part.node.computeWorldMatrix(true);
    for (const mesh of state.part.meshes) {
      mesh.computeWorldMatrix(true);
    }
  }

  endDrag(state: DragState | null): void {
    this.scene.getEngine().getRenderingCanvas()?.classList.remove("ai3d-disassembly-dragging");
    this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    if (!state) return;
  }

  updateSelectionOcclusion(part: BabylonDisassemblyPart): void {
    const center = getPartCenter(part);
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
    state.part.node.position = new Vector3(result.position.x, result.position.y, result.position.z);
    state.part.node.rotationQuaternion = new Quaternion(
      result.rotationQuaternion.x,
      result.rotationQuaternion.y,
      result.rotationQuaternion.z,
      result.rotationQuaternion.w,
    );
    state.part.node.rotation.set(0, 0, 0);
    state.part.node.computeWorldMatrix(true);
    for (const mesh of state.part.meshes) {
      mesh.computeWorldMatrix(true);
    }
  }

  private getPointOnDragPlane(part: BabylonDisassemblyPart, event: PointerEvent): Vector3 | null {
    const center = getPartCenter(part);
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
  root: AbstractMesh,
  meshes: AbstractMesh[],
  componentMetadata?: BabylonComponentMetadataMap,
): PreviewDisassemblyController {
  return createPreviewDisassemblyController(
    new BabylonDisassemblyAdapter(scene, camera, root, meshes, componentMetadata),
  );
}
