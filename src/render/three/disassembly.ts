import type { Camera, Scene } from "three";
import {
  Box3,
  BoxHelper,
  Color,
  Mesh,
  Object3D,
  Quaternion as ThreeQuaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import {
  applyPreviewRotationDrag,
  createPreviewLineOfSight,
  createPreviewPlane,
  intersectPreviewRayWithPlane,
  isPreviewHitOccluded,
  toPreviewQuaternion,
  toPreviewWorldPoint,
  type PreviewPlane,
} from "../preview/geometry";
import {
  createPreviewDisassemblyController,
  type PreviewDisassemblyAdapter,
  type PreviewDisassemblyController,
  type PreviewDisassemblySubscriptions,
} from "../preview/disassembly";
import {
  createThreeChildRenderableMeshMap,
  findThreeSelectablePartObject,
  type ThreeChildRenderableMeshMap,
} from "./mesh-preview";

export interface ThreeDisassemblyPart {
  id: number;
  object: Object3D;
  meshes: Mesh[];
}

interface PartTransform {
  parent: Object3D | null;
  position: Vector3;
  quaternion: ThreeQuaternion;
  scale: Vector3;
}

interface DragState {
  part: ThreeDisassemblyPart;
  mode: "move" | "rotate";
  plane: PreviewPlane;
  startPoint: Vector3;
  startPosition: Vector3;
  startQuaternion: ThreeQuaternion;
  pivot: Vector3;
  pointerX: number;
  pointerY: number;
}

function isThreeDisassemblyPart(value: unknown): value is ThreeDisassemblyPart {
  return !!value && typeof value === "object" && "object" in value && "meshes" in value;
}

export function createThreeDisassemblyParts(
  root: Object3D,
  meshes: readonly Mesh[],
  childMeshMap: ThreeChildRenderableMeshMap = createThreeChildRenderableMeshMap(root, meshes),
): ThreeDisassemblyPart[] {
  const byObject = new Map<Object3D, ThreeDisassemblyPart>();
  for (const mesh of meshes) {
    const object = findThreeSelectablePartObject(root, mesh, meshes, childMeshMap);
    let part = byObject.get(object);
    if (!part) {
      part = { id: object.id, object, meshes: [] };
      byObject.set(object, part);
    }
    part.meshes.push(mesh);
  }
  return Array.from(byObject.values());
}

export function attachObjectToScenePreservingWorldTransform(scene: Scene, object: Object3D): void {
  scene.updateMatrixWorld(true);
  object.parent?.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  scene.attach(object);
  object.updateMatrixWorld(true);
}

const BBOX_VISIBLE = new Color(0x4a9eff);
const BBOX_OCCLUDED = new Color(0x1a4a6e);

class ThreeDisassemblyAdapter
  implements PreviewDisassemblyAdapter<ThreeDisassemblyPart, PartTransform, DragState> {

  private readonly scene: Scene;
  private readonly camera: Camera & { position: Vector3 };
  private readonly canvas: HTMLCanvasElement;
  private readonly meshes: Mesh[];
  private readonly parts: ThreeDisassemblyPart[];
  private readonly meshToPart = new Map<number, ThreeDisassemblyPart>();
  private readonly controls: { enabled: boolean };
  private readonly invalidate: () => void;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly tempBox = new Box3();
  private readonly tempCenter = new Vector3();
  private readonly tempDirection = new Vector3();
  private readonly tempCameraForward = new Vector3();
  private readonly tempCameraRight = new Vector3();
  private readonly tempCameraUp = new Vector3();
  private selectionHelper: BoxHelper | null = null;
  private lastOccluded = false;
  private selected: ThreeDisassemblyPart | null = null;
  private lastPointerDown: { x: number; y: number } | null = null;
  private partPointerActive = false;
  private activePointerId: number | null = null;

  constructor(
    scene: Scene,
    camera: Camera & { position: Vector3 },
    canvas: HTMLCanvasElement,
    root: Object3D,
    meshes: Mesh[],
    controls: { enabled: boolean },
    requestRender: () => void,
    childMeshMap: ThreeChildRenderableMeshMap = createThreeChildRenderableMeshMap(root, meshes),
  ) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.meshes = meshes;
    this.parts = createThreeDisassemblyParts(root, meshes, childMeshMap);
    for (const part of this.parts) {
      for (const mesh of part.meshes) {
        this.meshToPart.set(mesh.id, part);
      }
    }
    this.controls = controls;
    this.invalidate = requestRender;
  }

  requestRender(): void {
    this.invalidate();
  }

  getParts(): readonly ThreeDisassemblyPart[] {
    return this.parts;
  }

  getPartId(part: ThreeDisassemblyPart): number {
    return part.id;
  }

  isDisposed(part: ThreeDisassemblyPart): boolean {
    return !part.object.parent && !this.scene.children.includes(part.object);
  }

  captureTransform(part: ThreeDisassemblyPart): PartTransform {
    return {
      parent: part.object.parent,
      position: part.object.position.clone(),
      quaternion: part.object.quaternion.clone(),
      scale: part.object.scale.clone(),
    };
  }

  restoreTransform(part: ThreeDisassemblyPart, transform: PartTransform): void {
    if (transform.parent) {
      transform.parent.add(part.object);
    } else {
      this.scene.add(part.object);
    }
    part.object.position.copy(transform.position);
    part.object.quaternion.copy(transform.quaternion);
    part.object.scale.copy(transform.scale);
    part.object.updateMatrixWorld(true);
    this.requestRender();
  }

  subscribe(subscriptions: PreviewDisassemblySubscriptions): () => void {
    this.canvas.classList.add("ai3d-disassembly-active");

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      this.lastPointerDown = { x: event.clientX, y: event.clientY };
      const target = this.resolvePickTarget(event);
      this.partPointerActive = !!target;
      if (this.partPointerActive) {
        event.preventDefault();
        event.stopPropagation();
        this.controls.enabled = false;
        this.activePointerId = event.pointerId;
        try {
          this.canvas.setPointerCapture?.(event.pointerId);
        } catch {
          // Synthetic verification events may not be active pointer captures.
        }
      }
      subscriptions.onPointerDown(target, event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
      if (this.partPointerActive) {
        event.preventDefault();
        event.stopPropagation();
      }
      subscriptions.onPointerMove(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
      if (this.partPointerActive) {
        event.preventDefault();
        event.stopPropagation();
      }
      this.lastPointerDown = null;
      subscriptions.onPointerUp(event);
      this.partPointerActive = false;
      if (this.activePointerId !== null && this.canvas.hasPointerCapture?.(this.activePointerId)) {
        try {
          this.canvas.releasePointerCapture(this.activePointerId);
        } catch {
          // Pointer capture may already be gone after canceled touch/pointer sequences.
        }
      }
      this.activePointerId = null;
      this.controls.enabled = true;
    };

    this.canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      this.canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      this.canvas.classList.remove("ai3d-disassembly-active", "ai3d-disassembly-dragging");
      this.partPointerActive = false;
      if (this.activePointerId !== null && this.canvas.hasPointerCapture?.(this.activePointerId)) {
        try {
          this.canvas.releasePointerCapture(this.activePointerId);
        } catch {
          // Pointer capture may already be gone after canceled touch/pointer sequences.
        }
      }
      this.activePointerId = null;
      this.controls.enabled = true;
    };
  }

  resolvePart(target: unknown): ThreeDisassemblyPart | null {
    if (isThreeDisassemblyPart(target)) {
      return this.parts.includes(target) ? target : null;
    }
    if (!target) return null;
    return this.meshToPart.get((target as Object3D).id) ?? null;
  }

  setSelected(part: ThreeDisassemblyPart | null): void {
    this.selectionHelper?.removeFromParent();
    this.selectionHelper = null;
    this.selected = part;
    this.lastOccluded = false;

    if (part && !this.isDisposed(part)) {
      this.selectionHelper = new BoxHelper(part.object, BBOX_VISIBLE);
      this.scene.add(this.selectionHelper);
    }
    this.requestRender();
  }

  beginDrag(part: ThreeDisassemblyPart, event: PointerEvent): DragState | null {
    const startPoint = this.getPointOnDragPlane(part, event);
    if (!startPoint) return null;

    event.preventDefault();
    event.stopPropagation();

    attachObjectToScenePreservingWorldTransform(this.scene, part.object);
    this.canvas.classList.add("ai3d-disassembly-dragging");

    let mode: "move" | "rotate" = "move";
    if (event.shiftKey) {
      mode = "rotate";
    }

    const pivot = this.tempBox.setFromObject(part.object).getCenter(this.tempCenter).clone();
    const camForward = this.tempCameraForward;
    this.camera.getWorldDirection(camForward);
    const plane = createPreviewPlane(
      toPreviewWorldPoint(startPoint),
      toPreviewWorldPoint(camForward),
    );
    if (!plane) return null;

    this.controls.enabled = false;
    this.requestRender();
    return {
      part,
      mode,
      plane,
      startPoint: startPoint.clone(),
      startPosition: part.object.position.clone(),
      startQuaternion: part.object.quaternion.clone(),
      pivot,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
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

    const offset = point.clone().sub(state.startPoint);
    state.part.object.position.copy(state.startPosition).add(offset);
    state.part.object.updateMatrixWorld(true);
    this.selectionHelper?.update();
    this.requestRender();
  }

  endDrag(state: DragState | null): void {
    this.controls.enabled = true;
    this.canvas.classList.remove("ai3d-disassembly-dragging");
    this.requestRender();
    if (!state) return;
  }

  updateSelectionOcclusion(part: ThreeDisassemblyPart): void {
    const box = this.tempBox.setFromObject(part.object);
    const center = box.getCenter(this.tempCenter);
    const cameraPos = this.camera.position;

    const lineOfSight = createPreviewLineOfSight(
      toPreviewWorldPoint(cameraPos),
      toPreviewWorldPoint(center),
    );
    if (!lineOfSight) return;

    const direction = this.tempDirection.set(
      lineOfSight.direction.x,
      lineOfSight.direction.y,
      lineOfSight.direction.z,
    );
    this.raycaster.set(cameraPos, direction);
    this.raycaster.far = lineOfSight.distance;

    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    const occluded = !!hit
      && isPreviewHitOccluded(hit.distance, lineOfSight.distance, lineOfSight.epsilon);

    if (occluded !== this.lastOccluded) {
      this.lastOccluded = occluded;
      if (this.selectionHelper) {
        this.selectionHelper.material.color.set(occluded ? BBOX_OCCLUDED : BBOX_VISIBLE);
        this.requestRender();
      }
    }
  }

  private updateRotation(state: DragState, event: PointerEvent): void {
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;

    const camForward = this.tempCameraForward;
    this.camera.getWorldDirection(camForward);
    const camUp = this.tempCameraUp.copy(this.camera.up).normalize();
    const camRight = this.tempCameraRight.crossVectors(
      camUp,
      camForward,
    ).normalize();

    const result = applyPreviewRotationDrag({
      startPosition: toPreviewWorldPoint(state.startPosition),
      pivot: toPreviewWorldPoint(state.pivot),
      startRotationQuaternion: toPreviewQuaternion(state.startQuaternion),
      yawAxis: toPreviewWorldPoint(camUp),
      pitchAxis: toPreviewWorldPoint(camRight),
      deltaX: dx,
      deltaY: dy,
      sensitivity: 0.01,
    });
    if (!result) return;

    state.part.object.position.set(result.position.x, result.position.y, result.position.z);
    state.part.object.quaternion.set(
      result.rotationQuaternion.x,
      result.rotationQuaternion.y,
      result.rotationQuaternion.z,
      result.rotationQuaternion.w,
    );
    state.part.object.updateMatrixWorld(true);
    this.selectionHelper?.update();
    this.requestRender();
  }

  private resolvePickTarget(event: PointerEvent): Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit?.object instanceof Mesh ? hit.object as Mesh : null;
  }

  private getPointOnDragPlane(part: ThreeDisassemblyPart, event: PointerEvent): Vector3 | null {
    const box = this.tempBox.setFromObject(part.object);
    const center = box.getCenter(this.tempCenter);
    const camForward = this.tempCameraForward;
    this.camera.getWorldDirection(camForward);
    const plane = createPreviewPlane(
      toPreviewWorldPoint(center),
      toPreviewWorldPoint(camForward),
    );
    return plane ? this.getRayPlanePoint(event, plane) ?? center : center;
  }

  private getRayPlanePoint(event: PointerEvent, plane: PreviewPlane): Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.pointer.set(
      (x / rect.width) * 2 - 1,
      -(y / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = intersectPreviewRayWithPlane(
      {
        origin: toPreviewWorldPoint(this.raycaster.ray.origin),
        direction: toPreviewWorldPoint(this.raycaster.ray.direction),
      },
      plane,
    );
    return point ? new Vector3(point.x, point.y, point.z) : null;
  }
}

export function createThreeDisassemblyController(
  scene: Scene,
  camera: Camera & { position: Vector3 },
  canvas: HTMLCanvasElement,
  root: Object3D,
  meshes: Mesh[],
  controls: { enabled: boolean },
  requestRender: () => void,
  childMeshMap?: ThreeChildRenderableMeshMap,
): PreviewDisassemblyController {
  return createPreviewDisassemblyController(
    new ThreeDisassemblyAdapter(scene, camera, canvas, root, meshes, controls, requestRender, childMeshMap),
  );
}
