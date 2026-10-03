import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionManager } from "./conversion/manager";

const conversionMocks = vi.hoisted(() => ({
  convertForPreview: vi.fn(),
  moduleLoadCount: { value: 0 },
  mobile: { value: false },
}));

vi.mock("../utils/device", () => ({
  isMobile: () => conversionMocks.mobile.value,
}));

vi.mock("./conversion/conversion-service", () => {
  conversionMocks.moduleLoadCount.value++;
  return {
    convertForPreview: conversionMocks.convertForPreview,
  };
});

import { prepareModelInput } from "./model-pipeline";

describe("prepareModelInput", () => {
  beforeEach(() => {
    conversionMocks.mobile.value = false;
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
    expect(conversionMocks.moduleLoadCount.value).toBe(0);
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

  it("preserves explicit OBJ conversion on a Three route", async () => {
    const result = await prepareModelInput({
      path: "models/part.obj",
      absolutePath: "/vault/models/part.obj",
      preferConversionExts: ["obj"],
      allowThreeDirect: true,
    });
    expect(result.strategy).toBe("convert");
    expect(conversionMocks.convertForPreview).toHaveBeenCalledOnce();
  });

  it("prefers an enabled FBX converter on a Three route", async () => {
    const manager = { canConvert: vi.fn(() => true) } as unknown as ConversionManager;
    const provider = vi.fn(() => manager);
    const result = await prepareModelInput({
      path: "models/part.fbx",
      absolutePath: "/vault/models/part.fbx",
      conversionManager: provider,
      allowThreeDirect: true,
    });
    expect(result.strategy).toBe("convert");
    expect(provider).toHaveBeenCalledOnce();
    expect(conversionMocks.convertForPreview).toHaveBeenCalledWith(expect.objectContaining({
      conversionManager: manager,
    }));
  });

  it("uses the Three FBX loader when the converter is disabled", async () => {
    const canConvert = vi.fn(() => false);
    const manager = { canConvert } as unknown as ConversionManager;
    const result = await prepareModelInput({
      path: "models/part.fbx",
      conversionManager: manager,
      allowThreeDirect: true,
    });
    expect(result.strategy).toBe("direct");
    expect(canConvert).toHaveBeenCalledWith("fbx");
    expect(conversionMocks.convertForPreview).not.toHaveBeenCalled();
  });

  it.each(["3mf", "dae", "off", "pcd", "xyz"])("loads %s without creating a converter on Three", async (ext) => {
    const provider = vi.fn(() => { throw new Error("unexpected desktop converter access"); });
    const result = await prepareModelInput({
      path: `models/part.${ext}`,
      conversionManager: provider,
      allowThreeDirect: true,
    });
    expect(result).toMatchObject({ strategy: "direct", effectiveExt: ext });
    expect(provider).not.toHaveBeenCalled();
    expect(conversionMocks.convertForPreview).not.toHaveBeenCalled();
  });

  it("never discovers desktop FBX tools on mobile", async () => {
    conversionMocks.mobile.value = true;
    const provider = vi.fn(() => { throw new Error("unexpected desktop converter access"); });
    const result = await prepareModelInput({
      path: "models/part.fbx",
      conversionManager: provider,
      allowThreeDirect: true,
    });
    expect(result.strategy).toBe("direct");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(["pcd", "xyz"])("explains the required renderer for %s in compatibility mode", async (ext) => {
    await expect(prepareModelInput({ path: `models/part.${ext}` })).rejects.toThrow("Three.js");
    expect(conversionMocks.convertForPreview).not.toHaveBeenCalled();
  });

  it("preserves converter failures instead of silently changing the FBX route", async () => {
    const manager = { canConvert: vi.fn(() => true) } as unknown as ConversionManager;
    conversionMocks.convertForPreview.mockRejectedValue(new Error("conversion timed out"));
    await expect(prepareModelInput({
      path: "models/part.fbx",
      absolutePath: "/vault/models/part.fbx",
      conversionManager: manager,
      allowThreeDirect: true,
    })).rejects.toThrow("conversion timed out");
  });
});
