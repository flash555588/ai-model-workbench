export interface PreviewLoadOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

export class PreviewLoadInterruptedError extends Error {
  constructor(message = "Preview load interrupted") {
    super(message);
    this.name = "PreviewLoadInterruptedError";
  }
}

export function isPreviewLoadInterrupted(options?: PreviewLoadOptions): boolean {
  if (!options) {
    return false;
  }
  return options.signal?.aborted === true || options.isCurrent?.() === false;
}

export function throwIfPreviewLoadInterrupted(options?: PreviewLoadOptions): void {
  if (isPreviewLoadInterrupted(options)) {
    throw new PreviewLoadInterruptedError();
  }
}

export function isPreviewLoadInterruptedError(error: unknown): boolean {
  return error instanceof PreviewLoadInterruptedError
    || error instanceof Error && error.name === "AbortError";
}
