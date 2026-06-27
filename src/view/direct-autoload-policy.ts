const DIRECT_AUTOLOAD_EXTENSIONS = new Set(["glb", "gltf", "stl", "ply", "obj"]);
const LARGE_DIRECT_AUTOLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

export type DirectAutoloadFile = {
  extension: string;
  stat: {
    size: number;
  };
};

export function shouldDeferDirectAutoload(
  file: DirectAutoloadFile,
  restoredFromWorkspace: boolean,
): boolean {
  const ext = file.extension.toLowerCase();
  if (!DIRECT_AUTOLOAD_EXTENSIONS.has(ext)) {
    return true;
  }
  if (!restoredFromWorkspace) {
    return false;
  }
  return file.stat.size >= LARGE_DIRECT_AUTOLOAD_LIMIT_BYTES;
}
