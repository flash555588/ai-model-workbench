export interface ConversionRequest {
  sourcePath: string;
  sourceExt: string;
  targetExt: "glb";
  timeoutMs?: number;
}

export interface ConversionResult {
  outputPath: string;
  outputExt: "glb";
  fromCache: boolean;
  warnings: string[];
}

export interface ModelConverter {
  readonly id: string;
  readonly sourceExts: readonly string[];
  readonly targetExt: "glb";
  getCacheKey(): Promise<string>;
  convert(req: ConversionRequest): Promise<ConversionResult>;
}
