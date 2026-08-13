import type { FormatCapability } from "./types";

// Direct formats load in Babylon immediately.
// OBJ keeps a direct-first default because Babylon ships an OBJ loader.
// CAD family formats route through a converter and require the matching converter to be enabled in settings.
export const FORMAT_CAPABILITIES: readonly FormatCapability[] = [
  { ext: "glb", family: "mesh", strategy: "direct", directLoader: "gltf", displayName: "GLB", enabled: true },
  { ext: "gltf", family: "mesh", strategy: "direct", directLoader: "gltf", displayName: "glTF", enabled: true },
  { ext: "stl", family: "mesh", strategy: "direct", directLoader: "stl", displayName: "STL", enabled: true },
  { ext: "obj", family: "mesh", strategy: "direct", directLoader: "obj", converterId: "obj2gltf", outputFormat: "glb", displayName: "OBJ", enabled: true },
  { ext: "ply", family: "mesh", strategy: "direct", directLoader: "ply", displayName: "PLY", enabled: true },
  { ext: "fbx", family: "mesh", strategy: "convert", converterId: "fbx2gltf", outputFormat: "glb", displayName: "FBX", enabled: true },

  { ext: "step", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", displayName: "STEP", enabled: true },
  { ext: "stp", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", displayName: "STP", enabled: true },
  { ext: "iges", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", displayName: "IGES", enabled: true },
  { ext: "igs", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", displayName: "IGS", enabled: true },
  { ext: "brep", family: "cad", strategy: "convert", converterId: "freecad", outputFormat: "glb", displayName: "BREP", enabled: true },
  { ext: "sldprt", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", displayName: "SLDPRT", enabled: true },

  { ext: "3mf", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", displayName: "3MF", enabled: true },
  { ext: "dae", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", displayName: "COLLADA", enabled: true },
  { ext: "off", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", displayName: "OFF", enabled: true },
  { ext: "msh", family: "mesh", strategy: "convert", converterId: "assimp", outputFormat: "glb", displayName: "Gmsh", enabled: true },
  { ext: "x_t", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", displayName: "Parasolid", enabled: true },
  { ext: "x_b", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", displayName: "Parasolid", enabled: true },
  { ext: "catpart", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", displayName: "CATIA Part", enabled: true },
  { ext: "catproduct", family: "cad", strategy: "convert", converterId: "sldprt", outputFormat: "glb", displayName: "CATIA Product", enabled: true },
];

/**
 * Mutable capability registry seeded with the built-in formats. Runtime code
 * (e.g. a plugin or a settings-driven loader) can add or override capabilities
 * via `registerFormatCapability` without editing the built-in list.
 */
const registry = new Map<string, FormatCapability>(
  FORMAT_CAPABILITIES.map((capability) => [capability.ext, capability]),
);

export function normalizeModelExt(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\./, "");
}

/**
 * Register (or override) a format capability at runtime.
 *
 * Returns false when the extension normalizes to an empty string. Registration
 * replaces any existing capability for the same extension, including built-ins.
 */
export function registerFormatCapability(capability: FormatCapability): boolean {
  const ext = normalizeModelExt(capability.ext);
  if (!ext) return false;
  registry.set(ext, { ...capability, ext });
  return true;
}

/**
 * Remove a runtime-registered capability. Built-in capabilities cannot be
 * removed (only overridden); use `resetFormatCapabilities` to restore them.
 * Returns false when the extension is a built-in or was not registered.
 */
export function unregisterFormatCapability(ext: string): boolean {
  const normalized = normalizeModelExt(ext);
  if (!normalized) return false;
  if (FORMAT_CAPABILITIES.some((capability) => capability.ext === normalized)) {
    return false;
  }
  return registry.delete(normalized);
}

/** Restore the registry to the built-in set, dropping all runtime registrations. */
export function resetFormatCapabilities(): void {
  registry.clear();
  for (const capability of FORMAT_CAPABILITIES) {
    registry.set(capability.ext, capability);
  }
}

/** Snapshot all active (built-in + registered) capabilities. */
export function getFormatCapabilities(): FormatCapability[] {
  return Array.from(registry.values());
}

export function getFormatCapability(ext: string): FormatCapability | undefined {
  return registry.get(normalizeModelExt(ext));
}

/**
 * Resolve the direct-loader kind for an extension, or undefined when the
 * extension is not a direct format. Renderers dispatch on this kind instead of
 * hardcoding per-extension switches.
 */
export function getDirectLoaderKind(ext: string): string | undefined {
  const capability = getFormatCapability(ext);
  return capability?.strategy === "direct" ? capability.directLoader : undefined;
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
  return Array.from(registry.values())
    .filter((capability) => capability.enabled)
    .map((capability) => capability.ext);
}

export function listDirectModelExtensions(): string[] {
  return Array.from(registry.values())
    .filter((capability) => capability.enabled && capability.strategy === "direct")
    .map((capability) => capability.ext);
}
