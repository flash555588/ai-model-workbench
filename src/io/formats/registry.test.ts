import { afterEach, describe, expect, it } from "vitest";

import {
  getDirectLoaderKind,
  getFormatCapability,
  isSupportedModelExtension,
  listSupportedModelExtensions,
  normalizeModelExt,
  registerFormatCapability,
  resetFormatCapabilities,
  unregisterFormatCapability,
} from "./registry";

describe("format registry", () => {
  afterEach(() => {
    resetFormatCapabilities();
  });

  it("normalizes extensions for case and dot prefix", () => {
    expect(normalizeModelExt("GLB")).toBe("glb");
    expect(normalizeModelExt(".StEp")).toBe("step");
    expect(normalizeModelExt("  obj  ")).toBe("obj");
    expect(normalizeModelExt("")).toBe("");
  });

  it("resolves built-in capabilities", () => {
    expect(getFormatCapability("glb")?.strategy).toBe("direct");
    expect(getFormatCapability("step")?.strategy).toBe("convert");
    expect(isSupportedModelExtension("ply")).toBe(true);
    expect(isSupportedModelExtension("nope")).toBe(false);
  });

  it("registers a new format capability at runtime", () => {
    expect(registerFormatCapability({
      ext: "usdz",
      family: "mesh",
      strategy: "direct",
      directLoader: "custom-usdz",
      displayName: "USDZ",
      enabled: true,
    })).toBe(true);

    expect(isSupportedModelExtension("usdz")).toBe(true);
    expect(getFormatCapability("USDZ")?.displayName).toBe("USDZ");
    expect(listSupportedModelExtensions()).toContain("usdz");
  });

  it("overrides a built-in capability on registration", () => {
    expect(registerFormatCapability({
      ext: "glb",
      family: "mesh",
      strategy: "convert",
      converterId: "assimp",
      outputFormat: "glb",
      enabled: true,
    })).toBe(true);

    expect(getFormatCapability("glb")?.strategy).toBe("convert");
  });

  it("rejects an empty extension on registration", () => {
    expect(registerFormatCapability({
      ext: "   ",
      family: "mesh",
      strategy: "direct",
      enabled: true,
    })).toBe(false);
  });

  it("unregisters runtime capabilities but not built-ins", () => {
    registerFormatCapability({ ext: "usdz", family: "mesh", strategy: "direct", enabled: true });

    expect(unregisterFormatCapability("usdz")).toBe(true);
    expect(isSupportedModelExtension("usdz")).toBe(false);
    expect(unregisterFormatCapability("glb")).toBe(false);
    expect(isSupportedModelExtension("glb")).toBe(true);
  });

  it("resets the registry back to built-ins", () => {
    registerFormatCapability({ ext: "usdz", family: "mesh", strategy: "direct", enabled: true });
    registerFormatCapability({ ext: "glb", family: "mesh", strategy: "convert", converterId: "assimp", enabled: true });

    resetFormatCapabilities();

    expect(isSupportedModelExtension("usdz")).toBe(false);
    expect(getFormatCapability("glb")?.strategy).toBe("direct");
  });

  it("supports the trimesh-convertible source formats", () => {
    expect(isSupportedModelExtension("off")).toBe(true);
    expect(isSupportedModelExtension("msh")).toBe(true);
    expect(getFormatCapability("off")?.converterId).toBe("assimp");
    expect(getFormatCapability("msh")?.family).toBe("mesh");
  });

  it("routes FreeCAD-native CAD formats through the sldprt converter", () => {
    expect(isSupportedModelExtension("x_t")).toBe(true);
    expect(isSupportedModelExtension("x_b")).toBe(true);
    expect(isSupportedModelExtension("catpart")).toBe(true);
    expect(isSupportedModelExtension("catproduct")).toBe(true);
    expect(getFormatCapability("x_t")?.converterId).toBe("sldprt");
    expect(getFormatCapability("catpart")?.family).toBe("cad");
  });

  it("resolves direct loader kinds for renderer dispatch", () => {
    expect(getDirectLoaderKind("glb")).toBe("gltf");
    expect(getDirectLoaderKind("stl")).toBe("stl");
    expect(getDirectLoaderKind("ply")).toBe("ply");
    expect(getDirectLoaderKind("obj")).toBe("obj");
    expect(getDirectLoaderKind("step")).toBeUndefined();
    expect(getDirectLoaderKind("unknown")).toBeUndefined();
  });
});
