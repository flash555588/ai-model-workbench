import { normalizeModelExt } from "../formats/registry";
import type { ConversionRequest, ConversionResult, ModelConverter } from "./types";
import { createLogger } from "../../utils/log";

const log = createLogger("conversion-manager");

const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000;

export class ConversionTimeoutError extends Error {
  constructor(message = "Conversion timed out") {
    super(message);
    this.name = "ConversionTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, _context: Record<string, unknown>): Promise<T> {
  const setTimer = typeof activeWindow !== "undefined" ? activeWindow.setTimeout.bind(activeWindow) : setTimeout;
  const clearTimer = typeof activeWindow !== "undefined" ? activeWindow.clearTimeout.bind(activeWindow) : clearTimeout;
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimer(() => {
      reject(new ConversionTimeoutError(`Conversion did not complete within ${ms}ms`));
    }, ms);
    promise.then(() => clearTimer(id)).catch(() => clearTimer(id));
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
    const existing = this.pending.get(key);
    if (existing) {
      log.info("joining in-flight conversion", { key });
      return existing;
    }

    log.info("dispatch conversion", { converterId: converter.id, ext, targetExt: req.targetExt });
    const promise = withTimeout(
      converter.convert({ ...req, sourceExt: ext }),
      req.timeoutMs ?? DEFAULT_CONVERSION_TIMEOUT_MS,
      { converterId: converter.id, ext, targetExt: req.targetExt },
    );
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
}
