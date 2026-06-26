import type {
  AnalysisPipelineStage,
  AnnotationPartLink,
  AnalysisDraftingInput,
  AnalysisResult,
  KnowledgeNode,
  ModelAssetProfile,
  ModelAssetFormat,
  ModelEvidence,
  ModelEvidenceFormatLineage,
  ModelLoadStrategy,
  ModelPartSummary,
  ModelPreviewSummary,
  PartRecord,
  RegisteredPartMatch,
} from "../../domain/models";
import { getPortableStem } from "../../utils/resolve-path";
import { compactPersistedNumberTuple } from "../../utils/compact-number";

export const LOCAL_ANALYSIS_VERSION = "local-evidence-v1";
const MAX_REGISTERED_MATCHES_PER_PART = 3;
const REGISTERED_PART_MATCH_THRESHOLD = 0.58;
const MAX_PART_MESH_REFS = 16;
const MAX_PART_MATERIAL_REFS = 16;
const SUPPORTED_ANALYSIS_FORMATS = new Set<AnalysisResult["asset"]["format"]>([
  "glb",
  "gltf",
  "stl",
  "obj",
  "splat",
  "ply",
  "fbx",
  "step",
  "stp",
  "iges",
  "igs",
  "brep",
  "sldprt",
  "3mf",
  "dae",
]);

const SUPPORTED_LOAD_STRATEGIES = new Set(["direct", "convert"]);

interface RegisteredPartMatchCandidate {
  part: PartRecord;
  nameTokens: Set<string>;
  meshTokens: Set<string>;
}

export interface BuildLocalAnalysisOptions {
  modelPath: string;
  profile?: ModelAssetProfile;
  preview: ModelPreviewSummary | null;
  evidence?: ModelEvidence | null;
  previewImages?: string[];
  registeredParts?: PartRecord[];
  startedAt?: number;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function formatObservationCount(value: number, label: string, pluralLabel = `${label}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? label : pluralLabel}`;
}

function createPipelineStage(startedAt: number): AnalysisPipelineStage {
  return {
    stage: "reason",
    durationMs: Math.max(0, Math.round(nowMs() - startedAt)),
    status: "success",
  };
}

function distance3d(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  const dz = left[2] - right[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function inferModelAssetFormat(value: string | null | undefined): ModelAssetFormat {
  const ext = (value ?? "").split(".").pop()?.trim().toLowerCase();
  if (SUPPORTED_ANALYSIS_FORMATS.has(ext as ModelAssetFormat)) {
    return ext as ModelAssetFormat;
  }
  return "glb";
}

function normalizeModelLoadStrategy(
  value: unknown,
  sourceFormat: ModelAssetFormat,
  effectiveFormat: ModelAssetFormat,
): ModelLoadStrategy {
  if (typeof value === "string" && SUPPORTED_LOAD_STRATEGIES.has(value)) {
    return value as "direct" | "convert";
  }
  return sourceFormat === effectiveFormat ? "direct" : "convert";
}

function toVectorTuple(point: { x: number; y: number; z: number }): [number, number, number] {
  return compactPersistedNumberTuple([point.x, point.y, point.z]);
}

function limitPartRefs(values: readonly string[], maxEntries: number): string[] {
  return values
    .filter((value) => value.trim().length > 0)
    .slice(0, maxEntries);
}

function sanitizePartIdSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|#[\]^]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function createPartId(modelPath: string, part: ModelPartSummary, index: number, seen: Set<string>): string {
  const modelStem = sanitizePartIdSegment(getPortableStem(modelPath) || "model") || "model";
  const identifier = part.occurrenceId ?? part.componentId ?? part.partNumber;
  const rawId = identifier
    ? `${modelStem}:component:${sanitizePartIdSegment(identifier) || index + 1}`
    : `${modelStem}:part:${index + 1}`;
  let candidate = rawId;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${rawId}:${suffix}`;
    suffix++;
  }
  seen.add(candidate);
  return candidate;
}

function normalizePartText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(normalizePartText(value).split(" ").filter((token) => token.length >= 2));
}

function overlapRatio(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function dimensionsSimilarity(left?: readonly number[], right?: readonly number[]): number {
  if (!left || !right || left.length < 3 || right.length < 3) return 0;
  const a = [...left].slice(0, 3).map((value) => Math.max(0.0001, Math.abs(value))).sort((x, y) => x - y);
  const b = [...right].slice(0, 3).map((value) => Math.max(0.0001, Math.abs(value))).sort((x, y) => x - y);
  let total = 0;
  for (let index = 0; index < 3; index++) {
    total += Math.min(a[index], b[index]) / Math.max(a[index], b[index]);
  }
  return total / 3;
}

function materialMatches(left?: string | null, right?: string | null): boolean {
  const leftValue = normalizePartText(left);
  const rightValue = normalizePartText(right);
  return !!leftValue && !!rightValue && leftValue === rightValue;
}

function identifierMatches(left?: string | null, right?: string | null): boolean {
  const leftValue = normalizePartText(left);
  const rightValue = normalizePartText(right);
  return !!leftValue && !!rightValue && leftValue === rightValue;
}

function createRegisteredPartMatchCandidates(registeredParts: readonly PartRecord[]): RegisteredPartMatchCandidate[] {
  return registeredParts.map((part) => ({
    part,
    nameTokens: tokenSet(part.name),
    meshTokens: tokenSet(part.meshRefs.join(" ")),
  }));
}

function buildRegisteredPartMatches(part: PartRecord, candidates: readonly RegisteredPartMatchCandidate[]): RegisteredPartMatch[] {
  const partNameTokens = tokenSet(part.name);
  const partMeshTokens = tokenSet(part.meshRefs.join(" "));
  const matches = candidates
    .filter((candidate) => candidate.part.assetId !== part.assetId || candidate.part.partId !== part.partId)
    .flatMap((candidateInfo): RegisteredPartMatch[] => {
      const candidate = candidateInfo.part;
      const reasons: string[] = [];
      const nameScore = overlapRatio(partNameTokens, candidateInfo.nameTokens);
      const meshScore = overlapRatio(partMeshTokens, candidateInfo.meshTokens);
      const sizeScore = dimensionsSimilarity(part.bbox, candidate.bbox);
      const sameCategory = !!part.category && !!candidate.category && part.category === candidate.category;
      const sameMaterial = materialMatches(part.materialName, candidate.materialName);
      const sameComponentId = identifierMatches(part.componentId, candidate.componentId);
      const samePartNumber = identifierMatches(part.partNumber, candidate.partNumber);
      const sameOccurrenceId = identifierMatches(part.occurrenceId, candidate.occurrenceId);
      let score = (nameScore * 0.38) + (meshScore * 0.22) + (sizeScore * 0.22);
      if (sameComponentId) score += 0.5;
      if (samePartNumber) score += 0.4;
      if (sameOccurrenceId) score += 0.25;
      if (sameCategory) score += 0.1;
      if (sameMaterial) score += 0.08;
      if (sameComponentId) reasons.push(`same component id: ${part.componentId}`);
      if (samePartNumber) reasons.push(`same part number: ${part.partNumber}`);
      if (sameOccurrenceId) reasons.push("same occurrence id");
      if (nameScore >= 0.5) reasons.push("similar part name");
      if (meshScore >= 0.5) reasons.push("similar mesh names");
      if (sizeScore >= 0.72) reasons.push("similar bounding size");
      if (sameCategory) reasons.push(`same category: ${part.category}`);
      if (sameMaterial && part.materialName) reasons.push(`same material: ${part.materialName}`);
      score = Math.min(1, score);
      if (score < REGISTERED_PART_MATCH_THRESHOLD || reasons.length === 0) {
        return [];
      }
      return [{
        sourceAssetId: candidate.assetId,
        sourcePartId: candidate.partId,
        sourcePartName: candidate.name,
        sourceNotePath: candidate.notePath,
        sourceCategory: candidate.category,
        sourceModelPath: candidate.assetId,
        matchScore: Number(score.toFixed(3)),
        confidence: Math.max(0.35, Math.min(0.9, Number(score.toFixed(3)))),
        reasons,
      }];
    })
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, MAX_REGISTERED_MATCHES_PER_PART);
  return matches;
}

function attachRegisteredPartMatches(parts: readonly PartRecord[], registeredParts: readonly PartRecord[]): PartRecord[] {
  if (registeredParts.length === 0) {
    return parts.map((part) => ({ ...part }));
  }
  const candidates = createRegisteredPartMatchCandidates(registeredParts);
  return parts.map((part) => {
    const registeredMatches = buildRegisteredPartMatches(part, candidates);
    return registeredMatches.length > 0 ? { ...part, registeredMatches } : { ...part };
  });
}

function inferPartCategory(part: ModelPartSummary): string {
  const name = part.name.toLowerCase();
  if (part.source === "component") return "component";
  if (part.source === "group") return "group";
  if (part.source === "detail-cluster") return "detail-cluster";
  if (name.includes("wheel") || name.includes("gear") || name.includes("axle")) return "mechanical";
  if (name.includes("shell") || name.includes("case") || name.includes("cover") || name.includes("housing")) return "enclosure";
  if (name.includes("button") || name.includes("key") || name.includes("switch")) return "control";
  if (name.includes("glass") || name.includes("screen") || name.includes("lens")) return "surface";
  if (part.materialName?.toLowerCase().includes("metal")) return "material-driven";
  return "unclassified";
}

function buildPartObservations(part: ModelPartSummary): string[] {
  const observations = [];
  if (part.source === "group") {
    observations.push(`Registered from model group with ${formatObservationCount(part.childCount ?? part.meshNames?.length ?? 0, "child mesh", "child meshes")}.`);
  }
  if (part.source === "component") {
    observations.push(`Registered from model component metadata with ${formatObservationCount(part.childCount ?? part.meshNames?.length ?? 1, "child mesh", "child meshes")}.`);
  }
  if (part.source === "detail-cluster") {
    observations.push(`Merged from ${formatObservationCount(part.childCount ?? part.meshNames?.length ?? 0, "generic tiny mesh", "generic tiny meshes")} to avoid over-splitting renderer fragments.`);
  }
  if (part.componentId) {
    observations.push(`Component ID: ${part.componentId}.`);
  }
  if (part.occurrenceId) {
    observations.push(`Occurrence ID: ${part.occurrenceId}.`);
  }
  if (part.partNumber) {
    observations.push(`Part number: ${part.partNumber}.`);
  }
  if (part.componentPath) {
    observations.push(`Component path: ${part.componentPath}.`);
  }
  if (part.sourceFormat || part.effectiveFormat || part.loadStrategy) {
    const sourceFormat = part.sourceFormat ?? part.effectiveFormat ?? "glb";
    const effectiveFormat = part.effectiveFormat ?? sourceFormat;
    const loadStrategy = normalizeModelLoadStrategy(part.loadStrategy, sourceFormat, effectiveFormat);
    observations.push(`Format lineage: ${sourceFormat.toUpperCase()}${effectiveFormat !== sourceFormat ? ` -> ${effectiveFormat.toUpperCase()}` : ""} (${loadStrategy}).`);
  }
  observations.push(
    `${formatObservationCount(part.triangleCount, "triangle")} and ${formatObservationCount(part.vertexCount, "vertex")}.`,
    `Bounding size ${part.boundingSize.x.toFixed(3)} x ${part.boundingSize.y.toFixed(3)} x ${part.boundingSize.z.toFixed(3)}.`,
  );
  if (part.materialName) {
    observations.push(`Uses material "${part.materialName}".`);
  }
  return observations;
}

function resolvePartFormatLineage(
  modelPath: string,
  part: ModelPartSummary,
  evidenceLineage?: ModelEvidenceFormatLineage,
): Required<Pick<PartRecord, "sourceFormat" | "effectiveFormat" | "loadStrategy">> {
  const fallbackSourceFormat = inferModelAssetFormat(modelPath);
  const sourceFormat = part.sourceFormat ?? evidenceLineage?.sourceFormat ?? fallbackSourceFormat;
  const effectiveFormat = part.effectiveFormat ?? evidenceLineage?.effectiveFormat ?? sourceFormat;
  const loadStrategy = normalizeModelLoadStrategy(part.loadStrategy ?? evidenceLineage?.loadStrategy, sourceFormat, effectiveFormat);
  return { sourceFormat, effectiveFormat, loadStrategy };
}

function inferPartConfidence(part: ModelPartSummary): number {
  if (part.source === "component") return 0.82;
  if (part.source === "group") return 0.72;
  if (part.source === "detail-cluster") return 0.48;
  return part.name ? 0.55 : 0.35;
}

export function buildPartRecordsFromEvidence(
  modelPath: string,
  parts: readonly ModelPartSummary[],
  evidenceLineage?: ModelEvidenceFormatLineage,
): PartRecord[] {
  const seenPartIds = new Set<string>();
  return parts.map((part, index) => {
    const lineage = resolvePartFormatLineage(modelPath, part, evidenceLineage);
    const enrichedPart = {
      ...part,
      sourceFormat: lineage.sourceFormat,
      effectiveFormat: lineage.effectiveFormat,
      loadStrategy: lineage.loadStrategy,
    };
    return {
      partId: createPartId(modelPath, part, index, seenPartIds),
      assetId: modelPath,
      name: part.name || `Part ${index + 1}`,
      source: part.source,
      componentId: part.componentId,
      occurrenceId: part.occurrenceId,
      partNumber: part.partNumber,
      componentPath: part.componentPath,
      category: inferPartCategory(part),
      meshRefs: limitPartRefs(
        part.meshNames?.length ? part.meshNames : [part.name || `mesh-${index + 1}`],
        MAX_PART_MESH_REFS,
      ),
      childCount: part.childCount,
      materialRefs: limitPartRefs(part.materialName ? [part.materialName] : [], MAX_PART_MATERIAL_REFS),
      bbox: toVectorTuple(part.boundingSize),
      center: toVectorTuple(part.center),
      triangleCount: part.triangleCount,
      vertexCount: part.vertexCount,
      materialName: part.materialName,
      sourceFormat: lineage.sourceFormat,
      effectiveFormat: lineage.effectiveFormat,
      loadStrategy: lineage.loadStrategy,
      confidence: inferPartConfidence(part),
      observations: buildPartObservations(enrichedPart),
      inferredFunctions: [],
      knowledgeTags: [],
      reviewed: false,
    };
  });
}

function buildKnowledgeNodes(
  modelPath: string,
  profile: ModelAssetProfile | undefined,
  evidence: ModelEvidence | null | undefined,
  parts: readonly PartRecord[],
  annotationLinks: readonly AnnotationPartLink[],
): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  const summary = evidence?.summary;
  if (summary) {
    nodes.push({
      id: `${modelPath}:geometry`,
      title: "Geometry overview",
      domain: "geometry",
      summary: `${formatObservationCount(summary.meshCount, "mesh")}, ${formatObservationCount(summary.triangleCount, "triangle")}, ${formatObservationCount(summary.materialCount, "material slot")}.`,
      relatedPartIds: parts.slice(0, 12).map((part) => part.partId),
      relatedAssetIds: [modelPath],
      confidence: 0.72,
      source: "rule",
    });
  }

  for (const pin of profile?.annotations ?? []) {
    const link = annotationLinks.find((candidate) => candidate.annotationId === pin.id);
    nodes.push({
      id: `${modelPath}:annotation:${pin.id}`,
      title: pin.label || "Annotation focus",
      domain: "assembly",
      summary: [
        pin.headingRef
          ? `Pinned focus area linked to heading "${pin.headingRef}".`
          : "Pinned focus area marked by the user for follow-up analysis.",
        link?.nearestPartName ? `Nearest part candidate: ${link.nearestPartName}.` : "",
      ].filter(Boolean).join(" "),
      relatedPartIds: link?.nearestPartId ? [link.nearestPartId] : [],
      relatedAssetIds: [modelPath],
      confidence: 0.8,
      source: "user",
    });
  }

  return nodes;
}

function buildAnnotationLinks(profile: ModelAssetProfile | undefined, parts: readonly PartRecord[]): AnnotationPartLink[] {
  const annotations = profile?.annotations ?? [];
  return annotations.map((pin) => {
    const position = pin.position;
    let nearestPart: PartRecord | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const part of parts) {
      if (!part.center) continue;
      const distance = distance3d(position, part.center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPart = part;
      }
    }
    const confidence = nearestPart && Number.isFinite(nearestDistance)
      ? Math.max(0.2, Math.min(0.85, 1 / (1 + nearestDistance)))
      : 0.25;
    return {
      annotationId: pin.id,
      label: pin.label || "Untitled pin",
      position,
      notePath: pin.notePath,
      headingRef: pin.headingRef,
      nearestPartId: nearestPart?.partId,
      nearestPartName: nearestPart?.name,
      distance: Number.isFinite(nearestDistance) ? nearestDistance : undefined,
      confidence,
    };
  });
}

function buildDraftingInput(options: {
  modelPath: string;
  profile?: ModelAssetProfile;
  preview: ModelPreviewSummary | null;
  formatLineage?: ModelEvidenceFormatLineage;
  parts: readonly PartRecord[];
  knowledgeNodes: readonly KnowledgeNode[];
  annotationLinks: readonly AnnotationPartLink[];
  previewImages: readonly string[];
  warnings: readonly string[];
}): AnalysisDraftingInput {
  const title = getPortableStem(options.modelPath) || options.modelPath;
  const sourceFormat = options.formatLineage?.sourceFormat ?? inferModelAssetFormat(options.modelPath);
  const effectiveFormat = options.formatLineage?.effectiveFormat ?? sourceFormat;
  const loadStrategy = normalizeModelLoadStrategy(options.formatLineage?.loadStrategy, sourceFormat, effectiveFormat);
  return {
    task: "Draft an Obsidian knowledge note grounded only in the provided model evidence, annotations, and preview images. Do not invent part functions unless evidence or user notes support them.",
    model: {
      path: options.modelPath,
      title,
      format: sourceFormat,
      effectiveFormat,
      loadStrategy,
      summary: options.preview ?? undefined,
      tags: options.profile?.tags ?? [],
      notes: options.profile?.notes ?? "",
    },
    evidence: {
      rawModelIncluded: false,
      previewImages: [...options.previewImages],
      warnings: [...options.warnings],
      generatedAt: new Date().toISOString(),
    },
    partCandidates: options.parts.slice(0, 64).map((part) => ({
      partId: part.partId,
      name: part.name,
      notePath: part.notePath,
      source: part.source,
      componentId: part.componentId,
      occurrenceId: part.occurrenceId,
      partNumber: part.partNumber,
      componentPath: part.componentPath,
      category: part.category,
      sourceFormat: part.sourceFormat,
      effectiveFormat: part.effectiveFormat,
      loadStrategy: part.loadStrategy,
      meshRefs: [...part.meshRefs],
      childCount: part.childCount,
      triangleCount: part.triangleCount,
      materialName: part.materialName,
      registeredMatches: part.registeredMatches?.map((match) => ({ ...match, reasons: [...match.reasons] })),
      observations: part.observations,
    })),
    annotationLinks: [...options.annotationLinks],
    knowledgeNodes: [...options.knowledgeNodes],
  };
}

function collectWarnings(preview: ModelPreviewSummary | null, evidence?: ModelEvidence | null): string[] {
  return Array.from(new Set([
    ...(preview?.resourceWarnings ?? []),
    ...(evidence?.resourceWarnings ?? []),
  ]));
}

export function buildLocalAnalysisResult(options: BuildLocalAnalysisOptions): AnalysisResult {
  const startedAt = options.startedAt ?? nowMs();
  const preview = options.evidence?.summary ?? options.preview;
  const assetFormat = inferModelAssetFormat(options.modelPath);
  const evidenceLineage = options.evidence?.formatLineage;
  const effectiveFormat = evidenceLineage?.effectiveFormat ?? assetFormat;
  const loadStrategy = normalizeModelLoadStrategy(evidenceLineage?.loadStrategy, evidenceLineage?.sourceFormat ?? assetFormat, effectiveFormat);
  const parts = attachRegisteredPartMatches(
    buildPartRecordsFromEvidence(options.modelPath, options.evidence?.parts ?? [], evidenceLineage),
    options.registeredParts ?? [],
  );
  const importedAt = new Date().toISOString();
  const warnings = collectWarnings(options.preview, options.evidence);
  const annotationLinks = buildAnnotationLinks(options.profile, parts);
  const knowledgeNodes = buildKnowledgeNodes(options.modelPath, options.profile, options.evidence, parts, annotationLinks);
  const previewImages = options.previewImages ?? [];
  const draftingInput = buildDraftingInput({
    modelPath: options.modelPath,
    profile: options.profile,
    preview,
    formatLineage: evidenceLineage,
    parts,
    knowledgeNodes,
    annotationLinks,
    previewImages,
    warnings,
  });

  return {
    asset: {
      assetId: options.modelPath,
      title: getPortableStem(options.modelPath) || options.modelPath,
      sourcePath: options.modelPath,
      format: assetFormat,
      effectiveFormat,
      loadStrategy,
      importedAt,
      updatedAt: importedAt,
      status: preview ? "ready" : "processing",
      vertexCount: preview?.vertexCount,
      triangleCount: preview?.triangleCount,
      materialCount: preview?.materialCount,
      boundingBox: preview ? toVectorTuple(preview.boundingSize) : undefined,
      analysisVersion: LOCAL_ANALYSIS_VERSION,
    },
    parts,
    knowledgeNodes,
    previewImages,
    annotationLinks,
    draftingInput,
    evidence: options.evidence ?? undefined,
    warnings,
    pipeline: [
      { stage: "stats", durationMs: 0, status: preview ? "success" : "skipped" },
      { stage: "split", durationMs: 0, status: options.evidence?.parts?.length ? "success" : "skipped" },
      { stage: "map", durationMs: 0, status: annotationLinks.length > 0 ? "success" : "skipped" },
      createPipelineStage(startedAt),
    ],
  };
}
