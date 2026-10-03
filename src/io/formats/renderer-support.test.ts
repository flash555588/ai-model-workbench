import { afterEach, describe, expect, it } from "vitest";
import { registerFormatCapability, resetFormatCapabilities } from "./registry";
import { listThreeDirectFormats, supportsBabylonDirectFormat, supportsThreeDirectFormat } from "./renderer-support";
import { resolvePreviewRoute } from "../../render/preview/routing";

afterEach(resetFormatCapabilities);

describe("renderer format support", () => {
  it("allows Babylon fallback only for loaders it actually implements", () => {
    for (const ext of ["glb", "gltf", "stl", "ply", "obj"]) {
      expect(supportsBabylonDirectFormat(ext)).toBe(true);
    }
    for (const ext of ["3mf", "dae", "off", "pcd", "xyz", "fbx", "splat", "step"]) {
      expect(supportsBabylonDirectFormat(ext)).toBe(false);
    }
  });

  it("keeps routing and diagnostics aligned with registered loaders", () => {
    registerFormatCapability({ ext: "custom", family: "mesh", strategy: "direct", directLoader: "gltf", enabled: true, displayName: "Custom" });
    expect(supportsThreeDirectFormat(".CUSTOM")).toBe(true);
    expect(listThreeDirectFormats()).toContain("custom");
    expect(resolvePreviewRoute({ ext: "custom", rendererRollout: "three-direct-glb" }).backend).toBe("three");
  });

  it("excludes disabled and unimplemented loaders from routes and diagnostics", () => {
    registerFormatCapability({ ext: "glb", family: "mesh", strategy: "direct", directLoader: "gltf", enabled: false, displayName: "GLB" });
    registerFormatCapability({ ext: "custom", family: "mesh", strategy: "direct", directLoader: "unimplemented", enabled: true, displayName: "Custom" });
    for (const ext of ["glb", "custom"]) {
      expect(supportsThreeDirectFormat(ext)).toBe(false);
      expect(listThreeDirectFormats()).not.toContain(ext);
      expect(resolvePreviewRoute({ ext, rendererRollout: "three-direct-glb" }).backend).toBe("babylon");
    }
  });
});
