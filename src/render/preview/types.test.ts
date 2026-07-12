import { describe, expect, it } from "vitest";
import {
  supportsAnnotationPreview,
  supportsAnimationPreview,
  supportsBoundingBoxPreview,
  supportsCameraZoomPreview,
  supportsDisassemblyPreview,
  supportsFocusSelectionPreview,
  supportsMeasurementPreview,
  supportsOrientationGizmoPreview,
  supportsRenderScalePreview,
  supportsSlicePreview,
  supportsWireframePreview,
  supportsWorkbenchPreview,
} from "./types";

describe("preview capability guards", () => {
  it("requires capability properties to be callable methods", () => {
    expect(supportsAnnotationPreview({ getAnnotationProvider: true })).toBe(false);
    expect(supportsAnimationPreview({ hasAnimations: true, toggleAnimation: () => true })).toBe(false);
    expect(supportsBoundingBoxPreview({ toggleBoundingBox: true })).toBe(false);
    expect(supportsCameraZoomPreview({ getCameraZoomState: true, setCameraZoom: () => null })).toBe(false);
    expect(supportsDisassemblyPreview({
      toggleDisassembly: () => true,
      resetDisassembly: () => undefined,
      isDisassemblyEnabled: "not a function",
    })).toBe(false);
    expect(supportsFocusSelectionPreview({
      toggleFocusSelection: () => true,
      isFocusSelectionEnabled: false,
    })).toBe(false);
    expect(supportsWorkbenchPreview({
      setExplode: () => undefined,
      resetExplode: "not a function",
      focusWorldPoint: () => undefined,
    })).toBe(false);
    expect(supportsOrientationGizmoPreview({ toggleOrientationGizmo: true })).toBe(false);
    expect(supportsRenderScalePreview({ setRenderScale: 1 })).toBe(false);
    expect(supportsSlicePreview({ toggleSlice: () => true, isSliceActive: false })).toBe(false);
    expect(supportsWireframePreview({ toggleWireframe: "yes" })).toBe(false);
  });

  it("accepts complete toolbar capability contracts", () => {
    expect(supportsAnnotationPreview({ getAnnotationProvider: () => ({}) })).toBe(true);
    expect(supportsAnimationPreview({ hasAnimations: () => true, toggleAnimation: () => true })).toBe(true);
    expect(supportsBoundingBoxPreview({ toggleBoundingBox: () => true })).toBe(true);
    expect(supportsCameraZoomPreview({
      getCameraZoomState: () => ({ value: 0.5, percentage: 50 }),
      setCameraZoom: () => ({ value: 0.5, percentage: 50 }),
    })).toBe(true);
    expect(supportsDisassemblyPreview({
      toggleDisassembly: () => true,
      resetDisassembly: () => undefined,
      isDisassemblyEnabled: () => false,
    })).toBe(true);
    expect(supportsFocusSelectionPreview({
      toggleFocusSelection: () => true,
      isFocusSelectionEnabled: () => false,
    })).toBe(true);
    expect(supportsOrientationGizmoPreview({ toggleOrientationGizmo: () => true })).toBe(true);
    expect(supportsRenderScalePreview({ setRenderScale: () => 1 })).toBe(true);
    expect(supportsSlicePreview({
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
    })).toBe(true);
    expect(supportsWireframePreview({ toggleWireframe: () => true })).toBe(true);
    expect(supportsWorkbenchPreview({
      setExplode: () => undefined,
      resetExplode: () => undefined,
      focusWorldPoint: () => undefined,
    })).toBe(true);
  });

  it("accepts a complete measurement preview contract", () => {
    const preview = {
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
    };

    expect(supportsMeasurementPreview(preview)).toBe(true);
  });

  it("rejects partial measurement contracts", () => {
    const preview = {
      toggleMeasurement: () => true,
      isMeasurementActive: () => false,
      clearMeasurements: () => undefined,
    };

    expect(supportsMeasurementPreview(preview)).toBe(false);
  });
});
