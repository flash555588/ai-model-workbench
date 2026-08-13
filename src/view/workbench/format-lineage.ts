import type { ModelAssetFormat, ModelLoadStrategy } from "../../domain/models";

const SUPPORTED_ANALYSIS_FORMATS = new Set<ModelAssetFormat>([
  "glb",
  "gltf",
  "stl",
  "obj",
  "splat",
  "ply",
  "fbx",
  "step",
  "stp",
  "iges",
  "igs",
  "brep",
  "sldprt",
  "3mf",
  "dae",
  "off",
  "msh",
  "x_t",
  "x_b",
  "catpart",
  "catproduct",
]);

const SUPPORTED_LOAD_STRATEGIES = new Set(["direct", "convert"]);

export function inferModelAssetFormat(value: string | null | undefined): ModelAssetFormat {
  const ext = (value ?? "").split(".").pop()?.trim().toLowerCase();
  if (SUPPORTED_ANALYSIS_FORMATS.has(ext as ModelAssetFormat)) {
    return ext as ModelAssetFormat;
  }
  return "glb";
}

export function normalizeModelLoadStrategy(
  value: unknown,
  sourceFormat: ModelAssetFormat,
  effectiveFormat: ModelAssetFormat,
): ModelLoadStrategy {
  if (typeof value === "string" && SUPPORTED_LOAD_STRATEGIES.has(value)) {
    return value as "direct" | "convert";
  }
  return sourceFormat === effectiveFormat ? "direct" : "convert";
}
