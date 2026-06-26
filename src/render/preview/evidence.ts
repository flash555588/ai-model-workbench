import type { ModelEvidence, ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import {
  getPreviewBoundsCenter,
  getPreviewBoundsSize,
  mergePreviewBounds,
  type PreviewBounds,
} from "./bounds";

export interface PreviewGroupedPartCandidates<TMesh> {
  parts: readonly ModelPartSummary[];
  groupedMeshes: ReadonlySet<TMesh>;
}

export interface CreatePreviewEvidenceInput<TMesh> {
  summary: ModelPreviewSummary;
  renderableMeshes: readonly TMesh[];
  groupedPartCandidates: PreviewGroupedPartCandidates<TMesh>;
  createMeshPart: (mesh: TMesh) => ModelPartSummary;
  getMeshMaterialNames: (mesh: TMesh) => Iterable<string | null | undefined>;
  resourceWarnings?: readonly string[];
  capturedAt?: string;
}

export function createPreviewMaterialSummaryLabel(materialNames: ReadonlySet<string>): string | null {
  if (materialNames.size === 0) {
    return null;
  }
  if (materialNames.size === 1) {
    return Array.from(materialNames)[0] ?? null;
  }
  return `${materialNames.size} materials`;
}

function getPartSpan(part: ModelPartSummary): number {
  return Math.max(part.boundingSize.x, part.boundingSize.y, part.boundingSize.z);
}

function getModelSpan(summary: ModelPreviewSummary): number {
  return Math.max(summary.boundingSize.x, summary.boundingSize.y, summary.boundingSize.z);
}

function isGenericPartName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return /^(mesh|node|object|primitive|points|pointcloud|geometry)[-_\s.]?\d+$/i.test(normalized)
    || /^(mesh|node|object|primitive|points|pointcloud|geometry)$/i.test(normalized);
}

function partToBounds(part: ModelPartSummary): PreviewBounds {
  const half = {
    x: part.boundingSize.x / 2,
    y: part.boundingSize.y / 2,
    z: part.boundingSize.z / 2,
  };
  return {
    min: {
      x: part.center.x - half.x,
      y: part.center.y - half.y,
      z: part.center.z - half.z,
    },
    max: {
      x: part.center.x + half.x,
      y: part.center.y + half.y,
      z: part.center.z + half.z,
    },
  };
}

function shouldClusterTinyMeshPart(part: ModelPartSummary, modelSpan: number): boolean {
  if (part.source && part.source !== "mesh") return false;
  if (!Number.isFinite(modelSpan) || modelSpan <= 0) return false;
  if (!isGenericPartName(part.name)) return false;
  const span = getPartSpan(part);
  return Number.isFinite(span) && span > 0 && span <= modelSpan * 0.04;
}

function createDetailClusterPart(parts: readonly ModelPartSummary[]): ModelPartSummary {
  let bounds: PreviewBounds | null = null;
  let triangleCount = 0;
  let vertexCount = 0;
  const materialNames = new Set<string>();
  const meshNames: string[] = [];

  for (const part of parts) {
    bounds = mergePreviewBounds(bounds, partToBounds(part));
    triangleCount += part.triangleCount;
    vertexCount += part.vertexCount;
    if (part.materialName) {
      materialNames.add(part.materialName);
    }
    meshNames.push(...(part.meshNames?.length ? part.meshNames : [part.name]));
  }

  const safeBounds = bounds ?? {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  };

  return {
    name: "Small detail cluster",
    triangleCount,
    vertexCount,
    materialName: createPreviewMaterialSummaryLabel(materialNames),
    boundingSize: getPreviewBoundsSize(safeBounds),
    center: getPreviewBoundsCenter(safeBounds),
    source: "detail-cluster",
    meshNames,
    childCount: parts.length,
  };
}

function refinePreviewEvidenceParts(
  summary: ModelPreviewSummary,
  groupedParts: readonly ModelPartSummary[],
  meshParts: readonly ModelPartSummary[],
): ModelPartSummary[] {
  const modelSpan = getModelSpan(summary);
  const detailFragments = meshParts.filter((part) => shouldClusterTinyMeshPart(part, modelSpan));
  if (detailFragments.length < 2) {
    return groupedParts.length > 0 ? [...groupedParts, ...meshParts] : [...meshParts];
  }

  const detailFragmentSet = new Set(detailFragments);
  const keptMeshParts = meshParts.filter((part) => !detailFragmentSet.has(part));
  return [
    ...groupedParts,
    createDetailClusterPart(detailFragments),
    ...keptMeshParts,
  ];
}

export function createPreviewEvidence<TMesh>(input: CreatePreviewEvidenceInput<TMesh>): ModelEvidence {
  return {
    summary: input.summary,
    parts: createPreviewEvidenceParts(input),
    materialNames: collectPreviewMaterialNames(input.renderableMeshes, input.getMeshMaterialNames),
    resourceWarnings: input.resourceWarnings ? [...input.resourceWarnings] : [],
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

function createPreviewEvidenceParts<TMesh>(input: CreatePreviewEvidenceInput<TMesh>): ModelPartSummary[] {
  const meshParts = input.renderableMeshes
    .filter((mesh) => !input.groupedPartCandidates.groupedMeshes.has(mesh))
    .map((mesh) => input.createMeshPart(mesh));

  return refinePreviewEvidenceParts(input.summary, input.groupedPartCandidates.parts, meshParts);
}

function collectPreviewMaterialNames<TMesh>(
  meshes: readonly TMesh[],
  getMeshMaterialNames: (mesh: TMesh) => Iterable<string | null | undefined>,
): string[] {
  const materialNames = new Set<string>();

  for (const mesh of meshes) {
    for (const materialName of getMeshMaterialNames(mesh)) {
      if (materialName) {
        materialNames.add(materialName);
      }
    }
  }

  return Array.from(materialNames).sort((left, right) => left.localeCompare(right));
}
