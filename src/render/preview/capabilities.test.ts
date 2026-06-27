import { describe, expect, it } from "vitest";
import {
  collectPreviewCapabilities,
  collectPreviewCapabilityProfile,
  describePreviewRouteCapabilities,
} from "./capabilities";
import type { PreviewRouteDecision } from "./routing";

describe("preview capability profile", () => {
  it("collects complete callable capabilities", () => {
    const preview = {
      getAnnotationProvider: () => ({}),
      hasAnimations: () => true,
      toggleAnimation: () => true,
      toggleMeasurement: () => true,
      isMeasurementActive: () => false,
      clearMeasurements: () => undefined,
      setMeasurementScale: () => undefined,
      getMeasurementScale: () => ({ x: 1, y: 1, z: 1 }),
      setMeasurementUnit: () => undefined,
      getMeasurementUnit: () => "mm",
      getMeasurementBounds: () => null,
      getMeasurementRecords: () => [],
      updateMeasurementLabels: () => undefined,
      exportMeasurements: () => "",
      toggleDisassembly: () => true,
      resetDisassembly: () => undefined,
      isDisassemblyEnabled: () => false,
      toggleFocusSelection: () => true,
      isFocusSelectionEnabled: () => false,
      toggleWireframe: () => true,
      toggleOrientationGizmo: () => true,
      toggleBoundingBox: () => true,
      setRenderScale: () => 1,
      getCameraZoomState: () => ({ value: 0.5, percentage: 50 }),
      setCameraZoom: () => ({ value: 0.5, percentage: 50 }),
      setExplode: () => undefined,
      resetExplode: () => undefined,
      focusWorldPoint: () => undefined,
    };

    expect(collectPreviewCapabilities(preview)).toEqual([
      "annotation",
      "animation",
      "measurement",
      "disassembly",
      "focus-selection",
      "wireframe",
      "orientation-gizmo",
      "bounding-box",
      "render-scale",
      "camera-zoom",
      "workbench",
    ]);
  });

  it("rejects partial or non-callable capability contracts", () => {
    const preview = {
      getAnnotationProvider: true,
      hasAnimations: () => true,
      toggleAnimation: false,
      toggleMeasurement: () => true,
      isMeasurementActive: () => false,
      setExplode: () => undefined,
      resetExplode: "nope",
      focusWorldPoint: () => undefined,
    };

    expect(collectPreviewCapabilities(preview)).toEqual([]);
  });

  it("describes route capability policy without a live preview instance", () => {
    const route: PreviewRouteDecision = {
      backend: "three",
      ext: "glb",
      annotationMode: "none",
      requireWorkbenchFeatures: false,
      rendererRollout: "three-direct-glb",
      reason: "simple glb preview",
    };

    const profile = describePreviewRouteCapabilities(route);
    expect(profile.backend).toBe("three");
    expect(profile.supportedFormats).toContain("gltf");
    expect(profile.colorPipeline).toContain("sRGB");
  });

  it("builds a backend-specific profile from a live preview", () => {
    const profile = collectPreviewCapabilityProfile({ toggleWireframe: () => true }, "babylon");

    expect(profile.backend).toBe("babylon");
    expect(profile.supportedFormats).toContain("splat");
    expect(profile.capabilities).toEqual(["wireframe"]);
  });
});
