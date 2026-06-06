// Side-effect imports: register Babylon SceneLoader plugins.
// Each import calls RegisterSceneLoaderPlugin() as a side-effect.

// glTF/GLB: both required. glTFFileLoader sets up the plugin, and the 2.0
// loader registers itself through GLTFFileLoader._CreateGLTF2Loader.
import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/ExtrasAsMetadata";

// OBJ: classic mesh format with MTL material support.
import "@babylonjs/loaders/OBJ/objFileLoader";

import { RegisterSceneLoaderPlugin } from "@babylonjs/core/Loading/sceneLoader.js";
import { configureBabylonNetworkGuards } from "../network-guard";
import { registerSTLLoader } from "./stl-loader";
import { registerPLYLoader } from "./ply-loader";

let customLoadersReady = false;

/** Register custom SceneLoader plugins that are not provided by Babylon packages. */
export async function ensureLoadersRegistered(): Promise<void> {
  if (customLoadersReady) return;

  configureBabylonNetworkGuards();
  registerSTLLoader(RegisterSceneLoaderPlugin);
  registerPLYLoader(RegisterSceneLoaderPlugin);
  customLoadersReady = true;
}
