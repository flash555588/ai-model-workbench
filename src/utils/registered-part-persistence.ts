import type { PartRecord } from "../domain/models";

export const MAX_PERSISTED_REGISTERED_PART_MESH_REFS = 16;
export const MAX_PERSISTED_REGISTERED_PART_MATERIAL_REFS = 32;
export const MAX_PERSISTED_REGISTERED_PART_OBSERVATIONS = 16;

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
