import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
  mergePreviewBounds,
  type PreviewBounds,
} from "../preview/bounds";
import { toPreviewWorldPoint } from "../preview/geometry";
import { createPreviewModelSummary, createPreviewPartSummary } from "../preview/summary";

export function getBabylonTriangleCount(mesh: AbstractMesh): number {
  return Math.floor(mesh.getTotalIndices() / 3);
}

export function getBabylonVertexCount(mesh: AbstractMesh): number {
  return mesh.getTotalVertices();
}

export function getBabylonRenderableMeshes(
  root: AbstractMesh,
  importedMeshes: Iterable<AbstractMesh> = [],
): AbstractMesh[] {
  const candidates = [root, ...importedMeshes, ...root.getChildMeshes(true)];
  const seen = new Set<AbstractMesh>();
  return candidates.filter((mesh) => {
    if (!mesh || seen.has(mesh) || mesh.isDisposed()) return false;
    seen.add(mesh);
    return getBabylonVertexCount(mesh) > 0 || mesh.getTotalIndices() > 0;
  });
}

export function getBabylonTopLevelImportedMeshes(importedMeshes: Iterable<AbstractMesh>): AbstractMesh[] {
  const meshes = Array.from(importedMeshes);
  const importedSet = new Set(meshes);
  return meshes.filter((mesh) => {
    const parent = mesh.parent;
    return !parent || !importedSet.has(parent as AbstractMesh);
  });
}

export function getBabylonMeshPreviewBounds(mesh: AbstractMesh): PreviewBounds {
  mesh.computeWorldMatrix(true);
  const bbox = mesh.getBoundingInfo().boundingBox;
  return createPreviewBounds(
    toPreviewWorldPoint(bbox.minimumWorld),
    toPreviewWorldPoint(bbox.maximumWorld),
  );
}

export function getBabylonMeshesPreviewBounds(meshes: Iterable<AbstractMesh>): PreviewBounds | null {
  let bounds: PreviewBounds | null = null;
  for (const mesh of meshes) {
    if (!mesh || mesh.isDisposed()) continue;
    bounds = mergePreviewBounds(bounds, getBabylonMeshPreviewBounds(mesh));
  }
  return bounds;
}

export function getBabylonRenderablePreviewBounds(
  root: AbstractMesh,
  importedMeshes: Iterable<AbstractMesh> = [],
): PreviewBounds {
  return getBabylonMeshesPreviewBounds(getBabylonRenderableMeshes(root, importedMeshes))
    ?? getBabylonMeshPreviewBounds(root);
}

export function createBabylonModelPreviewSummary(
  rootName: string,
  bounds: PreviewBounds,
  meshes: readonly AbstractMesh[],
  options: { splatCount?: number; resourceWarnings?: readonly string[] } = {},
): ModelPreviewSummary {
  return createPreviewModelSummary({
    rootName,
    boundingSize: getPreviewBoundsSize(bounds),
    meshes: meshes.map((mesh) => ({
      triangleCount: getBabylonTriangleCount(mesh),
      vertexCount: getBabylonVertexCount(mesh),
      materialKeys: mesh.material ? [mesh.material.name] : [],
    })),
    splatCount: options.splatCount,
    resourceWarnings: options.resourceWarnings,
  });
}

export function createBabylonPartPreviewSummary(mesh: AbstractMesh): ModelPartSummary {
  const bounds = getBabylonMeshPreviewBounds(mesh);
  return createPreviewPartSummary({
    name: mesh.name || `mesh-${mesh.uniqueId}`,
    triangleCount: getBabylonTriangleCount(mesh),
    vertexCount: getBabylonVertexCount(mesh),
    materialName: mesh.material?.name ?? null,
    boundingSize: getPreviewBoundsSize(bounds),
    center: getPreviewBoundsCenter(bounds),
  });
}
