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
  resourceWarnings?: readonly string[];
}

type PreviewPerformanceTier = NonNullable<ModelPreviewSummary["performanceTier"]>;

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

  const performanceTier = classifyPreviewPerformance({
    triangleCount,
    splatCount: input.splatCount,
    meshCount: input.meshes.length,
    materialCount: materials.size,
  });

  return {
    meshCount: input.meshes.length,
    triangleCount,
    splatCount: input.splatCount,
    vertexCount,
    materialCount: materials.size,
    performanceTier,
    performanceHint: createPreviewPerformanceHint(performanceTier, {
      triangleCount,
      splatCount: input.splatCount,
      materialCount: materials.size,
    }),
    resourceWarnings: input.resourceWarnings ? [...input.resourceWarnings] : undefined,
    boundingSize: clonePreviewWorldPoint(input.boundingSize),
    rootName: input.rootName,
  };
}

function classifyPreviewPerformance(input: {
  triangleCount: number;
  splatCount?: number;
  meshCount: number;
  materialCount: number;
}): PreviewPerformanceTier {
  if ((input.splatCount ?? 0) >= 1_500_000 || input.triangleCount >= 1_200_000 || input.materialCount >= 96 || input.meshCount >= 240) {
    return "extreme";
  }
  if ((input.splatCount ?? 0) >= 650_000 || input.triangleCount >= 450_000 || input.materialCount >= 48 || input.meshCount >= 120) {
    return "heavy";
  }
  if ((input.splatCount ?? 0) >= 180_000 || input.triangleCount >= 120_000 || input.materialCount >= 18 || input.meshCount >= 48) {
    return "medium";
  }
  return "light";
}

function createPreviewPerformanceHint(
  tier: PreviewPerformanceTier,
  input: { triangleCount: number; splatCount?: number; materialCount: number },
): string {
  const count = (input.splatCount ?? input.triangleCount).toLocaleString();
  const unit = input.splatCount !== undefined ? "splats" : "triangles";
  if (tier === "extreme") {
    return `${count} ${unit}, ${input.materialCount.toLocaleString()} materials. Expect automatic quality throttling while interacting.`;
  }
  if (tier === "heavy") {
    return `${count} ${unit}, ${input.materialCount.toLocaleString()} materials. Interaction may lower shadows and resolution temporarily.`;
  }
  if (tier === "medium") {
    return `${count} ${unit}, ${input.materialCount.toLocaleString()} materials. Performance should be steady on most desktop GPUs.`;
  }
  return `${count} ${unit}, ${input.materialCount.toLocaleString()} materials. Performance tier: light.`;
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
