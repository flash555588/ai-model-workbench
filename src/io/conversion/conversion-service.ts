import type { FormatCapability } from "../formats/types";
import type { ConversionManager } from "./manager";
import { CONVERTED_ASSET_CACHE_VERSION, type ConvertedAssetCache } from "../cache/converted-asset-cache";
import { createLogger } from "../../utils/log";
import {
  F_OK,
  access,
  mkdir,
  pathBasename as basename,
  pathExtname as extname,
  pathJoin as join,
  stat,
} from "../../utils/node-shim";
import { MissingConverterError } from "./errors";

const log = createLogger("conversion-service");
export type ConversionManagerProvider = ConversionManager | (() => ConversionManager | Promise<ConversionManager>);

function hashPath(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeOutputStem(sourcePath: string): string {
  const sourceExt = extname(sourcePath);
  const rawStem = basename(sourcePath, sourceExt);
  const stem = rawStem
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return stem || "model";
}

function getConvertedOutputPath(sourcePath: string, targetExt: string, outputRoot?: string): string {
  if (!outputRoot) {
    return `${sourcePath}.ai3d-converted.${targetExt}`;
  }

  const stem = sanitizeOutputStem(sourcePath);
  const hash = hashPath(`${sourcePath}::${targetExt}`);
  return join(outputRoot, `${stem}-${hash}.ai3d-converted.${targetExt}`);
}

function hasMismatchedSourceHash(sourcePath: string, outputPath: string, targetExt: string): boolean {
  const outputName = basename(outputPath);
  if (outputName === `${basename(sourcePath, extname(sourcePath))}.ai3d-converted.${targetExt}`) return false;
  // Older relocation logic could persist another source's hashed output as a cache hit.
  if (!/-[a-f0-9]{8}\.ai3d-converted\.[^.]+$/.test(outputName)) return false;
  return outputName !== `${sanitizeOutputStem(sourcePath)}-${hashPath(`${sourcePath}::${targetExt}`)}.ai3d-converted.${targetExt}`;
}

export interface ConversionRouteInput {
  sourcePath: string;
  sourceExt: string;
  capability: FormatCapability;
  conversionManager?: ConversionManagerProvider;
  convertedAssetCache?: ConvertedAssetCache;
  outputRoot?: string;
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

async function isConvertedOutputReusable(
  sourcePath: string,
  outputPath: string,
  sourceStatsPromise?: Promise<{ mtimeMs: number }>,
): Promise<boolean> {
  if (!outputPath) return false;
  try {
    const [sourceStats, outputStats] = await Promise.all([sourceStatsPromise ?? stat(sourcePath), stat(outputPath)]);
    return outputStats.size > 0 && outputStats.mtimeMs >= sourceStats.mtimeMs;
  } catch {
    return false;
  }
}

async function resolveConversionManager(provider: ConversionManagerProvider | undefined): Promise<ConversionManager | undefined> {
  return typeof provider === "function" ? await provider() : provider;
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

  let sourceStatsPromise: ReturnType<typeof stat> | null = null;
  const getSourceStats = () => {
    sourceStatsPromise ??= stat(input.sourcePath);
    return sourceStatsPromise;
  };

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
    } else if (!isCachedRecordCompatible(cached, converterId) || hasMismatchedSourceHash(input.sourcePath, cached.outputPath, targetExt)) {
      log.warn("conversion cache identity mismatch", {
        sourcePath: input.sourcePath,
        sourceExt: input.sourceExt,
        targetExt,
        cachedConverterId: cached.converterId,
        cachedConverterCacheKey: cached.converterCacheKey,
        currentConverterId: converterId,
      });
      input.convertedAssetCache?.delete(input.sourcePath, input.sourceExt, targetExt);
    } else if (!(await isConvertedOutputReusable(input.sourcePath, cached.outputPath, getSourceStats()))) {
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

  const expectedOutputPath = getConvertedOutputPath(input.sourcePath, targetExt, input.outputRoot);
  if (await isConvertedOutputReusable(input.sourcePath, expectedOutputPath, getSourceStats())) {
    log.info("conversion output already exists", {
      sourcePath: input.sourcePath,
      outputPath: expectedOutputPath,
    });
    input.convertedAssetCache?.set({
      cacheVersion: CONVERTED_ASSET_CACHE_VERSION,
      converterId,
      converterCacheKey: converterId,
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

  const conversionManager = await resolveConversionManager(input.conversionManager);
  if (!conversionManager) {
    throw new Error(`Format .${input.sourceExt} requires conversion support, but no conversion manager is available.`);
  }

  if (!conversionManager.canConvert(input.sourceExt)) {
    throw new MissingConverterError(converterId, input.sourceExt);
  }

  const currentCacheIdentity = await conversionManager.getConverterCacheIdentity(input.sourceExt);
  if (input.outputRoot) {
    await mkdir(input.outputRoot, { recursive: true });
  }

  const result = await conversionManager.convert({
    sourcePath: input.sourcePath,
    sourceExt: input.sourceExt,
    targetExt,
    outputPath: expectedOutputPath,
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
