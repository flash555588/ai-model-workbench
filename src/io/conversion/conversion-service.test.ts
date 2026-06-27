import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ConvertedAssetRecord } from "../../domain/models";
import type { ConvertedAssetCache } from "../cache/converted-asset-cache";
import { CONVERTED_ASSET_CACHE_VERSION } from "../cache/converted-asset-cache";
import type { FormatCapability } from "../formats/types";
import type { ConversionManager } from "./manager";

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../../utils/node-shim", () => ({
  F_OK: 0,
  access: fsMocks.access,
  mkdir: fsMocks.mkdir,
  pathBasename: (path: string, ext?: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  },
  pathExtname: (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? "";
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot) : "";
  },
  pathJoin: (...segments: string[]) => segments.join("/").replace(/\/+/g, "/"),
  stat: fsMocks.stat,
}));

import { convertForPreview } from "./conversion-service";

const capability: FormatCapability = {
  ext: "step",
  family: "cad",
  strategy: "convert",
  converterId: "freecad",
  outputFormat: "glb",
  enabled: true,
};

function createManager() {
  const canConvert = vi.fn(() => true);
  const getConverterCacheIdentity = vi.fn(async () => {
      throw new Error("converter identity probe should not run for reusable outputs");
    });
  const convert = vi.fn(async () => {
      throw new Error("conversion should not run for reusable outputs");
    });
  const manager = {
    canConvert,
    getConverterCacheIdentity,
    convert,
  } as unknown as ConversionManager;
  return { manager, canConvert, getConverterCacheIdentity, convert };
}

function mockReusableConvertedOutput(_sourcePath: string, outputPath: string): void {
  fsMocks.access.mockResolvedValue(undefined);
  fsMocks.stat.mockImplementation(async (path: string) => ({
    size: path === outputPath ? 1024 : 2048,
    mtimeMs: path === outputPath ? 200 : 100,
  }));
}

describe("convertForPreview", () => {
  beforeEach(() => {
    fsMocks.access.mockReset();
    fsMocks.mkdir.mockReset();
    fsMocks.stat.mockReset();
    fsMocks.mkdir.mockResolvedValue(undefined);
  });

  it("reuses an existing converted output without probing converter identity", async () => {
    const sourcePath = "/vault/models/board.step";
    const outputPath = "/vault/models/board.ai3d-converted.glb";
    const { manager, getConverterCacheIdentity, convert } = createManager();
    const cache = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as ConvertedAssetCache;
    mockReusableConvertedOutput(sourcePath, outputPath);

    const result = await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: manager,
      convertedAssetCache: cache,
    });

    expect(result).toEqual({
      effectivePath: outputPath,
      effectiveExt: "glb",
      warnings: ["Using existing conversion output."],
    });
    expect(getConverterCacheIdentity).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
    expect(cache.set).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath,
      outputPath,
      converterCacheKey: "freecad",
    }));
  });

  it("reuses an existing converted output without creating a lazy conversion manager", async () => {
    const sourcePath = "/vault/models/case.step";
    const outputPath = "/vault/models/case.ai3d-converted.glb";
    const createManager = vi.fn(() => {
      throw new Error("conversion manager should not be created for reusable outputs");
    });
    mockReusableConvertedOutput(sourcePath, outputPath);

    const result = await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: createManager,
    });

    expect(result).toEqual({
      effectivePath: outputPath,
      effectiveExt: "glb",
      warnings: ["Using existing conversion output."],
    });
    expect(createManager).not.toHaveBeenCalled();
  });

  it("reuses a cached conversion record without probing converter identity", async () => {
    const sourcePath = "/vault/models/plate.step";
    const outputPath = "/vault/models/plate.ai3d-converted.glb";
    const { manager, getConverterCacheIdentity, convert } = createManager();
    const record: ConvertedAssetRecord = {
      cacheVersion: CONVERTED_ASSET_CACHE_VERSION,
      converterId: "freecad",
      converterCacheKey: "freecad:old",
      sourcePath,
      sourceExt: "step",
      targetExt: "glb",
      outputPath,
      outputExt: "glb",
      warnings: ["Previous warning"],
      createdAt: Date.now(),
    };
    const cache = {
      get: vi.fn(() => record),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as ConvertedAssetCache;
    mockReusableConvertedOutput(sourcePath, outputPath);

    const result = await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: manager,
      convertedAssetCache: cache,
    });

    expect(result).toEqual({
      effectivePath: outputPath,
      effectiveExt: "glb",
      warnings: ["Previous warning", "Using cached conversion output."],
    });
    expect(getConverterCacheIdentity).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it("writes new conversions to the configured output root", async () => {
    const sourcePath = "/vault/models/board.step";
    const outputRoot = "/vault/.custom-obsidian/ai-model-workbench/converted-assets";
    const canConvert = vi.fn(() => true);
    const getConverterCacheIdentity = vi.fn(async () => ({ converterId: "freecad", cacheKey: "freecad:v2" }));
    const convert = vi.fn(async (req: { outputPath?: string }) => ({
        outputPath: req.outputPath ?? "/unexpected.glb",
        outputExt: "glb",
        fromCache: false,
        warnings: [],
      }));
    const manager = {
      canConvert,
      getConverterCacheIdentity,
      convert,
    } as unknown as ConversionManager;
    const cache = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as ConvertedAssetCache;
    fsMocks.stat.mockRejectedValue(new Error("missing"));

    const result = await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: manager,
      convertedAssetCache: cache,
      outputRoot,
    });

    expect(fsMocks.mkdir).toHaveBeenCalledWith(outputRoot, { recursive: true });
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert.mock.calls[0]?.[0].outputPath)
      .toMatch(/^\/vault\/\.custom-obsidian\/ai-model-workbench\/converted-assets\/board-[a-f0-9]{8}\.ai3d-converted\.glb$/);
    expect(result.effectivePath).toMatch(/^\/vault\/\.custom-obsidian\/ai-model-workbench\/converted-assets\/board-[a-f0-9]{8}\.ai3d-converted\.glb$/);
    expect(cache.set).toHaveBeenCalledWith(expect.objectContaining({
      outputPath: result.effectivePath,
      converterCacheKey: "freecad:v2",
    }));
  });

  it("creates a lazy conversion manager only when conversion is required", async () => {
    const sourcePath = "/vault/models/missing-output.step";
    const canConvert = vi.fn(() => true);
    const getConverterCacheIdentity = vi.fn(async () => ({ converterId: "freecad", cacheKey: "freecad:v3" }));
    const convert = vi.fn(async (req: { outputPath?: string }) => ({
        outputPath: req.outputPath ?? "/unexpected.glb",
        outputExt: "glb",
        fromCache: false,
        warnings: [],
      }));
    const manager = {
      canConvert,
      getConverterCacheIdentity,
      convert,
    } as unknown as ConversionManager;
    const createManager = vi.fn(() => manager);
    fsMocks.stat.mockRejectedValue(new Error("missing"));

    await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: createManager,
    });

    expect(createManager).toHaveBeenCalledTimes(1);
    expect(canConvert).toHaveBeenCalledWith("step");
    expect(convert).toHaveBeenCalled();
  });

  it("reuses source file stats while checking expected and legacy outputs", async () => {
    const sourcePath = "/vault/models/bracket.step";
    const outputRoot = "/vault/.custom-obsidian/ai-model-workbench/converted-assets";
    const legacyOutputPath = "/vault/models/bracket.ai3d-converted.glb";
    const { manager, getConverterCacheIdentity, convert } = createManager();
    const cache = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
    } as unknown as ConvertedAssetCache;
    fsMocks.stat.mockImplementation(async (path: string) => {
      if (path === sourcePath) {
        return { size: 2048, mtimeMs: 100 };
      }
      if (path === legacyOutputPath) {
        return { size: 1024, mtimeMs: 200 };
      }
      throw new Error("missing");
    });

    const result = await convertForPreview({
      sourcePath,
      sourceExt: "step",
      capability,
      conversionManager: manager,
      convertedAssetCache: cache,
      outputRoot,
    });

    expect(result).toEqual({
      effectivePath: legacyOutputPath,
      effectiveExt: "glb",
      warnings: ["Using existing conversion output."],
    });
    expect(fsMocks.stat.mock.calls.filter(([path]) => path === sourcePath)).toHaveLength(1);
    expect(getConverterCacheIdentity).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });
});
