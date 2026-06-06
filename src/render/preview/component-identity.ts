export interface PreviewComponentIdentity {
  componentId?: string;
  occurrenceId?: string;
  partNumber?: string;
  componentPath?: string;
  displayName?: string;
  hasExplicitIdentity: boolean;
}

const COMPONENT_ID_KEYS = [
  "ai3dPartId",
  "partId",
  "componentId",
  "componentIdentifier",
  "cadId",
  "persistentId",
  "externalId",
  "id",
];
const OCCURRENCE_ID_KEYS = [
  "ai3dOccurrenceId",
  "occurrenceId",
  "instanceId",
  "occurrencePath",
  "assemblyPath",
  "pathId",
];
const PART_NUMBER_KEYS = [
  "ai3dPartNumber",
  "partNumber",
  "partNo",
  "partNum",
  "swPartNumber",
  "solidworksPartNumber",
  "part_number",
];
const DISPLAY_NAME_KEYS = [
  "displayName",
  "partName",
  "componentName",
  "cadName",
  "name",
];
const COMPONENT_PATH_KEYS = [
  "componentPath",
  "cadPath",
  "assemblyPath",
  "occurrencePath",
];
const NESTED_METADATA_KEYS = [
  "ai3d",
  "cad",
  "solidworks",
  "sw",
  "metadata",
  "properties",
  "extras",
  "gltf",
  "userData",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function collectMetadataRecords(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!isRecord(value) || depth > 2) {
    return [];
  }

  const records: Record<string, unknown>[] = [];
  for (const nestedKey of NESTED_METADATA_KEYS) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (normalizeKey(key) === normalizeKey(nestedKey)) {
        records.push(...collectMetadataRecords(nestedValue, depth + 1));
      }
    }
  }
  records.push(value);
  return records;
}

function readMetadataString(records: readonly Record<string, unknown>[], keys: readonly string[]): string | undefined {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!normalizedKeys.has(normalizeKey(key))) continue;
      const text = normalizeText(value);
      if (text) return text;
    }
  }
  return undefined;
}

export function extractPreviewComponentIdentity(
  metadata: unknown,
  fallback: { name?: string; path?: string } = {},
): PreviewComponentIdentity {
  const records = collectMetadataRecords(metadata);
  const componentId = readMetadataString(records, COMPONENT_ID_KEYS);
  const occurrenceId = readMetadataString(records, OCCURRENCE_ID_KEYS);
  const partNumber = readMetadataString(records, PART_NUMBER_KEYS);
  const componentPath = readMetadataString(records, COMPONENT_PATH_KEYS) ?? fallback.path;
  const displayName = readMetadataString(records, DISPLAY_NAME_KEYS) ?? fallback.name;
  const hasExplicitIdentity = !!(componentId || occurrenceId || partNumber);

  return {
    componentId,
    occurrenceId,
    partNumber,
    componentPath,
    displayName,
    hasExplicitIdentity,
  };
}

