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
      cancelMeasurement: () => undefined,
      clearMeasurements: () => undefined,
      setMeasurementScale: () => undefined,
      getMeasurementScale: () => ({ x: 1, y: 1, z: 1 }),
      setMeasurementUnit: () => undefined,
      getMeasurementUnit: () => "mm",
      getMeasurementBounds: () => null,
      getMeasurementRecords: () => [],
      getMeasurementState: () => ({
        active: false,
        phase: "inactive",
        records: [],
        unit: "mm",
        scale: { x: 1, y: 1, z: 1 },
        bounds: null,
      }),
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
      toggleSlice: () => true,
      isSliceActive: () => false,
      setSlicePlane: () => ({
        active: false,
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.5,
        point: null,
        axis: "z",
        position: 0.5,
        thickness: 0.08,
        bounds: null,
      }),
      setSliceOffset: () => ({
        active: false,
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.5,
        point: null,
        axis: "z",
        position: 0.5,
        thickness: 0.08,
        bounds: null,
      }),
      setSliceRotation: () => ({
        active: false,
        normal: { x: 0, y: 1, z: 0 },
        offset: 0.5,
        point: null,
        axis: "y",
        position: 0.5,
        thickness: 0.08,
        bounds: null,
      }),
      resetSlicePlane: () => ({
        active: false,
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.5,
        point: null,
        axis: "z",
        position: 0.5,
        thickness: 0.08,
        bounds: null,
      }),
      getSliceState: () => ({
        active: false,
        normal: { x: 0, y: 0, z: 1 },
        offset: 0.5,
        point: null,
        axis: "z",
        position: 0.5,
        thickness: 0.08,
        bounds: null,
      }),
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
      "slice",
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
