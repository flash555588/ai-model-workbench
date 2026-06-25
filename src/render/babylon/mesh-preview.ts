import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import {
  createPreviewBounds,
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
  mergePreviewBounds,
  type PreviewBounds,
} from "../preview/bounds";
import { extractPreviewComponentIdentity, type PreviewComponentIdentity } from "../preview/component-identity";
import {
  createPreviewMaterialSummaryLabel,
  type PreviewGroupedPartCandidates,
} from "../preview/evidence";
import { toPreviewWorldPoint } from "../preview/geometry";
import type { PreviewMeshBreakdownRow } from "../preview/report";
import { createPreviewModelSummary, createPreviewPartSummary } from "../preview/summary";

export type BabylonComponentMetadataMap = ReadonlyMap<string, unknown>;

const EMPTY_COMPONENT_METADATA: BabylonComponentMetadataMap = new Map();

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

export function createBabylonMeshInfoBreakdown(
  mesh: AbstractMesh,
  options: { isSplat?: boolean } = {},
): PreviewMeshBreakdownRow {
  return {
    name: mesh.name,
    triangleCount: options.isSplat ? null : getBabylonTriangleCount(mesh),
    vertexCount: getBabylonVertexCount(mesh),
    materialName: mesh.material?.name ?? null,
  };
}

export function createBabylonPartPreviewSummary(
  mesh: AbstractMesh,
  componentMetadata: BabylonComponentMetadataMap = EMPTY_COMPONENT_METADATA,
): ModelPartSummary {
  const bounds = getBabylonMeshPreviewBounds(mesh);
  const name = mesh.name || `mesh-${mesh.uniqueId}`;
  const metadata = mergeBabylonMetadataFallback(
    mesh.metadata,
    componentMetadata.get(`node:${name}`) ?? componentMetadata.get(`mesh:${name}`),
  );
  const identity = extractPreviewComponentIdentity(metadata, {
    name,
    path: getBabylonComponentPath(mesh),
  });
  return createPreviewPartSummary({
    name: getPartDisplayName(identity, name),
    triangleCount: getBabylonTriangleCount(mesh),
    vertexCount: getBabylonVertexCount(mesh),
    materialName: mesh.material?.name ?? null,
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

export function createBabylonGroupedPartCandidates(
  renderableMeshes: readonly AbstractMesh[],
  transformNodes: readonly TransformNode[],
  componentMetadata: BabylonComponentMetadataMap = EMPTY_COMPONENT_METADATA,
): PreviewGroupedPartCandidates<AbstractMesh> {
  const renderableSet = new Set(renderableMeshes);
  const parts: ModelPartSummary[] = [];
  const groupedMeshes = new Set<AbstractMesh>();
  const candidates: Array<{
    node: TransformNode;
    childMeshes: AbstractMesh[];
    identity: PreviewComponentIdentity;
  }> = [];
  for (const node of transformNodes) {
    const childMeshes = node.getChildMeshes(false).filter((mesh) => renderableSet.has(mesh));
    const nodeName = getBabylonNodeDisplayName(node, `component-${node.uniqueId}`);
    const metadata = mergeBabylonMetadataFallback(node.metadata, componentMetadata.get(`node:${nodeName}`));
    const identity = extractPreviewComponentIdentity(metadata, {
      name: getBabylonNodeDisplayName(node, `component-${node.uniqueId}`),
      path: getBabylonComponentPath(node),
    });
    if (childMeshes.length < 1 || childMeshes.length === renderableMeshes.length) {
      continue;
    }
    if (!identity.hasExplicitIdentity && (!node.name.trim() || childMeshes.length < 2)) {
      continue;
    }
    candidates.push({ node, childMeshes, identity });
  }

  candidates
    .sort((left, right) => left.childMeshes.length - right.childMeshes.length)
    .forEach(({ node, childMeshes, identity }) => {
      const availableMeshes = childMeshes.filter((mesh) => !groupedMeshes.has(mesh));
      if (availableMeshes.length < 1) return;
      if (!identity.hasExplicitIdentity && availableMeshes.length < 2) return;
      for (const mesh of availableMeshes) {
        groupedMeshes.add(mesh);
      }
      const bounds = getBabylonMeshesPreviewBounds(availableMeshes);
      if (!bounds) return;
      const materialNames = new Set<string>();
      let triangleCount = 0;
      let vertexCount = 0;
      for (const mesh of availableMeshes) {
        triangleCount += getBabylonTriangleCount(mesh);
        vertexCount += getBabylonVertexCount(mesh);
        if (mesh.material?.name) {
          materialNames.add(mesh.material.name);
        }
      }
      parts.push(createPreviewPartSummary({
        name: getPartDisplayName(identity, getBabylonNodeDisplayName(node, `component-${node.uniqueId}`)),
        triangleCount,
        vertexCount,
        materialName: createPreviewMaterialSummaryLabel(materialNames),
        boundingSize: getPreviewBoundsSize(bounds),
        center: getPreviewBoundsCenter(bounds),
        source: identity.hasExplicitIdentity ? "component" : "group",
        meshNames: availableMeshes.map((mesh) => mesh.name || `mesh-${mesh.uniqueId}`),
        childCount: availableMeshes.length,
        componentId: identity.componentId,
        occurrenceId: identity.occurrenceId,
        partNumber: identity.partNumber,
        componentPath: identity.componentPath,
      }));
    });
  return { parts, groupedMeshes };
}

export function collectBabylonGltfComponentMetadata(data: ArrayBuffer, extLower: string): Map<string, unknown> {
  const json = parseBabylonGltfJson(data, extLower);
  const metadata = new Map<string, unknown>();
  if (!json) return metadata;

  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name && record.extras) {
      metadata.set(`node:${name}`, record.extras);
    }
  }

  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  for (const mesh of meshes) {
    if (!mesh || typeof mesh !== "object") continue;
    const record = mesh as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (name && record.extras) {
      metadata.set(`mesh:${name}`, record.extras);
    }
  }

  return metadata;
}

export function getBabylonNodeDisplayName(node: { name?: string; metadata?: unknown }, fallback: string): string {
  const identity = extractPreviewComponentIdentity(node.metadata, { name: node.name });
  return identity.displayName?.trim() || node.name || fallback;
}

export function getBabylonComponentPath(node: { name?: string; parent?: unknown; metadata?: unknown }): string {
  const names: string[] = [];
  let current: unknown = node;
  while (current && typeof current === "object" && "name" in current) {
    const currentNode = current as { name?: string; parent?: unknown; metadata?: unknown };
    const name = getBabylonNodeDisplayName(currentNode, "node");
    if (name.trim()) names.push(name);
    current = currentNode.parent;
  }
  return names.reverse().join("/");
}

function parseBabylonGltfJson(data: ArrayBuffer, extLower: string): Record<string, unknown> | null {
  try {
    if (extLower === "gltf") {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as Record<string, unknown>;
    }
    if (extLower !== "glb") {
      return null;
    }
    const view = new DataView(data);
    if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
      return null;
    }
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    if (jsonChunkType !== 0x4e4f534a || 20 + jsonChunkLength > view.byteLength) {
      return null;
    }
    const jsonBytes = new Uint8Array(data, 20, jsonChunkLength);
    return JSON.parse(new TextDecoder().decode(jsonBytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeBabylonMetadataFallback(primary: unknown, fallback: unknown): unknown {
  if (fallback === undefined) return primary;
  if (primary === undefined || primary === null) return fallback;
  return { metadata: primary, extras: fallback };
}

function getPartDisplayName(identity: PreviewComponentIdentity, fallback: string): string {
  return identity.displayName?.trim() || identity.partNumber || identity.componentId || fallback;
}
