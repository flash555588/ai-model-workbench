import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionManager } from "./conversion/manager";

const conversionMocks = vi.hoisted(() => ({
  convertForPreview: vi.fn(),
}));

vi.mock("../utils/device", () => ({
  isMobile: () => false,
}));

vi.mock("./conversion/conversion-service", () => ({
  convertForPreview: conversionMocks.convertForPreview,
}));

import { prepareModelInput } from "./model-pipeline";

describe("prepareModelInput", () => {
  beforeEach(() => {
    conversionMocks.convertForPreview.mockReset();
    conversionMocks.convertForPreview.mockResolvedValue({
      effectivePath: "/vault/models/part.ai3d-converted.glb",
      effectiveExt: "glb",
      warnings: [],
    });
  });

  it("does not create a conversion manager for direct formats", async () => {
    const createConversionManager = vi.fn(() => {
      throw new Error("conversion manager should not be created for direct GLB");
    });

    const result = await prepareModelInput({
      path: "models/part.glb",
      absolutePath: "/vault/models/part.glb",
      conversionManager: createConversionManager,
    });

    expect(result).toMatchObject({
      sourcePath: "models/part.glb",
      sourceExt: "glb",
      strategy: "direct",
      effectivePath: "models/part.glb",
      effectiveExt: "glb",
    });
    expect(createConversionManager).not.toHaveBeenCalled();
    expect(conversionMocks.convertForPreview).not.toHaveBeenCalled();
  });

  it("passes a lazy conversion manager provider only when the selected route converts", async () => {
    const conversionManager = { canConvert: vi.fn(() => true) } as unknown as ConversionManager;
    const createConversionManager = vi.fn(() => conversionManager);

    const result = await prepareModelInput({
      path: "models/part.obj",
      absolutePath: "/vault/models/part.obj",
      preferConversionExts: ["obj"],
      conversionManager: createConversionManager,
    });

    expect(createConversionManager).not.toHaveBeenCalled();
    expect(conversionMocks.convertForPreview).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "/vault/models/part.obj",
      sourceExt: "obj",
      conversionManager: createConversionManager,
    }));
    expect(result).toMatchObject({
      sourcePath: "models/part.obj",
      sourceExt: "obj",
      strategy: "convert",
      effectivePath: "/vault/models/part.ai3d-converted.glb",
      effectiveExt: "glb",
    });
  });
});
