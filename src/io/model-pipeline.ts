import { getFormatCapability, isDisabledSplatExtension, normalizeModelExt } from "./formats/registry";
import type { LoadStrategy } from "./formats/types";
import type { ConvertedAssetCache } from "./cache/converted-asset-cache";
import { prepareDirectLoad } from "./direct/direct-load-service";
import type { ConversionManagerProvider } from "./conversion/conversion-service";
import { MobileConversionUnavailableError, ThreeRendererRequiredError } from "./conversion/errors";
import { supportsBabylonDirectFormat, supportsThreeDirectFormat } from "./formats/renderer-support";
import { createLogger } from "../utils/log";
import { isMobile } from "../utils/device";

const log = createLogger("model-pipeline");

export interface PrepareModelInput {
  path: string;
  absolutePath?: string;
  preferConversionExts?: readonly string[];
  conversionManager?: ConversionManagerProvider;
  convertedAssetCache?: ConvertedAssetCache;
  conversionOutputRoot?: string;
  /**
   * Enable bundled Three loaders only when the resolved preview uses Three.
   * Explicit conversion preferences and enabled FBX conversion retain priority.
   */
  allowThreeDirect?: boolean;
}

export interface PreparedModel {
  sourcePath: string;
  sourceExt: string;
  strategy: LoadStrategy;
  effectivePath: string;
  effectiveExt: string;
  warnings: string[];
}

function shouldPreferConversion(input: PrepareModelInput, sourceExt: string): boolean {
  return !!input.preferConversionExts?.includes(sourceExt);
}

export async function prepareModelInput(input: PrepareModelInput): Promise<PreparedModel> {
  const sourceExt = normalizeModelExt(input.path.split(".").pop() ?? "");
  const cap = getFormatCapability(sourceExt);

  log.info("prepare model input", { path: input.path, sourceExt });

  if (!cap || !cap.enabled) {
    log.warn("unsupported format", { sourceExt, path: input.path });
    if (isDisabledSplatExtension(sourceExt)) {
      throw new Error("SPLAT preview is disabled in packaged builds. Local-only .splat support is planned; .spz and .sog remain unavailable until their decoders can be bundled locally.");
    }
    throw new Error(`Unsupported format: .${sourceExt}`);
  }

  const preferConversion = shouldPreferConversion(input, sourceExt);
  const useConversion = cap.strategy === "convert" || (preferConversion && !!cap.converterId);
  const mobile = isMobile();
  const allowThreeDirect = !!input.allowThreeDirect && supportsThreeDirectFormat(sourceExt);
  let conversionManager = input.conversionManager;
  let preferFbxConversion = false;

  if (allowThreeDirect && sourceExt === "fbx" && !mobile) {
    const manager = typeof conversionManager === "function" ? await conversionManager() : conversionManager;
    conversionManager = manager;
    preferFbxConversion = !!manager?.canConvert(sourceExt);
  }

  if (allowThreeDirect && !preferFbxConversion && (!preferConversion || sourceExt === "fbx")) {
    log.info("three direct route", { sourceExt, loaderKind: cap.directLoader });
    return {
      sourcePath: input.path,
      sourceExt,
      strategy: "direct",
      effectivePath: input.path,
      effectiveExt: sourceExt,
      warnings: [`Loaded directly by the Three.js renderer (${cap.directLoader}).`],
    };
  }

  if (useConversion) {
    if (mobile) {
      log.warn("conversion unavailable on mobile", { sourceExt, path: input.path });
      throw new MobileConversionUnavailableError(sourceExt);
    }

    if (!input.absolutePath) {
      log.error("filesystem path missing for conversion", { sourceExt, path: input.path });
      throw new Error(
        `Format .${sourceExt} requires a local filesystem path for conversion, but none was resolved for '${input.path}'.`,
      );
    }

    const conversionCapability = cap.strategy === "convert"
      ? cap
      : { ...cap, strategy: "convert" as const, outputFormat: cap.outputFormat ?? "glb" as const };

    if (!conversionCapability.converterId) {
      log.error("preferred conversion route missing converter id", { sourceExt, path: input.path });
      throw new Error(`Format .${sourceExt} is configured to prefer conversion, but no converter id is defined.`);
    }

    if (preferConversion && cap.strategy === "direct") {
      log.info("preferred conversion route", { sourceExt, path: input.path, converterId: conversionCapability.converterId });
    }

    const { convertForPreview } = await import("./conversion/conversion-service");
    const result = await convertForPreview({
      sourcePath: input.absolutePath,
      sourceExt,
      capability: conversionCapability,
      conversionManager,
      convertedAssetCache: input.convertedAssetCache,
      outputRoot: input.conversionOutputRoot,
    });

    log.info("conversion completed", {
      sourceExt,
      outputExt: result.effectiveExt,
      outputPath: result.effectivePath,
      warningCount: result.warnings.length,
    });

    return {
      sourcePath: input.path,
      sourceExt,
      strategy: "convert",
      effectivePath: result.effectivePath,
      effectiveExt: result.effectiveExt,
      warnings: result.warnings,
    };
  }

  if (supportsThreeDirectFormat(sourceExt) && !supportsBabylonDirectFormat(sourceExt)) {
    throw new ThreeRendererRequiredError(sourceExt);
  }
  const direct = prepareDirectLoad({ path: input.path, sourceExt });
  log.debug("direct route", { sourceExt, path: input.path, warningCount: direct.warnings.length });

  return {
    sourcePath: input.path,
    sourceExt,
    strategy: cap.strategy,
    effectivePath: direct.effectivePath,
    effectiveExt: direct.effectiveExt,
    warnings: direct.warnings,
  };
}
