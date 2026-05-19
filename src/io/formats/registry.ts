import type { FormatCapability } from "./types";

// Direct formats load in Babylon immediately.
// OBJ keeps a direct-first default because Babylon ships an OBJ loader.
// CAD family formats route through a converter and require the matching converter to be enabled in settings.
export const FORMAT_CAPABILITIES: readonly FormatCapability[] = [
  { ext: "glb", family: "mesh", strategy: "direct", directLoader: "babylon", enabled: true },
  { ext: "gltf", family: "mesh", strategy: "direct", directLoader: "babylon", enabled: true },
  { ext: "stl", family: "mesh", strategy: "direct", directLoader: "custom-stl", enabled: true },
  { ext: "obj", family: "mesh", strategy: "direct", directLoader: "babylon", converterId: "obj2gltf", outputFormat: "glb", enabled: true },
  { ext: "ply", family: "mesh", strategy: "direct", directLoader: "custom-ply", enabled: true },
  { ext: "fbx", family: "mesh", strategy: "convert", converterId: "fbx2gltf", outputFormat: "glb", enabled: true },

  { ext: "step", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", enabled: true },
  { ext: "stp", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", enabled: true },
  { ext: "iges", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", enabled: true },
  { ext: "igs", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", enabled: true },
  { ext: "brep", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", enabled: true },
  { ext: "sldprt", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", enabled: true },

  { ext: "3mf", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", enabled: true },
  { ext: "dae", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", enabled: true },
];

const CAPABILITIES_BY_EXT = new Map(FORMAT_CAPABILITIES.map((c) => [c.ext, c]));

export function normalizeModelExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\./, "");
}

export function getFormatCapability(ext: string): FormatCapability | undefined {
  return CAPABILITIES_BY_EXT.get(normalizeModelExt(ext));
}

export function isSupportedModelExtension(ext: string): boolean {
  const cap = getFormatCapability(ext);
  return !!cap?.enabled;
}

export function isDisabledSplatExtension(ext: string): boolean {
  return ["splat", "spz", "sog"].includes(normalizeModelExt(ext));
}

export function isDirectModelExtension(ext: string): boolean {
  const cap = getFormatCapability(ext);
  return !!cap?.enabled && cap.strategy === "direct";
}

export function listSupportedModelExtensions(): string[] {
  return FORMAT_CAPABILITIES.filter((c) => c.enabled).map((c) => c.ext);
}

export function listDirectModelExtensions(): string[] {
  return FORMAT_CAPABILITIES.filter((c) => c.enabled && c.strategy === "direct").map((c) => c.ext);
}
