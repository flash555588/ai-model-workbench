import type { ModelEvidence, ModelPartSummary, ModelPreviewSummary } from "../../domain/models";

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

  return input.groupedPartCandidates.parts.length > 0
    ? [...input.groupedPartCandidates.parts, ...meshParts]
    : meshParts;
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
