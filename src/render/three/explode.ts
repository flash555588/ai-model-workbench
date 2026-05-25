import { Box3, Mesh, Object3D, Vector3 } from "three";
import type { PreviewAxis, PreviewWorldPoint } from "../preview/types";
import {
  clonePreviewWorldPoint,
  toPreviewWorldPoint,
} from "../preview/geometry";
import { getPreviewBoundsCenter } from "../preview/bounds";
import {
  resetPreviewExplode,
  setPreviewExplode,
  type PreviewExplodeAdapter,
  type PreviewExplodeState,
} from "../preview/explode";

interface ExplodeMeta {
  _previewExplodeState?: PreviewExplodeState;
}

function clonePoint(point: PreviewWorldPoint): PreviewWorldPoint {
  return clonePreviewWorldPoint(point);
}

function isMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

function getRenderableMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object) && object.geometry) {
      meshes.push(object);
    }
  });
  return meshes;
}

class ThreeExplodeAdapter implements PreviewExplodeAdapter<Mesh> {
  private readonly root: Object3D;

  constructor(root: Object3D) {
    this.root = root;
  }

  getParts(): readonly Mesh[] {
    return getRenderableMeshes(this.root);
  }

  getRootCenter(): PreviewWorldPoint {
    const box = new Box3().setFromObject(this.root);
    return getPreviewBoundsCenter({
      min: toPreviewWorldPoint(box.min),
      max: toPreviewWorldPoint(box.max),
    });
  }

  getPartPosition(part: Mesh): PreviewWorldPoint {
    return toPreviewWorldPoint(part.position);
  }

  getPartCenter(part: Mesh): PreviewWorldPoint {
    const box = new Box3().setFromObject(part);
    const center = box.getCenter(new Vector3());
    return toPreviewWorldPoint(center);
  }

  setPartPosition(part: Mesh, position: PreviewWorldPoint): void {
    part.position.set(position.x, position.y, position.z);
  }

  getPartState(part: Mesh): PreviewExplodeState | null {
    const meta = (part.userData ?? {}) as ExplodeMeta;
    return meta._previewExplodeState
      ? {
        originalPosition: clonePoint(meta._previewExplodeState.originalPosition),
        originalCenter: clonePoint(meta._previewExplodeState.originalCenter),
      }
      : null;
  }

  setPartState(part: Mesh, state: PreviewExplodeState): void {
    part.userData._previewExplodeState = {
      originalPosition: clonePoint(state.originalPosition),
      originalCenter: clonePoint(state.originalCenter),
    };
  }
}

export function setThreeExplode(
  root: Object3D,
  factor: number,
  axis: PreviewAxis,
): void {
  setPreviewExplode(new ThreeExplodeAdapter(root), factor, axis);
}

export function resetThreeExplode(root: Object3D): void {
  resetPreviewExplode(new ThreeExplodeAdapter(root));
}
