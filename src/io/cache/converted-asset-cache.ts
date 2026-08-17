import type { ConvertedAssetRecord } from "../../domain/models";

export const CONVERTED_ASSET_CACHE_VERSION = 2;
const MAX_CONVERTED_ASSET_RECORDS = 200;
const MAX_CONVERTED_ASSET_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface ConvertedAssetCache {
  get: (sourcePath: string, sourceExt: string, targetExt: "glb") => ConvertedAssetRecord | undefined;
  set: (record: ConvertedAssetRecord) => void;
  delete: (sourcePath: string, sourceExt: string, targetExt: "glb") => boolean;
  clear: () => void;
  entries: () => ConvertedAssetRecord[];
}

function makeKey(sourcePath: string, sourceExt: string, targetExt: "glb"): string {
  return `${sourcePath}::${sourceExt}::${targetExt}`;
}

function isRecordUsable(record: unknown, now: number): record is ConvertedAssetRecord {
  if (!record || typeof record !== "object") return false;
  const candidate = record as Partial<ConvertedAssetRecord>;
  return Boolean(
    candidate.cacheVersion === CONVERTED_ASSET_CACHE_VERSION &&
    typeof candidate.converterId === "string" && candidate.converterId.length > 0 &&
    typeof candidate.converterCacheKey === "string" && candidate.converterCacheKey.length > 0 &&
    typeof candidate.sourcePath === "string" && candidate.sourcePath.length > 0 &&
    typeof candidate.sourceExt === "string" && candidate.sourceExt.length > 0 &&
    candidate.targetExt === "glb" &&
    typeof candidate.outputPath === "string" && candidate.outputPath.length > 0 &&
    candidate.outputExt === "glb" &&
    Array.isArray(candidate.warnings) && candidate.warnings.every((warning) => typeof warning === "string") &&
    Number.isFinite(candidate.createdAt) &&
    now - Number(candidate.createdAt) <= MAX_CONVERTED_ASSET_AGE_MS,
  );
}

export function normalizeConvertedAssetRecords(records: unknown, now = Date.now()): ConvertedAssetRecord[] {
  const byKey = new Map<string, ConvertedAssetRecord>();

  if (!Array.isArray(records)) return [];
  for (const record of records) {
    if (!isRecordUsable(record, now)) {
      continue;
    }

    const key = makeKey(record.sourcePath, record.sourceExt, record.targetExt);
    const existing = byKey.get(key);
    if (!existing || record.createdAt > existing.createdAt) {
      byKey.set(key, record);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_CONVERTED_ASSET_RECORDS);
}

function reuseNormalizedRecords(
  records: readonly unknown[],
  now: number,
): readonly ConvertedAssetRecord[] | null {
  if (records.length > MAX_CONVERTED_ASSET_RECORDS) {
    return null;
  }

  const seen = new Set<string>();
  let previousCreatedAt = Number.POSITIVE_INFINITY;
  for (const record of records) {
    if (!isRecordUsable(record, now)) {
      return null;
    }
    const key = makeKey(record.sourcePath, record.sourceExt, record.targetExt);
    if (seen.has(key)) {
      return null;
    }
    if (record.createdAt > previousCreatedAt) {
      return null;
    }
    seen.add(key);
    previousCreatedAt = record.createdAt;
  }

  return records as readonly ConvertedAssetRecord[];
}

function sameRecord(a: ConvertedAssetRecord | undefined, b: ConvertedAssetRecord | undefined): boolean {
  return !!a && !!b &&
    a.cacheVersion === b.cacheVersion &&
    a.converterId === b.converterId &&
    a.converterCacheKey === b.converterCacheKey &&
    a.sourcePath === b.sourcePath &&
    a.sourceExt === b.sourceExt &&
    a.targetExt === b.targetExt &&
    a.outputPath === b.outputPath &&
    a.outputExt === b.outputExt &&
    a.createdAt === b.createdAt &&
    a.warnings.join("\n") === b.warnings.join("\n");
}

export function createConvertedAssetCache(
  initialRecords: readonly unknown[] = [],
  onChange?: (records: ConvertedAssetRecord[]) => void,
): ConvertedAssetCache {
  function snapshot(): ConvertedAssetRecord[] {
    return normalizeConvertedAssetRecords([...map.values()]);
  }

  function rebuildMap(records: readonly ConvertedAssetRecord[]) {
    map.clear();
    for (const record of records) {
      map.set(makeKey(record.sourcePath, record.sourceExt, record.targetExt), record);
    }
  }

  const now = Date.now();
  const normalizedInitialRecords = reuseNormalizedRecords(initialRecords, now) ?? normalizeConvertedAssetRecords(initialRecords, now);
  const map = new Map<string, ConvertedAssetRecord>(
    normalizedInitialRecords.map((record) => [makeKey(record.sourcePath, record.sourceExt, record.targetExt), record]),
  );

  function emitChange() {
    const records = snapshot();
    rebuildMap(records);
    onChange?.(records);
  }

  const initialChanged =
    initialRecords.length !== normalizedInitialRecords.length ||
    normalizedInitialRecords.some((record, index) => {
      const initialRecord = initialRecords[index];
      return !isRecordUsable(initialRecord, now) || !sameRecord(record, initialRecord);
    });

  if (initialChanged) {
    onChange?.([...normalizedInitialRecords]);
  }

  return {
    get(sourcePath, sourceExt, targetExt) {
      return map.get(makeKey(sourcePath, sourceExt, targetExt));
    },
    set(record) {
      map.set(makeKey(record.sourcePath, record.sourceExt, record.targetExt), record);
      emitChange();
    },
    delete(sourcePath, sourceExt, targetExt) {
      const deleted = map.delete(makeKey(sourcePath, sourceExt, targetExt));
      if (deleted) emitChange();
      return deleted;
    },
    clear() {
      if (map.size === 0) return;
      map.clear();
      emitChange();
    },
    entries() {
      return snapshot();
    },
  };
}
