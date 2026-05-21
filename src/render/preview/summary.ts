import type { ModelPartSummary, ModelPreviewSummary } from "../../domain/models";
import { clonePreviewWorldPoint } from "./geometry";
import type { PreviewWorldPoint } from "./types";

export interface PreviewMeshSummaryInput {
  triangleCount: number;
  vertexCount: number;
  materialKeys?: readonly (string | null | undefined)[];
}

export interface PreviewModelSummaryInput {
  rootName: string;
  boundingSize: PreviewWorldPoint;
  meshes: readonly PreviewMeshSummaryInput[];
  splatCount?: number;
}

export interface PreviewPartSummaryInput {
  name: string;
  triangleCount: number;
  vertexCount: number;
  materialName?: string | null;
  boundingSize: PreviewWorldPoint;
  center: PreviewWorldPoint;
}

export function createPreviewModelSummary(input: PreviewModelSummaryInput): ModelPreviewSummary {
  const materials = new Set<string>();
  let triangleCount = 0;
  let vertexCount = 0;

  for (const mesh of input.meshes) {
    triangleCount += mesh.triangleCount;
    vertexCount += mesh.vertexCount;
    for (const materialKey of mesh.materialKeys ?? []) {
      if (materialKey !== null && materialKey !== undefined) {
        materials.add(materialKey);
      }
    }
  }

  return {
    meshCount: input.meshes.length,
    triangleCount,
    splatCount: input.splatCount,
    vertexCount,
    materialCount: materials.size,
    boundingSize: clonePreviewWorldPoint(input.boundingSize),
    rootName: input.rootName,
  };
}

export function createPreviewPartSummary(input: PreviewPartSummaryInput): ModelPartSummary {
  return {
    name: input.name,
    triangleCount: input.triangleCount,
    vertexCount: input.vertexCount,
    materialName: input.materialName ?? null,
    boundingSize: clonePreviewWorldPoint(input.boundingSize),
    center: clonePreviewWorldPoint(input.center),
  };
}

export function getPreviewSummaryCountLabel(summary: ModelPreviewSummary): string {
  return summary.splatCount !== undefined ? "Splats" : "Triangles";
}

export function getPreviewSummaryPrimaryCount(summary: ModelPreviewSummary): number {
  return summary.splatCount ?? summary.triangleCount;
}
