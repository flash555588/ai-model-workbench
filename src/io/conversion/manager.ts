import { normalizeModelExt } from "../formats/registry";
import type { ConversionRequest, ConversionResult, ModelConverter } from "./types";
import { createLogger } from "../../utils/log";

const log = createLogger("conversion-manager");

const DEFAULT_CONVERSION_TIMEOUT_MS = 300_000;

export class ConversionTimeoutError extends Error {
  constructor(message = "Conversion timed out") {
    super(message);
    this.name = "ConversionTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, _context: Record<string, unknown>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = window.setTimeout(() => {
      reject(new ConversionTimeoutError(`Conversion did not complete within ${ms}ms`));
    }, ms);
    promise.then(() => window.clearTimeout(id)).catch(() => window.clearTimeout(id));
  });
  return Promise.race([promise, timeout]);
}

export class ConversionManager {
  private readonly converters = new Map<string, ModelConverter>();
  private readonly pending = new Map<string, Promise<ConversionResult>>();

  private getConverter(ext: string): ModelConverter | undefined {
    return this.converters.get(normalizeModelExt(ext));
  }

  registerConverter(converter: ModelConverter): void {
    log.info("register converter", { converterId: converter.id, sourceExts: [...converter.sourceExts] });
    for (const ext of converter.sourceExts) {
      this.converters.set(normalizeModelExt(ext), converter);
    }
  }

  canConvert(ext: string): boolean {
    const normalized = normalizeModelExt(ext);
    const ok = this.converters.has(normalized);
    log.debug("can convert", { ext: normalized, ok });
    return ok;
  }

  async getConverterCacheIdentity(ext: string): Promise<{ converterId: string; cacheKey: string } | undefined> {
    const converter = this.getConverter(ext);
    if (!converter) {
      return undefined;
    }

    return {
      converterId: converter.id,
      cacheKey: await converter.getCacheKey(),
    };
  }

  async convert(req: ConversionRequest): Promise<ConversionResult> {
    const ext = normalizeModelExt(req.sourceExt);
    const converter = this.getConverter(ext);
    if (!converter) {
      log.error("converter missing", { ext, targetExt: req.targetExt });
      throw new Error(`No converter registered for .${ext}`);
    }

    // Deduplicate concurrent conversions for the same source + target
    const key = `${req.sourcePath}::${ext}::${req.targetExt}`;
    let conversion = this.pending.get(key);
    if (conversion) {
      log.info("joining in-flight conversion", { key });
    } else {
      log.info("dispatch conversion", { converterId: converter.id, ext, targetExt: req.targetExt });
      conversion = converter.convert({ ...req, sourceExt: ext });
      this.pending.set(key, conversion);
      const clearPending = (): void => {
        if (this.pending.get(key) === conversion) {
          this.pending.delete(key);
        }
      };
      void conversion.then(clearPending, clearPending);
    }

    return withTimeout(
      conversion,
      req.timeoutMs ?? DEFAULT_CONVERSION_TIMEOUT_MS,
      { converterId: converter.id, ext, targetExt: req.targetExt },
    );
  }
}
