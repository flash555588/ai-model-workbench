import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../domain/constants";
import type { PluginSettings } from "../domain/models";
import type { PreviewSource } from "../io/preview/preview-source";
import { resolvePreviewRoute } from "../render/preview/routing";
import { createDirectViewPreviewOptions, shouldPrepareThreeDirectFileView } from "./direct-view-routing";

function makeSource(partial: Partial<PreviewSource>): PreviewSource {
  return {
    path: "models/rubiks-cube-3x3.glb",
    ext: "glb",
    strategy: "direct",
    sourcePath: "models/rubiks-cube-3x3.glb",
    sourceExt: "glb",
    warnings: [],
    ...partial,
  };
}

function makeSettings(partial: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
  };
}

describe("createDirectViewPreviewOptions", () => {
  it("enables source preparation only for the file-view Three rollout", () => {
    for (const ext of ["glb", "obj", "3mf", "dae", "off", "pcd", "xyz", "fbx"]) {
      expect(shouldPrepareThreeDirectFileView(makeSettings(), ext)).toBe(false);
      expect(shouldPrepareThreeDirectFileView(makeSettings({ useThreeRenderer: true, previewRendererRollout: "three-readonly-glb" }), ext)).toBe(false);
      expect(shouldPrepareThreeDirectFileView(makeSettings({ useThreeRenderer: true, previewRendererRollout: "three-direct-glb" }), ext)).toBe(true);
    }
    expect(shouldPrepareThreeDirectFileView(makeSettings({ useThreeRenderer: true, previewRendererRollout: "three-direct-glb" }), "step")).toBe(false);
  });
  it.each(["3mf", "dae", "off", "pcd", "xyz", "fbx"])("permits direct %s only in the enabled file-view rollout", (ext) => {
    const source = makeSource({ ext, sourceExt: ext, path: `models/part.${ext}`, sourcePath: `models/part.${ext}` });
    const route = resolvePreviewRoute(createDirectViewPreviewOptions(makeSettings({
      useThreeRenderer: true,
      previewRendererRollout: "three-direct-glb",
      experimentalThreeWorkbench: true,
    }), source));
    expect(route.backend).toBe("three");
    expect(route.requireWorkbenchFeatures).toBe(false);
    expect(resolvePreviewRoute(createDirectViewPreviewOptions(makeSettings(), source)).backend).toBe("babylon");
    expect(resolvePreviewRoute(createDirectViewPreviewOptions(makeSettings({
      useThreeRenderer: true,
      previewRendererRollout: "three-readonly-glb",
    }), source)).backend).toBe("babylon");
  });
  it("routes default direct GLB file view through Babylon", () => {
    const options = createDirectViewPreviewOptions(makeSettings(), makeSource({}));
    const route = resolvePreviewRoute(options);

    expect(options.requireWorkbenchFeatures).toBe(false);
    expect(route.backend).toBe("babylon");
    expect(route.reason).toBe("useThreeRenderer=false");
  });

  it("routes converted GLB outputs through the invisible Three fast path", () => {
    const options = createDirectViewPreviewOptions(
      makeSettings({ previewRendererRollout: "babylon-safe", useThreeRenderer: false }),
      makeSource({
        path: "C:\\vault\\models\\test-step.ai3d-converted.glb",
        strategy: "convert",
        sourcePath: "models/test-step.step",
        sourceExt: "step",
      }),
    );
    const route = resolvePreviewRoute(options);

    expect(options.requireWorkbenchFeatures).toBe(false);
    expect(options.rendererRollout).toBe("three-direct-glb");
    expect(options.useThreeRenderer).toBe(true);
    expect(route.backend).toBe("three");
    expect(route.reason).toBe("glb direct view edit preview");
  });

  it("keeps converted GLB outputs on the normal route when the fast path is disabled", () => {
    const options = createDirectViewPreviewOptions(
      makeSettings({
        previewRendererRollout: "babylon-safe",
        useThreeRenderer: false,
        useThreeForConvertedDirectView: false,
      }),
      makeSource({
        path: "C:\\vault\\models\\test-step.ai3d-converted.glb",
        strategy: "convert",
        sourcePath: "models/test-step.step",
        sourceExt: "step",
      }),
    );
    const route = resolvePreviewRoute(options);

    expect(options.requireWorkbenchFeatures).toBe(false);
    expect(options.rendererRollout).toBe("babylon-safe");
    expect(options.useThreeRenderer).toBe(false);
    expect(route.backend).toBe("babylon");
    expect(route.reason).toBe("useThreeRenderer=false");
  });

  it("uses the guarded Three workbench route only when the experimental file-view setting is enabled", () => {
    const options = createDirectViewPreviewOptions(
      makeSettings({
        experimentalThreeWorkbench: true,
        previewRendererRollout: "three-direct-glb",
        useThreeRenderer: true,
      }),
      makeSource({}),
    );
    const route = resolvePreviewRoute(options);

    expect(options.allowWorkbenchFeaturesOnThree).toBe(true);
    expect(options.requireWorkbenchFeatures).toBe(true);
    expect(route.backend).toBe("three");
    expect(route.reason).toBe("glb workbench preview");
  });

  it("does not force non-GLTF direct formats into the experimental workbench route", () => {
    const options = createDirectViewPreviewOptions(
      makeSettings({
        experimentalThreeWorkbench: true,
        previewRendererRollout: "three-direct-glb",
        useThreeRenderer: true,
      }),
      makeSource({
        path: "models/bracket.stl",
        ext: "stl",
        sourcePath: "models/bracket.stl",
        sourceExt: "stl",
      }),
    );
    const route = resolvePreviewRoute(options);

    expect(options.allowWorkbenchFeaturesOnThree).toBe(false);
    expect(options.requireWorkbenchFeatures).toBe(false);
    expect(route.backend).toBe("three");
    expect(route.reason).toBe("stl direct view edit preview");
  });
});
