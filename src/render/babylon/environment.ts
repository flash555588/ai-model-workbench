import { Constants } from "@babylonjs/core/Engines/constants.js";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture.js";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import type { Scene } from "@babylonjs/core/scene.js";

import {
  createBabylonStudioEnvironmentFaces,
  ENVIRONMENT_FACE_SIZE,
} from "./environment-data";

/**
 * Procedural image-based lighting for the Babylon preview.
 *
 * Babylon's own `EnvironmentHelper` downloads its skybox and `.env` files from
 * assets.babylonjs.com, which `network-guard.ts` refuses. This module synthesises
 * an equivalent studio environment in memory so PBR materials get real specular
 * reflections without any network access.
 */

/**
 * Build a local studio environment texture for image-based lighting.
 *
 * The caller owns the texture and must dispose it.
 */
export function createBabylonStudioEnvironment(scene: Scene): BaseTexture {
  const texture = new RawCubeTexture(
    scene,
    createBabylonStudioEnvironmentFaces(),
    ENVIRONMENT_FACE_SIZE,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
  );
  texture.name = "ai3d-studio-environment";
  // Environment data is linear; treating it as gamma would wash out reflections.
  texture.gammaSpace = false;
  texture.coordinatesMode = Constants.TEXTURE_CUBIC_MODE;
  return texture;
}
