import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConvertedAssetRecord } from "../../domain/models";
import { CONVERTED_ASSET_CACHE_VERSION, createConvertedAssetCache } from "./converted-asset-cache";

const NOW = Date.parse("2026-06-22T00:00:00.000Z");

function createRecord(partial: Partial<ConvertedAssetRecord> = {}): ConvertedAssetRecord {
  return {
    cacheVersion: CONVERTED_ASSET_CACHE_VERSION,
    converterId: "mock",
    converterCacheKey: "mock:v1",
    sourcePath: "models/source.step",
    sourceExt: "step",
    targetExt: "glb",
    outputPath: "models/source.ai3d-converted.glb",
    outputExt: "glb",
    warnings: [],
    createdAt: NOW,
    ...partial,
  };
}

describe("createConvertedAssetCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes initial records, deduplicates by source, and reports cleanup", () => {
    const older = createRecord({ outputPath: "models/older.glb", createdAt: NOW - 1_000 });
    const newer = createRecord({ outputPath: "models/newer.glb", createdAt: NOW });
    const stale = createRecord({
      sourcePath: "models/stale.step",
      outputPath: "models/stale.glb",
      createdAt: NOW - (31 * 24 * 60 * 60 * 1000),
    });
    const wrongVersion = createRecord({
      cacheVersion: CONVERTED_ASSET_CACHE_VERSION - 1,
      sourcePath: "models/old-version.step",
      outputPath: "models/old-version.glb",
    });
    const changes: ConvertedAssetRecord[][] = [];

    const cache = createConvertedAssetCache([older, stale, wrongVersion, newer], records => changes.push(records));

    expect(cache.entries()).toEqual([newer]);
    expect(cache.get("models/source.step", "step", "glb")).toEqual(newer);
    expect(cache.get("models/stale.step", "step", "glb")).toBeUndefined();
    expect(changes).toEqual([[newer]]);
  });

  it("reuses already normalized initial records without emitting cleanup", () => {
    const newest = createRecord({
      sourcePath: "models/newest.step",
      outputPath: "models/newest.glb",
      createdAt: NOW,
    });
    const older = createRecord({
      sourcePath: "models/older.step",
      outputPath: "models/older.glb",
      createdAt: NOW - 1_000,
    });
    const changes: ConvertedAssetRecord[][] = [];

    const cache = createConvertedAssetCache([newest, older], records => changes.push(records));

    expect(cache.entries()).toEqual([newest, older]);
    expect(cache.get("models/newest.step", "step", "glb")).toEqual(newest);
    expect(cache.get("models/older.step", "step", "glb")).toEqual(older);
    expect(changes).toHaveLength(0);
  });

  it("discards malformed persisted records without throwing", () => {
    const valid = createRecord();
    const malformed = {
      ...valid,
      sourcePath: "models/malformed.step",
      warnings: null,
    };
    const changes: ConvertedAssetRecord[][] = [];

    const cache = createConvertedAssetCache([malformed, valid], records => changes.push(records));

    expect(cache.entries()).toEqual([valid]);
    expect(cache.get("models/malformed.step", "step", "glb")).toBeUndefined();
    expect(changes).toEqual([[valid]]);
  });

  it("emits sorted snapshots when setting and replacing records", () => {
    const changes: ConvertedAssetRecord[][] = [];
    const cache = createConvertedAssetCache([], records => changes.push(records));
    const first = createRecord({
      sourcePath: "models/first.step",
      outputPath: "models/first.glb",
      createdAt: NOW - 1_000,
    });
    const second = createRecord({
      sourcePath: "models/second.step",
      outputPath: "models/second.glb",
      createdAt: NOW,
    });
    const firstReplacement = createRecord({
      sourcePath: "models/first.step",
      outputPath: "models/first-v2.glb",
      createdAt: NOW + 1_000,
    });

    cache.set(first);
    cache.set(second);
    cache.set(firstReplacement);

    expect(cache.get("models/first.step", "step", "glb")).toEqual(firstReplacement);
    expect(cache.entries().map(record => record.outputPath)).toEqual([
      "models/first-v2.glb",
      "models/second.glb",
    ]);
    expect(changes.at(-1)?.map(record => record.outputPath)).toEqual([
      "models/first-v2.glb",
      "models/second.glb",
    ]);
  });

  it("emits only when delete or clear changes the cache", () => {
    const record = createRecord();
    const changes: ConvertedAssetRecord[][] = [];
    const cache = createConvertedAssetCache([record], records => changes.push(records));

    expect(cache.delete("models/missing.step", "step", "glb")).toBe(false);
    expect(changes).toHaveLength(0);

    expect(cache.delete(record.sourcePath, record.sourceExt, record.targetExt)).toBe(true);
    expect(changes).toEqual([[]]);

    cache.clear();
    expect(changes).toHaveLength(1);

    cache.set(record);
    cache.clear();
    expect(changes.at(-1)).toEqual([]);
  });

  it("keeps only the newest converted asset records when over capacity", () => {
    const records = Array.from({ length: 205 }, (_value, index) => createRecord({
      sourcePath: `models/source-${index}.step`,
      outputPath: `models/source-${index}.glb`,
      createdAt: NOW + index,
    }));

    const cache = createConvertedAssetCache(records);
    const entries = cache.entries();

    expect(entries).toHaveLength(200);
    expect(entries[0].sourcePath).toBe("models/source-204.step");
    expect(entries.at(-1)?.sourcePath).toBe("models/source-5.step");
    expect(cache.get("models/source-0.step", "step", "glb")).toBeUndefined();
  });
});
