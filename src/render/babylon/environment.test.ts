import { describe, expect, it } from "vitest";
import { Constants } from "@babylonjs/core/Engines/constants.js";

/**
 * `environment.ts` itself only wraps the face data in a `RawCubeTexture`, which
 * needs a live engine to construct. The gradient logic is covered by
 * `environment-data.test.ts`; this file pins the texture constants that the
 * wrapper depends on, so a Babylon upgrade renumbering them fails loudly here
 * instead of silently producing a black environment at runtime.
 */
describe("babylon studio environment texture constants", () => {
  it("uses the texture format and type the face data is encoded for", () => {
    // createBabylonStudioEnvironmentFaces emits 4 bytes per texel, 0-255 per channel.
    expect(Constants.TEXTUREFORMAT_RGBA).toBe(5);
    expect(Constants.TEXTURETYPE_UNSIGNED_BYTE).toBe(0);
  });

  it("uses cubic coordinates for environment sampling", () => {
    expect(Constants.TEXTURE_CUBIC_MODE).toBe(3);
  });
});
