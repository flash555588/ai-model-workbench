import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { getPreviewBoundsCenter } from "../preview/bounds";
import type { PreviewAxis, PreviewWorldPoint } from "../preview/types";
import {
  clonePreviewWorldPoint,
  toPreviewWorldPoint,
} from "../preview/geometry";
import {
  resetPreviewExplode,
  setPreviewExplode,
  type PreviewExplodeAdapter,
  type PreviewExplodeState,
} from "../preview/explode";
import {
  getBabylonRenderableMeshes,
  getBabylonRenderablePreviewBounds,
} from "./mesh-preview";

interface ExplodeMeta {
  _originalPos?: PreviewWorldPoint;
  _originalCenter?: PreviewWorldPoint;
  _previewExplodeState?: PreviewExplodeState;
}

function clonePoint(point: PreviewWorldPoint): PreviewWorldPoint {
  return clonePreviewWorldPoint(point);
}

class BabylonExplodeAdapter implements PreviewExplodeAdapter<AbstractMesh> {
  private readonly rootMesh: Mesh;
  private readonly loadedMeshes: Iterable<AbstractMesh>;

  constructor(rootMesh: Mesh, loadedMeshes: Iterable<AbstractMesh> = []) {
    this.rootMesh = rootMesh;
    this.loadedMeshes = loadedMeshes;
  }

  getParts(): readonly AbstractMesh[] {
    return getBabylonRenderableMeshes(this.rootMesh, this.loadedMeshes);
  }

  getRootCenter(): PreviewWorldPoint {
    return getPreviewBoundsCenter(getBabylonRenderablePreviewBounds(this.rootMesh, this.loadedMeshes));
  }

  getPartPosition(part: AbstractMesh): PreviewWorldPoint {
    return toPreviewWorldPoint(part.position);
  }

  getPartCenter(part: AbstractMesh): PreviewWorldPoint {
    return toPreviewWorldPoint(part.getBoundingInfo().boundingBox.centerWorld);
  }

  setPartPosition(part: AbstractMesh, position: PreviewWorldPoint): void {
    part.position = new Vector3(position.x, position.y, position.z);
  }

  getPartState(part: AbstractMesh): PreviewExplodeState | null {
    const meta = part.metadata as ExplodeMeta | undefined;
    if (meta?._previewExplodeState) {
      return {
        originalPosition: clonePoint(meta._previewExplodeState.originalPosition),
        originalCenter: clonePoint(meta._previewExplodeState.originalCenter),
      };
    }
    if (meta?._originalPos && meta?._originalCenter) {
      return {
        originalPosition: clonePoint(meta._originalPos),
        originalCenter: clonePoint(meta._originalCenter),
      };
    }
    return null;
  }

  setPartState(part: AbstractMesh, state: PreviewExplodeState): void {
    if (!part.metadata || typeof part.metadata !== "object") {
      part.metadata = {};
    }
    const meta = part.metadata as ExplodeMeta;
    meta._previewExplodeState = {
      originalPosition: clonePoint(state.originalPosition),
      originalCenter: clonePoint(state.originalCenter),
    };
    // Keep legacy fields populated so hot reloads or older session state remain readable.
    meta._originalPos = clonePoint(state.originalPosition);
    meta._originalCenter = clonePoint(state.originalCenter);
  }
}

export function setExplode(
  rootMesh: Mesh,
  factor: number,
  axis: PreviewAxis,
  loadedMeshes: Iterable<AbstractMesh> = [],
): void {
  setPreviewExplode(new BabylonExplodeAdapter(rootMesh, loadedMeshes), factor, axis);
}

export function resetExplode(rootMesh: Mesh, loadedMeshes: Iterable<AbstractMesh> = []): void {
  resetPreviewExplode(new BabylonExplodeAdapter(rootMesh, loadedMeshes));
}
