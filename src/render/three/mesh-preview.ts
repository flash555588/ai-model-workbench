import {
  Box3,
  Material,
  Mesh,
  Object3D,
  Points,
} from "three";
import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import type { PreviewMeshBreakdownRow } from "../preview/report";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
} from "../preview/bounds";
import { extractPreviewComponentIdentity, type PreviewComponentIdentity } from "../preview/component-identity";
import {
  createPreviewMaterialSummaryLabel,
  type PreviewGroupedPartCandidates,
} from "../preview/evidence";
import { toPreviewWorldPoint } from "../preview/geometry";
import {
  createPreviewModelSummary,
  createPreviewPartSummary,
} from "../preview/summary";

export type ThreeRenderableObject = Mesh | Points;

export function isThreeMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

export function isThreePoints(value: unknown): value is Points {
  return value instanceof Points;
}

export function isThreeRenderableObject(value: unknown): value is ThreeRenderableObject {
  return isThreeMesh(value) || isThreePoints(value);
}

export function getThreeMaterialList(material: Material | Material[] | undefined | null): Material[] {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

export function getThreeTriangleCount(object: ThreeRenderableObject): number {
  if (isThreePoints(object)) return 0;
  const geometry = object.geometry;
  const indexCount = geometry.getIndex()?.count ?? 0;
  if (indexCount > 0) return Math.floor(indexCount / 3);
  const positionCount = geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(positionCount / 3);
}

export function getThreeVertexCount(object: ThreeRenderableObject): number {
  return object.geometry.getAttribute("position")?.count ?? 0;
}

export function describeThreeMaterial(material: Material | null | undefined): string | null {
  if (!material) return null;
  return material.name || material.type || `material-${material.uuid}`;
}

export function getThreeObjectDisplayName(object: Object3D, fallback: string): string {
  const originalName: unknown = object.userData?.name;
  return typeof originalName === "string" && originalName.trim().length > 0
    ? originalName
    : object.name || fallback;
}

export function getThreeObjectComponentPath(root: Object3D, object: Object3D): string {
  const names: string[] = [];
  let current: Object3D | null = object;
  while (current && current !== root) {
    names.push(getThreeObjectDisplayName(current, current.type || `object-${current.id}`));
    current = current.parent;
  }
  return names.reverse().join("/");
}

export function getThreeObjectPreviewBounds(object: Object3D) {
  const box = new Box3().setFromObject(object);
  return createPreviewBounds(
    toPreviewWorldPoint(box.min),
    toPreviewWorldPoint(box.max),
  );
}

export function getThreeMeshMaterialNames(mesh: Mesh): Array<string | null> {
  return getThreeMaterialList(mesh.material).map((material) => describeThreeMaterial(material));
}

export function getThreeRenderableMaterialNames(object: ThreeRenderableObject): Array<string | null> {
  return getThreeMaterialList(object.material).map((material) => describeThreeMaterial(material));
}

export function createThreeMeshInfoBreakdown(mesh: Mesh): {
  name: string;
  triangleCount: number;
  vertexCount: number;
  materialName: string | null;
} {
  return {
    name: getThreeObjectDisplayName(mesh, `mesh-${mesh.id}`),
    triangleCount: getThreeTriangleCount(mesh),
    vertexCount: getThreeVertexCount(mesh),
    materialName: describeThreeMaterial(getThreeMaterialList(mesh.material)[0]),
  };
}

export function createThreeRenderableInfoBreakdown(object: ThreeRenderableObject): PreviewMeshBreakdownRow {
  const name = getThreeObjectDisplayName(object, isThreePoints(object) ? `points-${object.id}` : `mesh-${object.id}`);
  return {
    name,
    triangleCount: isThreePoints(object) ? null : getThreeTriangleCount(object),
    vertexCount: getThreeVertexCount(object),
    materialName: describeThreeMaterial(getThreeMaterialList(object.material)[0]),
  };
}

export function createThreePartPreviewSummary(mesh: Mesh, root: Object3D | null): ModelPartSummary {
  mesh.updateWorldMatrix(true, false);
  const bounds = getThreeObjectPreviewBounds(mesh);
  const name = getThreeObjectDisplayName(mesh, `mesh-${mesh.id}`);
  const identity = extractPreviewComponentIdentity(mesh.userData, {
    name,
    path: root ? getThreeObjectComponentPath(root, mesh) : name,
  });
  return createPreviewPartSummary({
    name: getPartDisplayName(identity, name),
    triangleCount: getThreeTriangleCount(mesh),
    vertexCount: getThreeVertexCount(mesh),
    materialName: describeThreeMaterial(getThreeMaterialList(mesh.material)[0]),
    boundingSize: getPreviewBoundsSize(bounds),
    center: getPreviewBoundsCenter(bounds),
    source: identity.hasExplicitIdentity ? "component" : "mesh",
    meshNames: [name],
    childCount: 1,
    componentId: identity.componentId,
    occurrenceId: identity.occurrenceId,
    partNumber: identity.partNumber,
    componentPath: identity.componentPath,
  });
}

export function createThreeRenderablePartPreviewSummary(
  object: ThreeRenderableObject,
  root: Object3D | null,
): ModelPartSummary {
  if (isThreeMesh(object)) {
    return createThreePartPreviewSummary(object, root);
  }

  object.updateWorldMatrix(true, false);
  const bounds = getThreeObjectPreviewBounds(object);
  const name = getThreeObjectDisplayName(object, `points-${object.id}`);
  const identity = extractPreviewComponentIdentity(object.userData, {
    name,
    path: root ? getThreeObjectComponentPath(root, object) : name,
  });
  return createPreviewPartSummary({
    name: getPartDisplayName(identity, name),
    triangleCount: 0,
    vertexCount: getThreeVertexCount(object),
    materialName: describeThreeMaterial(getThreeMaterialList(object.material)[0]),
    boundingSize: getPreviewBoundsSize(bounds),
    center: getPreviewBoundsCenter(bounds),
    source: identity.hasExplicitIdentity ? "component" : "mesh",
    meshNames: [name],
    childCount: 1,
    componentId: identity.componentId,
    occurrenceId: identity.occurrenceId,
    partNumber: identity.partNumber,
    componentPath: identity.componentPath,
  });
}

function collectChildRenderableMeshes(object: Object3D, renderableSet: ReadonlySet<Mesh>): Mesh[] {
  const meshes: Mesh[] = [];
  object.traverse((child) => {
    if (isThreeMesh(child) && renderableSet.has(child)) {
      meshes.push(child);
    }
  });
  return meshes;
}

function isGenericWrapperName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return /^(scene|root|model|group|node|object|assembly|component)[-_\s.]?\d*$/i.test(normalized)
    || normalized === "__root__";
}

function isGeneratedThreeMeshBucketName(name: string): boolean {
  return /->\d+(?:[_\s.-]*primitive\d*)?$/i.test(name.trim());
}

export function createThreeObjectPartPreviewSummary(
  object: Object3D,
  root: Object3D | null,
  renderableMeshes?: readonly Mesh[],
): ModelPartSummary {
  if (isThreeRenderableObject(object)) {
    return createThreeRenderablePartPreviewSummary(object, root);
  }

  object.updateWorldMatrix(true, true);
  const renderableSet = new Set(renderableMeshes ?? []);
  if (renderableSet.size === 0) {
    object.traverse((child) => {
      if (isThreeMesh(child)) {
        renderableSet.add(child);
      }
    });
  }
  const childMeshes = collectChildRenderableMeshes(object, renderableSet);
  const bounds = new Box3();
  const materialNames = new Set<string>();
  let triangleCount = 0;
  let vertexCount = 0;

  for (const mesh of childMeshes) {
    mesh.updateWorldMatrix(true, false);
    bounds.union(new Box3().setFromObject(mesh));
    triangleCount += getThreeTriangleCount(mesh);
    vertexCount += getThreeVertexCount(mesh);
    for (const material of getThreeMaterialList(mesh.material)) {
      const name = describeThreeMaterial(material);
      if (name) materialNames.add(name);
    }
  }

  if (childMeshes.length === 0) {
    bounds.setFromObject(object);
  }

  const fallbackName = getThreeObjectDisplayName(object, `group-${object.id}`);
  const identity = extractPreviewComponentIdentity(object.userData, {
    name: fallbackName,
    path: root ? getThreeObjectComponentPath(root, object) : fallbackName,
  });

  return createPreviewPartSummary({
    name: getPartDisplayName(identity, fallbackName),
    triangleCount,
    vertexCount,
    materialName: createPreviewMaterialSummaryLabel(materialNames),
    boundingSize: getPreviewBoundsSize({
      min: toPreviewWorldPoint(bounds.min),
      max: toPreviewWorldPoint(bounds.max),
    }),
    center: getPreviewBoundsCenter({
      min: toPreviewWorldPoint(bounds.min),
      max: toPreviewWorldPoint(bounds.max),
    }),
    source: identity.hasExplicitIdentity ? "component" : "group",
    meshNames: childMeshes.map((mesh) => getThreeObjectDisplayName(mesh, `mesh-${mesh.id}`)),
    childCount: childMeshes.length,
    componentId: identity.componentId,
    occurrenceId: identity.occurrenceId,
    partNumber: identity.partNumber,
    componentPath: identity.componentPath,
  });
}

export function findThreeSelectablePartObject(
  root: Object3D,
  renderable: ThreeRenderableObject,
  renderableMeshes: readonly Mesh[],
): Object3D {
  const renderableSet = new Set(renderableMeshes);
  let fallbackGroup: Object3D | null = null;
  let fallbackExplicitObject: Object3D | null = null;
  let current = renderable.parent;
  while (current && current !== root) {
    const childMeshes = collectChildRenderableMeshes(current, renderableSet);
    if (childMeshes.length > 0 && childMeshes.length < renderableMeshes.length) {
      const rawObjectName = current.name ?? "";
      const fallbackName = getThreeObjectDisplayName(current, `group-${current.id}`);
      const identity = extractPreviewComponentIdentity(current.userData, {
        name: fallbackName,
        path: getThreeObjectComponentPath(root, current),
      });
      if (identity.hasExplicitIdentity) {
        if (!isGeneratedThreeMeshBucketName(rawObjectName)) {
          return current;
        }
        fallbackExplicitObject ??= current;
      }
      if (!fallbackGroup && childMeshes.length > 1 && fallbackName.trim() && !isGenericWrapperName(fallbackName)) {
        fallbackGroup = current;
      }
    }
    current = current.parent;
  }
  return fallbackGroup ?? fallbackExplicitObject ?? renderable;
}

export function createThreeGroupedPartCandidates(
  root: Object3D,
  renderableMeshes: readonly Mesh[],
): PreviewGroupedPartCandidates<Mesh> {
  const renderableSet = new Set(renderableMeshes);
  const parts: ModelPartSummary[] = [];
  const groupedMeshes = new Set<Mesh>();
  const candidates: Array<{
    object: Object3D;
    childMeshes: Mesh[];
    identity: PreviewComponentIdentity;
  }> = [];
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (object === root || isThreeMesh(object)) {
      return;
    }
    const childMeshes: Mesh[] = [];
    object.traverse((child) => {
      if (isThreeMesh(child) && renderableSet.has(child)) {
        childMeshes.push(child);
      }
    });
    if (childMeshes.length < 2 || childMeshes.length === renderableMeshes.length) {
      const identity = extractPreviewComponentIdentity(object.userData, {
        name: getThreeObjectDisplayName(object, `component-${object.id}`),
        path: getThreeObjectComponentPath(root, object),
      });
      if (!identity.hasExplicitIdentity || childMeshes.length < 1 || childMeshes.length === renderableMeshes.length) {
        return;
      }
      candidates.push({ object, childMeshes, identity });
      return;
    }
    const identity = extractPreviewComponentIdentity(object.userData, {
      name: getThreeObjectDisplayName(object, `group-${object.id}`),
      path: getThreeObjectComponentPath(root, object),
    });
    if (!identity.hasExplicitIdentity && !object.name.trim()) return;
    candidates.push({ object, childMeshes, identity });
  });

  candidates
    .sort((left, right) => left.childMeshes.length - right.childMeshes.length)
    .forEach(({ object, childMeshes, identity }) => {
      const availableMeshes = childMeshes.filter((mesh) => !groupedMeshes.has(mesh));
      if (availableMeshes.length < 1) return;
      if (!identity.hasExplicitIdentity && availableMeshes.length < 2) return;
      for (const mesh of availableMeshes) {
        groupedMeshes.add(mesh);
      }
      const bounds = new Box3();
      for (const mesh of availableMeshes) {
        mesh.updateWorldMatrix(true, false);
        bounds.union(new Box3().setFromObject(mesh));
      }
      const materialNames = new Set<string>();
      let triangleCount = 0;
      let vertexCount = 0;
      for (const mesh of availableMeshes) {
        triangleCount += getThreeTriangleCount(mesh);
        vertexCount += getThreeVertexCount(mesh);
        for (const material of getThreeMaterialList(mesh.material)) {
          const name = describeThreeMaterial(material);
          if (name) materialNames.add(name);
        }
      }
      parts.push(createPreviewPartSummary({
        name: getPartDisplayName(identity, getThreeObjectDisplayName(object, `group-${object.id}`)),
        triangleCount,
        vertexCount,
        materialName: createPreviewMaterialSummaryLabel(materialNames),
        boundingSize: getPreviewBoundsSize({
          min: toPreviewWorldPoint(bounds.min),
          max: toPreviewWorldPoint(bounds.max),
        }),
        center: getPreviewBoundsCenter({
          min: toPreviewWorldPoint(bounds.min),
          max: toPreviewWorldPoint(bounds.max),
        }),
        source: identity.hasExplicitIdentity ? "component" : "group",
        meshNames: availableMeshes.map((mesh) => getThreeObjectDisplayName(mesh, `mesh-${mesh.id}`)),
        childCount: availableMeshes.length,
        componentId: identity.componentId,
        occurrenceId: identity.occurrenceId,
        partNumber: identity.partNumber,
        componentPath: identity.componentPath,
      }));
    });
  return { parts, groupedMeshes };
}

export function createThreeModelPreviewSummary(
  root: Object3D,
  renderableObjects: readonly ThreeRenderableObject[],
  resourceWarnings: readonly string[] = [],
): ModelPreviewSummary {
  return createPreviewModelSummary({
    rootName: root.name || "__root__",
    boundingSize: getPreviewBoundsSize(getThreeObjectPreviewBounds(root)),
    meshes: renderableObjects.map((object) => ({
      triangleCount: getThreeTriangleCount(object),
      vertexCount: getThreeVertexCount(object),
      materialKeys: getThreeMaterialList(object.material).map((material) => material.uuid),
    })),
    resourceWarnings,
  });
}

function getPartDisplayName(identity: PreviewComponentIdentity, fallback: string): string {
  return identity.displayName?.trim() || identity.partNumber || identity.componentId || fallback;
}
