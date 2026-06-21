import type { FormatCapability } from "../formats/types";
import type { ConversionManager } from "./manager";
import { CONVERTED_ASSET_CACHE_VERSION, type ConvertedAssetCache } from "../cache/converted-asset-cache";
import { createLogger } from "../../utils/log";
import { F_OK, access, stat } from "../../utils/node-shim";
import { MissingConverterError } from "./errors";

const log = createLogger("conversion-service");

function getConvertedOutputPath(sourcePath: string, targetExt: string): string {
  const lastDot = sourcePath.lastIndexOf(".");
  const base = lastDot > 0 ? sourcePath.slice(0, lastDot) : sourcePath;
  const lastSep = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const dir = base.slice(0, lastSep + 1);
  const name = base.slice(lastSep + 1);
  return `${dir}${name}.ai3d-converted.${targetExt}`;
}

export interface ConversionRouteInput {
  sourcePath: string;
  sourceExt: string;
  capability: FormatCapability;
  conversionManager: ConversionManager;
  convertedAssetCache?: ConvertedAssetCache;
}

export interface ConversionRouteResult {
  effectivePath: string;
  effectiveExt: "glb";
  warnings: string[];
}

function isCachedRecordCompatible(
  cached: { converterId: string; converterCacheKey: string },
  expectedConverterId: string,
  currentIdentity?: { converterId: string; cacheKey: string },
): boolean {
  if (cached.converterId !== expectedConverterId) {
    return false;
  }

  if (!currentIdentity) {
    return true;
  }

  return (
    cached.converterId === currentIdentity.converterId &&
    cached.converterCacheKey === currentIdentity.cacheKey
  );
}

async function isCachedOutputAvailable(outputPath: string): Promise<boolean> {
  if (!outputPath) return false;
  try {
    await access(outputPath, F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isConvertedOutputReusable(sourcePath: string, outputPath: string): Promise<boolean> {
  if (!outputPath) return false;
  try {
    const [sourceStats, outputStats] = await Promise.all([stat(sourcePath), stat(outputPath)]);
    return outputStats.size > 0 && outputStats.mtimeMs >= sourceStats.mtimeMs;
  } catch {
    return false;
  }
}

export async function convertForPreview(input: ConversionRouteInput): Promise<ConversionRouteResult> {
  if (input.capability.strategy !== "convert") {
    throw new Error(`Expected convert strategy, got '${input.capability.strategy}'.`);
  }

  const converterId = input.capability.converterId;
  const targetExt = input.capability.outputFormat ?? "glb";

  if (!converterId) {
    throw new Error(`Format .${input.sourceExt} does not define a converter id.`);
  }

  log.info("prepare conversion route", {
    sourcePath: input.sourcePath,
    sourceExt: input.sourceExt,
    targetExt,
    converterId,
  });

  const currentCacheIdentity = input.conversionManager.canConvert(input.sourceExt)
    ? await input.conversionManager.getConverterCacheIdentity(input.sourceExt)
    : undefined;

  const cached = input.convertedAssetCache?.get(input.sourcePath, input.sourceExt, targetExt);
  if (cached) {
    if (!(await isCachedOutputAvailable(cached.outputPath))) {
      log.warn("conversion cache stale", {
        sourcePath: input.sourcePath,
        sourceExt: input.sourceExt,
        targetExt,
        outputPath: cached.outputPath,
      });
      input.convertedAssetCache?.delete(input.sourcePath, input.sourceExt, targetExt);
    } else if (!isCachedRecordCompatible(cached, converterId, currentCacheIdentity)) {
      log.warn("conversion cache identity mismatch", {
        sourcePath: input.sourcePath,
        sourceExt: input.sourceExt,
        targetExt,
        cachedConverterId: cached.converterId,
        cachedConverterCacheKey: cached.converterCacheKey,
        currentConverterId: currentCacheIdentity?.converterId ?? converterId,
        currentConverterCacheKey: currentCacheIdentity?.cacheKey,
      });
      input.convertedAssetCache?.delete(input.sourcePath, input.sourceExt, targetExt);
    } else if (!(await isConvertedOutputReusable(input.sourcePath, cached.outputPath))) {
      log.warn("conversion cache output older than source", {
        sourcePath: input.sourcePath,
        sourceExt: input.sourceExt,
        targetExt,
        outputPath: cached.outputPath,
      });
      input.convertedAssetCache?.delete(input.sourcePath, input.sourceExt, targetExt);
    } else {
      log.info("conversion cache hit", {
        sourcePath: input.sourcePath,
        sourceExt: input.sourceExt,
        targetExt,
        outputPath: cached.outputPath,
      });
      return {
        effectivePath: cached.outputPath,
        effectiveExt: cached.outputExt,
        warnings: [...cached.warnings, "Using cached conversion output."],
      };
    }
  }

  const expectedOutputPath = getConvertedOutputPath(input.sourcePath, targetExt);
  if (await isConvertedOutputReusable(input.sourcePath, expectedOutputPath)) {
    log.info("conversion output already exists", {
      sourcePath: input.sourcePath,
      outputPath: expectedOutputPath,
    });
    input.convertedAssetCache?.set({
      cacheVersion: CONVERTED_ASSET_CACHE_VERSION,
      converterId,
      converterCacheKey: currentCacheIdentity?.cacheKey ?? converterId,
      sourcePath: input.sourcePath,
      sourceExt: input.sourceExt,
      targetExt,
      outputPath: expectedOutputPath,
      outputExt: targetExt,
      warnings: ["Using existing conversion output."],
      createdAt: Date.now(),
    });
    return {
      effectivePath: expectedOutputPath,
      effectiveExt: targetExt,
      warnings: ["Using existing conversion output."],
    };
  }

  if (!input.conversionManager.canConvert(input.sourceExt)) {
    throw new MissingConverterError(converterId, input.sourceExt);
  }

  const result = await input.conversionManager.convert({
    sourcePath: input.sourcePath,
    sourceExt: input.sourceExt,
    targetExt,
  });

  input.convertedAssetCache?.set({
    cacheVersion: CONVERTED_ASSET_CACHE_VERSION,
    converterId,
    converterCacheKey: currentCacheIdentity?.cacheKey ?? converterId,
    sourcePath: input.sourcePath,
    sourceExt: input.sourceExt,
    targetExt,
    outputPath: result.outputPath,
    outputExt: result.outputExt,
    warnings: result.warnings,
    createdAt: Date.now(),
  });

  log.info("conversion route done", {
    sourcePath: input.sourcePath,
    outputPath: result.outputPath,
    warningCount: result.warnings.length,
  });

  return {
    effectivePath: result.outputPath,
    effectiveExt: result.outputExt,
    warnings: result.warnings,
  };
}
