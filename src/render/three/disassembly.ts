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

interface PartTransform {
  parent: Object3D | null;
  position: Vector3;
  quaternion: ThreeQuaternion;
  scale: Vector3;
}

interface DragState {
  mesh: Mesh;
  mode: "move" | "rotate";
  plane: PreviewPlane;
  startPoint: Vector3;
  startPosition: Vector3;
  startQuaternion: ThreeQuaternion;
  pivot: Vector3;
  pointerX: number;
  pointerY: number;
}

const BBOX_VISIBLE = new Color(0x4a9eff);
const BBOX_OCCLUDED = new Color(0x1a4a6e);

class ThreeDisassemblyAdapter
  implements PreviewDisassemblyAdapter<Mesh, PartTransform, DragState> {

  private readonly scene: Scene;
  private readonly camera: Camera & { position: Vector3 };
  private readonly canvas: HTMLCanvasElement;
  private readonly meshes: Mesh[];
  private readonly controls: { enabled: boolean };
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private selectionHelper: BoxHelper | null = null;
  private lastOccluded = false;
  private selected: Mesh | null = null;
  private lastPointerDown: { x: number; y: number } | null = null;

  constructor(
    scene: Scene,
    camera: Camera & { position: Vector3 },
    canvas: HTMLCanvasElement,
    meshes: Mesh[],
    controls: { enabled: boolean },
  ) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.meshes = meshes;
    this.controls = controls;
  }

  getParts(): readonly Mesh[] {
    return this.meshes;
  }

  getPartId(part: Mesh): number {
    return part.id;
  }

  isDisposed(part: Mesh): boolean {
    return !part.parent && !this.meshes.includes(part);
  }

  captureTransform(part: Mesh): PartTransform {
    return {
      parent: part.parent,
      position: part.position.clone(),
      quaternion: part.quaternion.clone(),
      scale: part.scale.clone(),
    };
  }

  restoreTransform(part: Mesh, transform: PartTransform): void {
    if (transform.parent) {
      transform.parent.add(part);
    }
    part.position.copy(transform.position);
    part.quaternion.copy(transform.quaternion);
    part.scale.copy(transform.scale);
    part.updateMatrixWorld(true);
  }

  subscribe(subscriptions: PreviewDisassemblySubscriptions): () => void {
    const handlePointerDown = (event: PointerEvent) => {
      this.lastPointerDown = { x: event.clientX, y: event.clientY };
      const target = this.resolvePickTarget(event);
      subscriptions.onPointerDown(target, event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      subscriptions.onPointerMove(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      this.lastPointerDown = null;
      subscriptions.onPointerUp(event);
    };

    this.canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      this.canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }

  resolvePart(target: unknown): Mesh | null {
    if (!target) return null;
    if (this.isMeshInSet(target as Object3D)) {
      return target as Mesh;
    }
    return null;
  }

  setSelected(part: Mesh | null): void {
    this.selectionHelper?.removeFromParent();
    this.selectionHelper = null;
    this.selected = part;
    this.lastOccluded = false;

    if (part && !this.isDisposed(part)) {
      this.selectionHelper = new BoxHelper(part, BBOX_VISIBLE);
      this.scene.add(this.selectionHelper);
    }
  }

  beginDrag(part: Mesh, event: PointerEvent): DragState | null {
    const startPoint = this.getPointOnDragPlane(part, event);
    if (!startPoint) return null;

    event.preventDefault();
    event.stopPropagation();

    part.removeFromParent();
    this.scene.add(part);

    let mode: "move" | "rotate" = "move";
    if (event.shiftKey) {
      mode = "rotate";
    }

    const pivot = new Box3().setFromObject(part).getCenter(new Vector3());
    const plane = createPreviewPlane(
      toPreviewWorldPoint(startPoint),
      toPreviewWorldPoint(this.camera.position.clone().normalize()),
    );
    if (!plane) return null;

    this.controls.enabled = false;
    return {
      mesh: part,
      mode,
      plane,
      startPoint: startPoint.clone(),
      startPosition: part.position.clone(),
      startQuaternion: part.quaternion.clone(),
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
    state.mesh.position.copy(state.startPosition).add(offset);
    state.mesh.updateMatrixWorld(true);
  }

  endDrag(state: DragState | null): void {
    if (!state) return;
    this.controls.enabled = true;
  }

  updateSelectionOcclusion(part: Mesh): void {
    const box = new Box3().setFromObject(part);
    const center = box.getCenter(new Vector3());
    const cameraPos = this.camera.position;

    const lineOfSight = createPreviewLineOfSight(
      toPreviewWorldPoint(cameraPos),
      toPreviewWorldPoint(center),
    );
    if (!lineOfSight) return;

    const direction = new Vector3(
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
      }
    }
  }

  private isMeshInSet(object: Object3D): boolean {
    return this.meshes.includes(object as Mesh);
  }

  private updateRotation(state: DragState, event: PointerEvent): void {
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;

    const camForward = new Vector3();
    this.camera.getWorldDirection(camForward);
    const camRight = new Vector3().crossVectors(
      this.camera.up.clone().normalize(),
      camForward,
    ).normalize();
    const camUp = this.camera.up.clone().normalize();

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

    state.mesh.position.set(result.position.x, result.position.y, result.position.z);
    state.mesh.quaternion.set(
      result.rotationQuaternion.x,
      result.rotationQuaternion.y,
      result.rotationQuaternion.z,
      result.rotationQuaternion.w,
    );
    state.mesh.updateMatrixWorld(true);
  }

  private resolvePickTarget(event: PointerEvent): Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit?.object instanceof Mesh ? hit.object as Mesh : null;
  }

  private getPointOnDragPlane(mesh: Mesh, event: PointerEvent): Vector3 | null {
    const box = new Box3().setFromObject(mesh);
    const center = box.getCenter(new Vector3());
    const camForward = new Vector3();
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
  meshes: Mesh[],
  controls: { enabled: boolean },
): PreviewDisassemblyController {
  return createPreviewDisassemblyController(
    new ThreeDisassemblyAdapter(scene, camera, canvas, meshes, controls),
  );
}
