import { getFormatCapability, normalizeModelExt } from "../io/formats/registry";

const DIRECT_AUTOLOAD_EXTENSIONS = new Set(["glb", "gltf", "stl", "ply", "obj"]);
const LARGE_DIRECT_AUTOLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

export type DirectAutoloadFile = {
  extension: string;
  stat: {
    size: number;
  };
};

export type DirectAutoloadContext = {
  restoredFromWorkspace: boolean;
  preferConversionExts?: readonly string[];
};

export function shouldDeferDirectAutoload(
  file: DirectAutoloadFile,
  context: DirectAutoloadContext,
): boolean {
  const ext = normalizeModelExt(file.extension);
  const capability = getFormatCapability(ext);
  const preferConversion = context.preferConversionExts?.includes(ext) && !!capability?.converterId;
  if (capability?.strategy === "convert" || preferConversion) {
    return true;
  }
  if (!DIRECT_AUTOLOAD_EXTENSIONS.has(ext)) {
    return true;
  }
  if (!context.restoredFromWorkspace) {
    return false;
  }
  return file.stat.size >= LARGE_DIRECT_AUTOLOAD_LIMIT_BYTES;
}
