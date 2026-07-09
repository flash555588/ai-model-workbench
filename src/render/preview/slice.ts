import {
  getPreviewBoundsCenter,
  getPreviewBoundsRadius,
  getPreviewBoundsSize,
  type PreviewBounds,
} from "./bounds";
import {
  addPreviewWorldPoints,
  dotPreviewWorldPoints,
  normalizePreviewWorldPoint,
  scalePreviewWorldPoint,
} from "./geometry";
import type { PreviewAxis, SliceState } from "./types";

export const DEFAULT_SLICE_AXIS: PreviewAxis = "z";
export const DEFAULT_SLICE_NORMAL = { x: 0, y: 0, z: 1 };
export const DEFAULT_SLICE_OFFSET = 0.5;
export const DEFAULT_SLICE_POSITION = DEFAULT_SLICE_OFFSET;
export const DEFAULT_SLICE_THICKNESS = 0.08;
export const MIN_SLICE_THICKNESS = 0.002;
export const MAX_SLICE_THICKNESS = 1;

export interface SlicePoint {
  x: number;
  y: number;
  z: number;
}

export interface SliceRange {
  normal: SlicePoint;
  offset: number;
  min: number;
  max: number;
  distance: number;
  span: number;
  point: SlicePoint;
}

export interface SlicePlaneGeometry {
  coordinate: number;
  normal: SlicePoint;
  center: SlicePoint;
  corners: [SlicePoint, SlicePoint, SlicePoint, SlicePoint];
  segments: Array<[SlicePoint, SlicePoint]>;
}

export type SliceClipPlaneConvention = "three" | "babylon";

export interface SliceClipPlane {
  normal: SlicePoint;
  constant: number;
}

export function normalizeSliceAxis(axis: string | undefined): PreviewAxis {
  return axis === "x" || axis === "y" || axis === "z" ? axis : DEFAULT_SLICE_AXIS;
}

export function normalizeSliceNormal(normal: Partial<SlicePoint> | undefined): SlicePoint {
  const candidate = {
    x: Number.isFinite(normal?.x) ? Number(normal?.x) : 0,
    y: Number.isFinite(normal?.y) ? Number(normal?.y) : 0,
    z: Number.isFinite(normal?.z) ? Number(normal?.z) : 0,
  };
  return normalizePreviewWorldPoint(candidate) ?? { ...DEFAULT_SLICE_NORMAL };
}

export function normalizeSliceOffset(offset: number): number {
  if (!Number.isFinite(offset)) return DEFAULT_SLICE_OFFSET;
  return Math.max(0, Math.min(offset, 1));
}

export function normalizeSlicePosition(position: number): number {
  return normalizeSliceOffset(position);
}

export function normalizeSliceThickness(thickness: number): number {
  if (!Number.isFinite(thickness)) return DEFAULT_SLICE_THICKNESS;
  return Math.max(MIN_SLICE_THICKNESS, Math.min(thickness, MAX_SLICE_THICKNESS));
}

export function createSliceState(
  active: boolean,
  normal: Partial<SlicePoint> | undefined,
  offset: number,
  bounds: PreviewBounds | null,
  dragging = false,
  legacyThickness = DEFAULT_SLICE_THICKNESS,
): SliceState {
  const normalizedNormal = normalizeSliceNormal(normal);
  const normalizedOffset = normalizeSliceOffset(offset);
  const range = createSliceRange(bounds, { normal: normalizedNormal, offset: normalizedOffset });
  return {
    active,
    normal: normalizedNormal,
    offset: normalizedOffset,
    point: range ? { ...range.point } : null,
    dragging,
    bounds: bounds ? getPreviewBoundsSize(bounds) : null,
    axis: closestSliceAxis(normalizedNormal),
    position: normalizedOffset,
    thickness: normalizeSliceThickness(legacyThickness),
  };
}

export function createSliceRange(
  bounds: PreviewBounds | null,
  state: Partial<Pick<SliceState, "normal" | "offset" | "axis" | "position">>,
): SliceRange | null {
  if (!bounds) return null;
  const normal = state.normal
    ? normalizeSliceNormal(state.normal)
    : axisUnit(normalizeSliceAxis(state.axis), 1);
  const projections = projectBoundsOntoNormal(bounds, normal);
  const span = projections.max - projections.min;
  if (!Number.isFinite(span) || span <= Number.EPSILON) return null;

  const offset = normalizeSliceOffset(
    typeof state.offset === "number" ? state.offset : state.position ?? DEFAULT_SLICE_OFFSET,
  );
  const distance = projections.min + span * offset;
  const center = getPreviewBoundsCenter(bounds);
  const centerDistance = dotPreviewWorldPoints(center, normal);
  const point = addPreviewWorldPoints(center, scalePreviewWorldPoint(normal, distance - centerDistance));
  return {
    normal,
    offset,
    min: projections.min,
    max: projections.max,
    distance,
    span,
    point,
  };
}

export function createSlicePlaneGeometry(
  bounds: PreviewBounds,
  range: SliceRange,
  paddingFactor = 0.08,
): SlicePlaneGeometry {
  const radius = Math.max(getPreviewBoundsRadius(bounds), Number.EPSILON);
  const halfExtent = radius * (1 + Math.max(0, paddingFactor));
  const basis = createSlicePlaneBasis(range.normal);
  const u = scalePreviewWorldPoint(basis.u, halfExtent);
  const v = scalePreviewWorldPoint(basis.v, halfExtent);
  const center = range.point;
  const corners: [SlicePoint, SlicePoint, SlicePoint, SlicePoint] = [
    addPreviewWorldPoints(addPreviewWorldPoints(center, scalePreviewWorldPoint(u, -1)), scalePreviewWorldPoint(v, -1)),
    addPreviewWorldPoints(addPreviewWorldPoints(center, u), scalePreviewWorldPoint(v, -1)),
    addPreviewWorldPoints(addPreviewWorldPoints(center, u), v),
    addPreviewWorldPoints(addPreviewWorldPoints(center, scalePreviewWorldPoint(u, -1)), v),
  ];
  return {
    coordinate: range.distance,
    normal: { ...range.normal },
    center: { ...center },
    corners,
    segments: createSliceFrameSegments(corners),
  };
}

export function createSliceClipPlanes(
  range: SliceRange | null,
  convention: SliceClipPlaneConvention,
): SliceClipPlane[] | null {
  if (!range) return null;
  if (convention === "babylon") {
    return [
      {
        normal: scalePreviewWorldPoint(range.normal, -1),
        constant: range.distance,
      },
    ];
  }

  return [
    {
      normal: { ...range.normal },
      constant: -range.distance,
    },
  ];
}

export function isPointClippedBySlicePlanes(
  point: SlicePoint,
  planes: readonly SliceClipPlane[],
  convention: SliceClipPlaneConvention,
): boolean {
  return planes.some((plane) => {
    const signed = dotPreviewWorldPoints(point, plane.normal);
    return convention === "babylon"
      ? signed + plane.constant > 0
      : -signed > plane.constant;
  });
}

export function closestSliceAxis(normal: SlicePoint): PreviewAxis {
  const x = Math.abs(normal.x);
  const y = Math.abs(normal.y);
  const z = Math.abs(normal.z);
  if (x >= y && x >= z) return "x";
  if (y >= x && y >= z) return "y";
  return "z";
}

function axisUnit(axis: PreviewAxis, value: 1 | -1): SlicePoint {
  return {
    x: axis === "x" ? value : 0,
    y: axis === "y" ? value : 0,
    z: axis === "z" ? value : 0,
  };
}

function crossSlicePoint(a: SlicePoint, b: SlicePoint): SlicePoint {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function createSlicePlaneBasis(normal: SlicePoint): { u: SlicePoint; v: SlicePoint } {
  const reference = Math.abs(normal.y) < 0.92
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  const u = normalizePreviewWorldPoint(crossSlicePoint(reference, normal)) ?? { x: 1, y: 0, z: 0 };
  const v = normalizePreviewWorldPoint(crossSlicePoint(normal, u)) ?? { x: 0, y: 1, z: 0 };
  return { u, v };
}

function createBoundsCorners(bounds: PreviewBounds): SlicePoint[] {
  return [
    { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    { x: bounds.max.x, y: bounds.min.y, z: bounds.min.z },
    { x: bounds.min.x, y: bounds.max.y, z: bounds.min.z },
    { x: bounds.max.x, y: bounds.max.y, z: bounds.min.z },
    { x: bounds.min.x, y: bounds.min.y, z: bounds.max.z },
    { x: bounds.max.x, y: bounds.min.y, z: bounds.max.z },
    { x: bounds.min.x, y: bounds.max.y, z: bounds.max.z },
    { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
  ];
}

function projectBoundsOntoNormal(bounds: PreviewBounds, normal: SlicePoint): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const corner of createBoundsCorners(bounds)) {
    const projection = dotPreviewWorldPoints(corner, normal);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

function createSliceFrameSegments(corners: [SlicePoint, SlicePoint, SlicePoint, SlicePoint]): Array<[SlicePoint, SlicePoint]> {
  return [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
}
