import type { ModelAssetFormat, ModelLoadStrategy, PartRecord } from "../domain/models";

export const MAX_PERSISTED_REGISTERED_PART_MESH_REFS = 16;
export const MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS = 32;
export const MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS = 16;

/** Coerce an unknown persisted value into a valid part source, or undefined. */
export function normalizePartSource(value: unknown): PartRecord["source"] {
  return value === "group" || value === "mesh" || value === "component" || value === "detail-cluster"
    ? value
    : undefined;
}

/** Coerce an unknown persisted value into a valid model asset format, or undefined. */
export function normalizeModelAssetFormat(value: unknown): ModelAssetFormat | undefined {
  return value === "glb" || value === "gltf" || value === "stl" || value === "obj" || value === "splat" ||
    value === "ply" || value === "fbx" || value === "step" || value === "stp" || value === "iges" ||
    value === "igs" || value === "brep" || value === "sldprt" || value === "3mf" || value === "dae" ||
    value === "off" || value === "msh" ||
    value === "x_t" || value === "x_b" || value === "catpart" || value === "catproduct"
    ? value
    : undefined;
}

/** Coerce an unknown persisted value into a valid model load strategy, or undefined. */
export function normalizeModelLoadStrategy(value: unknown): ModelLoadStrategy | undefined {
  return value === "direct" || value === "convert" ? value : undefined;
}

type PartObservationPersistenceFields = Pick<PartRecord, "observations" | "notePath" | "reviewed">;

function normalizeObservationText(observation: string): string {
  return observation.trim();
}

function isDerivedRegisteredPartObservation(observation: string): boolean {
  const text = normalizeObservationText(observation);
  return /^Registered from model group with /.test(text) ||
    /^Registered from model component metadata with /.test(text) ||
    /^Merged from [\d,]+ generic tiny meshes? to avoid over-splitting renderer fragments\.$/.test(text) ||
    /^Component ID: .+\.$/.test(text) ||
    /^Occurrence ID: .+\.$/.test(text) ||
    /^Part number: .+\.$/.test(text) ||
    /^Component path: .+\.$/.test(text) ||
    /^Format lineage: .+\.$/.test(text) ||
    /^[\d,]+ triangles? and [\d,]+ vertex(?:es|s)\.$/.test(text) ||
    /^Bounding size [-+0-9.eE]+ x [-+0-9.eE]+ x [-+0-9.eE]+\.$/.test(text) ||
    /^Uses material ".+"\.$/.test(text);
}

function normalizeObservationArray(observations: readonly string[]): string[] {
  return observations
    .map(normalizeObservationText)
    .filter((observation) => observation.length > 0);
}

export function compactRegisteredPartObservationsForPersistence(
  part: PartObservationPersistenceFields,
): string[] {
  const observations = normalizeObservationArray(part.observations);
  if (part.reviewed || part.notePath) {
    return observations.slice(0, MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS);
  }
  return observations
    .filter((observation) => !isDerivedRegisteredPartObservation(observation))
    .slice(0, MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS);
}

export function areRegisteredPartObservationsPersistedCompact(
  part: PartObservationPersistenceFields,
): boolean {
  const compacted = compactRegisteredPartObservationsForPersistence(part);
  return compacted.length === part.observations.length &&
    compacted.every((observation, index) => observation === part.observations[index]);
}

export function compactRegisteredPartForPersistence(part: PartRecord): PartRecord {
  return {
    ...part,
    meshRefs: part.meshRefs.slice(0, MAX_PERSISTED_REGISTERED_PART_MESH_REFS),
    materialRefs: part.materialRefs.slice(0, MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS),
    observations: compactRegisteredPartObservationsForPersistence(part),
    registeredMatches: undefined,
  };
}

/**
 * Rank a registered part for retention/reuse priority.
 *
 * Lower = keep first: user-reviewed parts and parts that already have a note
 * outrank component metadata, which outranks plain groups, which outrank
 * detail-clusters, which outrank unclassified meshes.
 */
export function rankRegisteredPart(part: PartRecord): number {
  if (part.reviewed || part.notePath) return 0;
  if (part.source === "component") return 1;
  if (part.source === "group") return 2;
  if (part.source === "detail-cluster") return 3;
  return 4;
}
