import { describe, expect, it } from "vitest";

import { createConversionManager } from "./factory";
import type { ModelConverter } from "./types";

function createExtraConverter(): ModelConverter {
  return {
    id: "custom",
    sourceExts: ["usdz"],
    targetExt: "glb",
    getCacheKey: async () => "custom-key",
    convert: async () => ({
      outputPath: "/out/custom.glb",
      outputExt: "glb",
      fromCache: false,
      warnings: [],
    }),
  };
}

describe("createConversionManager", () => {
  it("registers extra converters unconditionally", () => {
    const manager = createConversionManager({
      extraConverters: [createExtraConverter()],
    });

    expect(manager.canConvert("usdz")).toBe(true);
  });

  it("keeps built-in converters opt-in via enabledConverterIds", () => {
    const manager = createConversionManager({ enabledConverterIds: ["obj2gltf"] });

    expect(manager.canConvert("obj")).toBe(true);
    expect(manager.canConvert("step")).toBe(false);
    expect(manager.canConvert("usdz")).toBe(false);
  });
});
