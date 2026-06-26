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

function isRecordUsable(record: ConvertedAssetRecord, now: number): boolean {
  return Boolean(
    record.cacheVersion === CONVERTED_ASSET_CACHE_VERSION &&
    record.converterId &&
    record.converterCacheKey &&
    record.sourcePath &&
    record.sourceExt &&
    record.targetExt === "glb" &&
    record.outputPath &&
    record.outputExt === "glb" &&
    Number.isFinite(record.createdAt) &&
    now - record.createdAt <= MAX_CONVERTED_ASSET_AGE_MS,
  );
}

function normalizeRecords(records: readonly ConvertedAssetRecord[], now = Date.now()): ConvertedAssetRecord[] {
  const byKey = new Map<string, ConvertedAssetRecord>();

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
  records: readonly ConvertedAssetRecord[],
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

  return records;
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
  initialRecords: readonly ConvertedAssetRecord[] = [],
  onChange?: (records: ConvertedAssetRecord[]) => void,
): ConvertedAssetCache {
  function snapshot(): ConvertedAssetRecord[] {
    return normalizeRecords([...map.values()]);
  }

  function rebuildMap(records: readonly ConvertedAssetRecord[]) {
    map.clear();
    for (const record of records) {
      map.set(makeKey(record.sourcePath, record.sourceExt, record.targetExt), record);
    }
  }

  const now = Date.now();
  const normalizedInitialRecords = reuseNormalizedRecords(initialRecords, now) ?? normalizeRecords(initialRecords, now);
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
    normalizedInitialRecords.some((record, index) => !sameRecord(record, initialRecords[index]));

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
