import { describe, expect, it } from "vitest";
import { resolveGridRoute, resolvePreviewRoute } from "./routing";

describe("preview routing", () => {
  it("keeps common single-model direct formats on Three by default", () => {
    const route = resolvePreviewRoute({
      ext: "glb",
      annotationMode: "edit",
      allowEditModeOnThree: true,
      requireWorkbenchFeatures: false,
      rendererRollout: "three-direct-glb",
    });

    expect(route.backend).toBe("three");
    expect(route.reason).toBe("glb direct view edit preview");
  });

  it("keeps conservative workbench routes on Babylon unless explicitly probed", () => {
    const route = resolvePreviewRoute({
      ext: "glb",
      annotationMode: "edit",
      allowEditModeOnThree: true,
      requireWorkbenchFeatures: true,
      rendererRollout: "three-direct-glb",
    });

    expect(route.backend).toBe("babylon");
    expect(route.reason).toContain("requireWorkbenchFeatures=true");
  });

  it("allows the hidden workbench Three probe only when explicitly requested", () => {
    const route = resolvePreviewRoute({
      ext: "gltf",
      annotationMode: "edit",
      allowEditModeOnThree: true,
      allowWorkbenchFeaturesOnThree: true,
      requireWorkbenchFeatures: true,
      rendererRollout: "three-direct-glb",
    });

    expect(route.backend).toBe("three");
    expect(route.reason).toBe("gltf workbench preview");
  });

  it("keeps 3dgrid on the Babylon grid renderer", () => {
    expect(resolveGridRoute()).toEqual({
      backend: "babylon",
      reason: "grid previews remain on the Babylon grid renderer",
    });
  });
});
