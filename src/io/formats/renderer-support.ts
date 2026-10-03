import { getFormatCapabilities, getFormatCapability } from "./registry";

const BABYLON_DIRECT_LOADERS = new Set(["gltf", "obj", "stl", "ply"]);
const THREE_DIRECT_LOADERS = new Set([
  ...BABYLON_DIRECT_LOADERS,
  "three-fbx", "three-3mf", "three-dae", "three-off", "three-pcd", "three-xyz",
]);

export function supportsThreeDirectFormat(ext: string): boolean {
  const capability = getFormatCapability(ext);
  return !!capability?.enabled && !!capability.directLoader && THREE_DIRECT_LOADERS.has(capability.directLoader);
}

export function supportsBabylonDirectFormat(ext: string): boolean {
  const capability = getFormatCapability(ext);
  return !!capability?.enabled && !!capability.directLoader && BABYLON_DIRECT_LOADERS.has(capability.directLoader);
}

export function listThreeDirectFormats(): string[] {
  return getFormatCapabilities().filter((capability) => supportsThreeDirectFormat(capability.ext)).map((capability) => capability.ext);
}
