import { describe, expect, it } from "vitest";
import { createPreviewBounds } from "./bounds";
import {
  createSliceClipPlanes,
  createSlicePlaneGeometry,
  createSliceRange,
  createSliceState,
  DEFAULT_SLICE_AXIS,
  DEFAULT_SLICE_OFFSET,
  DEFAULT_SLICE_THICKNESS,
  isPointClippedBySlicePlanes,
  normalizeSliceAxis,
  normalizeSliceNormal,
  normalizeSliceOffset,
  normalizeSliceThickness,
} from "./slice";

describe("slice helpers", () => {
  it("normalizes invalid slice state values", () => {
    expect(normalizeSliceAxis("bad")).toBe(DEFAULT_SLICE_AXIS);
    expect(normalizeSliceNormal({ x: Number.NaN, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
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
      axis: "x",
      position: 0.25,
      thickness: 0.08,
      bounds: { x: 2, y: 4, z: 6 },
    });
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
