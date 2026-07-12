import { describe, expect, it } from "vitest";
import { createPreviewBounds } from "./bounds";
import {
  createSliceClipPlanes,
  createSliceGizmoGeometry,
  createSlicePlaneGeometry,
  createSliceOffsetForPoint,
  createSlicePlaneAxesFromEulerDegrees,
  createSliceRange,
  createSliceState,
  DEFAULT_SLICE_AXIS,
  DEFAULT_SLICE_OFFSET,
  DEFAULT_SLICE_THICKNESS,
  isPointClippedBySlicePlanes,
  getSliceEulerDegreesFromPlaneAxes,
  normalizeSliceAxis,
  normalizeSliceNormal,
  normalizeSliceOffset,
  normalizeSliceThickness,
  rotateSliceNormal,
  rotateSliceNormalAroundAxis,
  resolveSliceRotationSnapMode,
  shouldUseSliceScreenRotation,
  snapSliceRotationRadians,
} from "./slice";

describe("slice helpers", () => {
  it("normalizes invalid slice state values", () => {
    expect(normalizeSliceAxis("bad")).toBe(DEFAULT_SLICE_AXIS);
    expect(normalizeSliceNormal({ x: Number.NaN, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
    expect(normalizeSliceNormal({ x: 2, y: 0, z: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(normalizeSliceOffset(Number.NaN)).toBe(DEFAULT_SLICE_OFFSET);
    expect(normalizeSliceOffset(2)).toBe(1);
    expect(normalizeSliceOffset(-1)).toBe(0);
    expect(normalizeSliceThickness(Number.NaN)).toBe(DEFAULT_SLICE_THICKNESS);
  });

  it("creates immutable public state snapshots", () => {
    const bounds = createPreviewBounds({ x: -1, y: -2, z: -3 }, { x: 1, y: 2, z: 3 });
    const normal = { x: 2, y: 0, z: 0 };
    const state = createSliceState(true, normal, 0.25, bounds, true);

    normal.x = 9;
    bounds.max.x = 99;

    expect(state).toEqual({
      active: true,
      normal: { x: 1, y: 0, z: 0 },
      offset: 0.25,
      point: { x: -0.5, y: 0, z: 0 },
      dragging: true,
      interactionMode: "move",
      tiltDegrees: 90,
      axis: "x",
      position: 0.25,
      thickness: 0.08,
      bounds: { x: 2, y: 4, z: 6 },
    });
  });

  it("centers the default world-horizontal plane on the placed model bounds", () => {
    const bounds = createPreviewBounds({ x: -4, y: 10, z: 2 }, { x: 8, y: 30, z: 14 });
    const state = createSliceState(true, undefined, DEFAULT_SLICE_OFFSET, bounds);

    expect(state.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(state.axis).toBe("y");
    expect(state.offset).toBe(0.5);
    expect(state.tiltDegrees).toBe(0);
    expect(state.point).toEqual({ x: 2, y: 20, z: 8 });
  });

  it("rotates the cutting board and keeps its anchor point stable", () => {
    const bounds = createPreviewBounds({ x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 });
    const anchor = { x: 0.4, y: -0.25, z: 0.75 };
    const normal = rotateSliceNormal(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      Math.PI / 4,
      Math.PI / 6,
    );
    const offset = createSliceOffsetForPoint(bounds, normal, anchor);
    const range = createSliceRange(bounds, { normal, offset });

    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1);
    expect(normal.x).not.toBeCloseTo(0);
    expect(normal.y).not.toBeCloseTo(0);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(1);
    expect(range?.distance).toBeCloseTo(
      anchor.x * normal.x + anchor.y * normal.y + anchor.z * normal.z,
    );
  });

  it("builds a three-axis rotation gizmo and normal move arrow", () => {
    const bounds = createPreviewBounds({ x: -2, y: -3, z: -4 }, { x: 2, y: 3, z: 4 });
    const range = createSliceRange(bounds, { normal: { x: 0, y: 0, z: 1 }, offset: 0.5 });
    expect(range).not.toBeNull();

    const gizmo = createSliceGizmoGeometry(bounds, range!, 32);
    expect(gizmo.rotationRings.x).toHaveLength(32);
    expect(gizmo.rotationRings.y).toHaveLength(32);
    expect(gizmo.rotationRings.z).toHaveLength(32);
    expect(gizmo.rotationTicks.x).toHaveLength(36);
    expect(gizmo.rotationTicks.y).toHaveLength(36);
    expect(gizmo.rotationTicks.z).toHaveLength(36);
    expect(gizmo.rotationArcs.z).toHaveLength(52);
    expect(gizmo.rotationArrowheads.z).toHaveLength(6);
    expect(gizmo.moveGuide).toHaveLength(3);
    expect(gizmo.moveGuide[0][1].z).toBeGreaterThan(gizmo.moveGuide[0][0].z);
  });

  it("rotates a slice normal around one selected gizmo axis", () => {
    const rotated = rotateSliceNormalAroundAxis(
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      Math.PI / 2,
    );
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(-1);
    expect(rotated.z).toBeCloseTo(0);
  });

  it("rotates plane-local axes around the normal without changing the clipping plane", () => {
    const normal = { x: 0, y: 0, z: 1 };
    const rotatedNormal = rotateSliceNormalAroundAxis(normal, normal, Math.PI / 2);
    const rotatedPlaneX = rotateSliceNormalAroundAxis({ x: 1, y: 0, z: 0 }, normal, Math.PI / 2);
    const rotatedPlaneY = rotateSliceNormalAroundAxis({ x: 0, y: 1, z: 0 }, normal, Math.PI / 2);

    expect(rotatedNormal).toEqual(normal);
    expect(rotatedPlaneX.x).toBeCloseTo(0);
    expect(rotatedPlaneX.y).toBeCloseTo(1);
    expect(rotatedPlaneY.x).toBeCloseTo(-1);
    expect(rotatedPlaneY.y).toBeCloseTo(0);
  });

  it("maps XYZ rotation inputs to a horizontal zero-degree plane and round-trips the frame", () => {
    const zero = createSlicePlaneAxesFromEulerDegrees({ x: 0, y: 0, z: 0 });
    expect(zero.x.x).toBeCloseTo(1);
    expect(zero.x.y).toBeCloseTo(0);
    expect(zero.x.z).toBeCloseTo(0);
    expect(zero.y.x).toBeCloseTo(0);
    expect(zero.y.y).toBeCloseTo(0);
    expect(zero.y.z).toBeCloseTo(-1);
    expect(zero.z.x).toBeCloseTo(0);
    expect(zero.z.y).toBeCloseTo(1);
    expect(zero.z.z).toBeCloseTo(0);

    const rotation = { x: 20, y: -30, z: 40 };
    const restored = getSliceEulerDegreesFromPlaneAxes(createSlicePlaneAxesFromEulerDegrees(rotation));
    expect(restored.x).toBeCloseTo(rotation.x);
    expect(restored.y).toBeCloseTo(rotation.y);
    expect(restored.z).toBeCloseTo(rotation.z);
  });

  it("snaps rotation to coarse and fine ruler regions", () => {
    expect(snapSliceRotationRadians(0.7, 0.5)).toBeCloseTo(Math.PI / 4);
    expect(snapSliceRotationRadians(0.19, 1)).toBeCloseTo(Math.PI / 18);
    expect(snapSliceRotationRadians(0.19, 1.6)).toBeCloseTo(0.19);
  });

  it("keeps coarse and fine snap regions stable near their boundaries", () => {
    expect(resolveSliceRotationSnapMode(0.7, "coarse")).toBe("coarse");
    expect(resolveSliceRotationSnapMode(0.76, "coarse")).toBe("free");
    expect(resolveSliceRotationSnapMode(0.84, "fine")).toBe("fine");
    expect(resolveSliceRotationSnapMode(1.3, "fine")).toBe("fine");
    expect(resolveSliceRotationSnapMode(1.34, "fine")).toBe("free");
  });

  it("uses screen rotation for a nearly edge-on rotation plane", () => {
    expect(shouldUseSliceScreenRotation(0.079)).toBe(true);
    expect(shouldUseSliceScreenRotation(-0.079)).toBe(true);
    expect(shouldUseSliceScreenRotation(0.08)).toBe(false);
    expect(shouldUseSliceScreenRotation(Number.NaN)).toBe(true);
  });

  it("maps normalized plane values through projected model bounds", () => {
    const bounds = createPreviewBounds({ x: -5, y: 10, z: 100 }, { x: 5, y: 30, z: 200 });
    const range = createSliceRange(bounds, { normal: { x: 0, y: 1, z: 0 }, offset: 0.25 });

    expect(range).toEqual({
      normal: { x: 0, y: 1, z: 0 },
      offset: 0.25,
      min: 10,
      max: 30,
      distance: 15,
      span: 20,
      point: { x: 0, y: 15, z: 150 },
    });
  });

  it("supports arbitrary non-axis cutting planes", () => {
    const bounds = createPreviewBounds({ x: -1, y: -1, z: -1 }, { x: 1, y: 1, z: 1 });
    const range = createSliceRange(bounds, { normal: { x: 1, y: 1, z: 0 }, offset: 0.5 });

    expect(range?.normal.x).toBeCloseTo(Math.SQRT1_2);
    expect(range?.normal.y).toBeCloseTo(Math.SQRT1_2);
    expect(range?.distance).toBeCloseTo(0);
    expect(range?.point).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("builds a draggable plane overlay frame for the active slice", () => {
    const bounds = createPreviewBounds({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
    const range = createSliceRange(bounds, { normal: { x: 0, y: 0, z: 1 }, offset: 0.5 });
    const plane = range ? createSlicePlaneGeometry(bounds, range, 0) : null;

    expect(plane?.coordinate).toBe(15);
    expect(plane?.center).toEqual({ x: 5, y: 10, z: 15 });
    expect(plane?.segments).toHaveLength(4);
    for (const corner of plane?.corners ?? []) {
      expect(corner.z).toBe(15);
    }
    const xs = plane?.corners.map((corner) => corner.x) ?? [];
    const ys = plane?.corners.map((corner) => corner.y) ?? [];
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(10);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(20);
  });

  it("creates renderer-specific clipping planes that keep the same half-space", () => {
    const bounds = createPreviewBounds({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 });
    const range = createSliceRange(bounds, { normal: { x: 1, y: 0, z: 0 }, offset: 0.5 });

    expect(range).toMatchObject({ min: 0, max: 10, distance: 5 });
    const babylonPlanes = createSliceClipPlanes(range, "babylon");
    const threePlanes = createSliceClipPlanes(range, "three");

    expect(babylonPlanes).toEqual([{ normal: { x: -1, y: -0, z: -0 }, constant: 5 }]);
    expect(threePlanes).toEqual([{ normal: { x: 1, y: 0, z: 0 }, constant: -5 }]);
    for (const convention of ["babylon", "three"] as const) {
      const planes = convention === "babylon" ? babylonPlanes : threePlanes;
      expect(planes).not.toBeNull();
      expect(isPointClippedBySlicePlanes({ x: 4.99, y: 0, z: 0 }, planes ?? [], convention)).toBe(true);
      expect(isPointClippedBySlicePlanes({ x: 5, y: 0, z: 0 }, planes ?? [], convention)).toBe(false);
      expect(isPointClippedBySlicePlanes({ x: 7.01, y: 0, z: 0 }, planes ?? [], convention)).toBe(false);
    }
  });
});
