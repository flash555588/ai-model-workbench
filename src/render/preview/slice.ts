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
import type { PreviewAxis, SliceInteractionMode, SliceState } from "./types";

export const DEFAULT_SLICE_AXIS: PreviewAxis = "z";
export const DEFAULT_SLICE_NORMAL = { x: 0, y: 0, z: 1 };
export const DEFAULT_SLICE_OFFSET = 0.5;
export const DEFAULT_SLICE_INTERACTION_MODE: SliceInteractionMode = "move";
export const DEFAULT_SLICE_POSITION = DEFAULT_SLICE_OFFSET;
export const DEFAULT_SLICE_THICKNESS = 0.08;
export const MIN_SLICE_THICKNESS = 0.002;
export const MAX_SLICE_THICKNESS = 1;
export const SLICE_RAY_PLANE_ALIGNMENT_THRESHOLD = 0.08;
export type SliceRotationSnapMode = "free" | "coarse" | "fine";

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

export interface SlicePlaneAxes {
  x: SlicePoint;
  y: SlicePoint;
  z: SlicePoint;
}

export interface SliceGizmoGeometry {
  rotationRings: Record<PreviewAxis, Array<[SlicePoint, SlicePoint]>>;
  rotationTicks: Record<PreviewAxis, Array<[SlicePoint, SlicePoint]>>;
  rotationArcs: Record<PreviewAxis, Array<[SlicePoint, SlicePoint]>>;
  rotationArrowheads: Record<PreviewAxis, Array<[SlicePoint, SlicePoint]>>;
  moveGuide: Array<[SlicePoint, SlicePoint]>;
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

export function normalizeSliceInteractionMode(mode: string | undefined): SliceInteractionMode {
  return mode === "rotate" ? "rotate" : DEFAULT_SLICE_INTERACTION_MODE;
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
  interactionMode: SliceInteractionMode = DEFAULT_SLICE_INTERACTION_MODE,
  referenceNormal: Partial<SlicePoint> | undefined = DEFAULT_SLICE_NORMAL,
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
    interactionMode: normalizeSliceInteractionMode(interactionMode),
    tiltDegrees: getSliceTiltDegrees(normalizedNormal, referenceNormal),
    bounds: bounds ? getPreviewBoundsSize(bounds) : null,
    axis: closestSliceAxis(normalizedNormal),
    position: normalizedOffset,
    thickness: normalizeSliceThickness(legacyThickness),
  };
}

export function createSliceOffsetForPoint(
  bounds: PreviewBounds | null,
  normal: Partial<SlicePoint> | undefined,
  point: SlicePoint,
): number {
  if (!bounds) return DEFAULT_SLICE_OFFSET;
  const normalizedNormal = normalizeSliceNormal(normal);
  const projections = projectBoundsOntoNormal(bounds, normalizedNormal);
  const span = projections.max - projections.min;
  if (!Number.isFinite(span) || span <= Number.EPSILON) return DEFAULT_SLICE_OFFSET;
  const distance = dotPreviewWorldPoints(point, normalizedNormal);
  return normalizeSliceOffset((distance - projections.min) / span);
}

export function rotateSliceNormal(
  normal: Partial<SlicePoint> | undefined,
  cameraRight: Partial<SlicePoint> | undefined,
  cameraUp: Partial<SlicePoint> | undefined,
  horizontalRadians: number,
  verticalRadians: number,
): SlicePoint {
  const start = normalizeSliceNormal(normal);
  const right = normalizePreviewWorldPoint({
    x: Number(cameraRight?.x),
    y: Number(cameraRight?.y),
    z: Number(cameraRight?.z),
  }) ?? { x: 1, y: 0, z: 0 };
  const up = normalizePreviewWorldPoint({
    x: Number(cameraUp?.x),
    y: Number(cameraUp?.y),
    z: Number(cameraUp?.z),
  }) ?? { x: 0, y: 1, z: 0 };
  const yawed = rotateSlicePointAroundAxis(start, up, -finiteRadians(horizontalRadians));
  const pitched = rotateSlicePointAroundAxis(yawed, right, -finiteRadians(verticalRadians));
  return normalizePreviewWorldPoint(pitched) ?? start;
}

export function rotateSliceNormalAroundAxis(
  normal: Partial<SlicePoint> | undefined,
  axis: Partial<SlicePoint> | undefined,
  radians: number,
): SlicePoint {
  const start = normalizeSliceNormal(normal);
  const normalizedAxis = normalizePreviewWorldPoint({
    x: Number(axis?.x),
    y: Number(axis?.y),
    z: Number(axis?.z),
  }) ?? { x: 0, y: 1, z: 0 };
  return normalizePreviewWorldPoint(
    rotateSlicePointAroundAxis(start, normalizedAxis, finiteRadians(radians)),
  ) ?? start;
}

export function normalizeSliceRotationRadians(radians: number): number {
  const full = Math.PI * 2;
  const normalized = ((finiteRadians(radians) + Math.PI) % full + full) % full - Math.PI;
  return normalized === -Math.PI ? Math.PI : normalized;
}

export function snapSliceRotationRadians(radians: number, radiusRatio: number): number {
  return snapSliceRotationRadiansForMode(radians, resolveSliceRotationSnapMode(radiusRatio));
}

export function resolveSliceRotationSnapMode(
  radiusRatio: number,
  previous: SliceRotationSnapMode = "free",
): SliceRotationSnapMode {
  const ratio = Number.isFinite(radiusRatio) ? Math.abs(radiusRatio) : 1;
  if (previous === "coarse" && ratio >= 0.26 && ratio <= 0.74) return "coarse";
  if (previous === "fine" && ratio >= 0.82 && ratio <= 1.32) return "fine";
  if (ratio >= 0.3 && ratio <= 0.68) return "coarse";
  if (ratio >= 0.88 && ratio <= 1.24) return "fine";
  return "free";
}

export function snapSliceRotationRadiansForMode(radians: number, mode: SliceRotationSnapMode): number {
  const normalized = normalizeSliceRotationRadians(radians);
  const step = mode === "coarse" ? Math.PI / 4 : mode === "fine" ? Math.PI / 36 : 0;
  return step > 0 ? Math.round(normalized / step) * step : normalized;
}

export function shouldUseSliceScreenRotation(rayPlaneAlignment: number): boolean {
  return !Number.isFinite(rayPlaneAlignment)
    || Math.abs(rayPlaneAlignment) < SLICE_RAY_PLANE_ALIGNMENT_THRESHOLD;
}

export function normalizeSlicePlaneAxes(
  axes: Partial<SlicePlaneAxes> | undefined,
  normal: Partial<SlicePoint> | undefined,
): SlicePlaneAxes {
  const z = normalizeSliceNormal(axes?.z ?? normal);
  const fallback = createSlicePlaneBasis(z);
  const xCandidate = normalizePreviewWorldPoint(axes?.x ?? fallback.u) ?? fallback.u;
  const xProjected = {
    x: xCandidate.x - z.x * dotPreviewWorldPoints(xCandidate, z),
    y: xCandidate.y - z.y * dotPreviewWorldPoints(xCandidate, z),
    z: xCandidate.z - z.z * dotPreviewWorldPoints(xCandidate, z),
  };
  const x = normalizePreviewWorldPoint(xProjected) ?? fallback.u;
  let y = normalizePreviewWorldPoint(crossSlicePoint(z, x)) ?? fallback.v;
  if (axes?.y && dotPreviewWorldPoints(y, axes.y) < 0) {
    y = scalePreviewWorldPoint(y, -1);
  }
  return { x, y, z };
}

export function getSliceTiltDegrees(
  normal: Partial<SlicePoint> | undefined,
  referenceNormal: Partial<SlicePoint> | undefined,
): number {
  const current = normalizeSliceNormal(normal);
  const reference = normalizeSliceNormal(referenceNormal);
  const cosine = Math.max(-1, Math.min(1, dotPreviewWorldPoints(current, reference)));
  return Math.acos(cosine) * (180 / Math.PI);
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
  paddingFactor = 0.12,
  axes?: Partial<SlicePlaneAxes>,
): SlicePlaneGeometry {
  const planeAxes = normalizeSlicePlaneAxes(axes, range.normal);
  const center = range.point;
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (const corner of createBoundsCorners(bounds)) {
    const relative = {
      x: corner.x - center.x,
      y: corner.y - center.y,
      z: corner.z - center.z,
    };
    const u = dotPreviewWorldPoints(relative, planeAxes.x);
    const v = dotPreviewWorldPoints(relative, planeAxes.y);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const marginFactor = Math.max(0.1, Number.isFinite(paddingFactor) ? paddingFactor : 0.12);
  const minimumMargin = Math.max(getPreviewBoundsRadius(bounds) * 0.04, Number.EPSILON);
  const marginU = Math.max((maxU - minU) * marginFactor, minimumMargin);
  const marginV = Math.max((maxV - minV) * marginFactor, minimumMargin);
  minU -= marginU;
  maxU += marginU;
  minV -= marginV;
  maxV += marginV;
  const pointAt = (u: number, v: number) => addPreviewWorldPoints(
    addPreviewWorldPoints(center, scalePreviewWorldPoint(planeAxes.x, u)),
    scalePreviewWorldPoint(planeAxes.y, v),
  );
  const corners: [SlicePoint, SlicePoint, SlicePoint, SlicePoint] = [
    pointAt(minU, minV),
    pointAt(maxU, minV),
    pointAt(maxU, maxV),
    pointAt(minU, maxV),
  ];
  return {
    coordinate: range.distance,
    normal: { ...range.normal },
    center: { ...center },
    corners,
    segments: createSliceFrameSegments(corners),
  };
}

export function createSliceGizmoGeometry(
  bounds: PreviewBounds,
  range: SliceRange,
  segmentCount = 64,
  axes?: Partial<SlicePlaneAxes>,
  rotationAngles?: Partial<Record<PreviewAxis, number>>,
): SliceGizmoGeometry {
  const radius = Math.max(getPreviewBoundsRadius(bounds) * 0.62, range.span * 0.16, Number.EPSILON);
  const center = range.point;
  const planeAxes = normalizeSlicePlaneAxes(axes, range.normal);
  const normal = planeAxes.z;
  const arrowLength = radius * 0.92;
  const arrowHeadLength = radius * 0.16;
  const arrowHeadWidth = radius * 0.085;
  const start = addPreviewWorldPoints(center, scalePreviewWorldPoint(normal, -arrowLength * 0.52));
  const tip = addPreviewWorldPoints(center, scalePreviewWorldPoint(normal, arrowLength));
  const arrowBase = addPreviewWorldPoints(tip, scalePreviewWorldPoint(normal, -arrowHeadLength));
  const arrowLeft = addPreviewWorldPoints(arrowBase, scalePreviewWorldPoint(planeAxes.x, arrowHeadWidth));
  const arrowRight = addPreviewWorldPoints(arrowBase, scalePreviewWorldPoint(planeAxes.x, -arrowHeadWidth));

  return {
    rotationRings: {
      x: createSliceCircleSegments(center, "x", radius, segmentCount, planeAxes),
      y: createSliceCircleSegments(center, "y", radius, segmentCount, planeAxes),
      z: createSliceCircleSegments(center, "z", radius, segmentCount, planeAxes),
    },
    rotationTicks: {
      x: createSliceCircleTicks(center, "x", radius, 36, planeAxes),
      y: createSliceCircleTicks(center, "y", radius, 36, planeAxes),
      z: createSliceCircleTicks(center, "z", radius, 36, planeAxes),
    },
    rotationArcs: {
      x: createSliceAngleArc(center, "x", radius * 1.12, rotationAngles?.x ?? 0, planeAxes),
      y: createSliceAngleArc(center, "y", radius * 1.12, rotationAngles?.y ?? 0, planeAxes),
      z: createSliceAngleArc(center, "z", radius * 1.12, rotationAngles?.z ?? 0, planeAxes),
    },
    rotationArrowheads: {
      x: createSliceRotationHandle(center, "x", radius * 1.12, rotationAngles?.x ?? 0, planeAxes),
      y: createSliceRotationHandle(center, "y", radius * 1.12, rotationAngles?.y ?? 0, planeAxes),
      z: createSliceRotationHandle(center, "z", radius * 1.12, rotationAngles?.z ?? 0, planeAxes),
    },
    moveGuide: [
      [start, tip],
      [tip, arrowLeft],
      [tip, arrowRight],
    ],
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

function finiteRadians(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function rotateSlicePointAroundAxis(point: SlicePoint, axis: SlicePoint, radians: number): SlicePoint {
  if (Math.abs(radians) <= Number.EPSILON) return { ...point };
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const cross = crossSlicePoint(axis, point);
  const projection = dotPreviewWorldPoints(axis, point) * (1 - cosine);
  return {
    x: point.x * cosine + cross.x * sine + axis.x * projection,
    y: point.y * cosine + cross.y * sine + axis.y * projection,
    z: point.z * cosine + cross.z * sine + axis.z * projection,
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

function createSliceCircleSegments(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  segmentCount: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const count = Math.max(16, Math.round(segmentCount));
  const segments: Array<[SlicePoint, SlicePoint]> = [];
  for (let index = 0; index < count; index += 1) {
    const startAngle = (index / count) * Math.PI * 2;
    const endAngle = ((index + 1) / count) * Math.PI * 2;
    segments.push([
      createSliceCirclePoint(center, axis, radius, startAngle, axes),
      createSliceCirclePoint(center, axis, radius, endAngle, axes),
    ]);
  }
  return segments;
}

function createSliceCirclePoint(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  angle: number,
  axes: SlicePlaneAxes,
): SlicePoint {
  const cosine = Math.cos(angle) * radius;
  const sine = Math.sin(angle) * radius;
  const first = axis === "x" ? axes.y : axis === "y" ? axes.z : axes.x;
  const second = axis === "x" ? axes.z : axis === "y" ? axes.x : axes.y;
  return addPreviewWorldPoints(
    addPreviewWorldPoints(center, scalePreviewWorldPoint(first, cosine)),
    scalePreviewWorldPoint(second, sine),
  );
}

function createSliceCircleTicks(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  tickCount: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const count = Math.max(12, Math.round(tickCount));
  const ticks: Array<[SlicePoint, SlicePoint]> = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const major = index % 3 === 0;
    ticks.push([
      createSliceCirclePoint(center, axis, radius * (major ? 0.93 : 0.96), angle, axes),
      createSliceCirclePoint(center, axis, radius * 1.06, angle, axes),
    ]);
  }
  return ticks;
}

function createSliceArcSegments(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  startTurn: number,
  endTurn: number,
  segmentCount: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const segments: Array<[SlicePoint, SlicePoint]> = [];
  const startAngle = startTurn * Math.PI * 2;
  const endAngle = endTurn * Math.PI * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const amount = index / segmentCount;
    const nextAmount = (index + 1) / segmentCount;
    segments.push([
      createSliceCirclePoint(center, axis, radius, startAngle + (endAngle - startAngle) * amount, axes),
      createSliceCirclePoint(center, axis, radius, startAngle + (endAngle - startAngle) * nextAmount, axes),
    ]);
  }
  return segments;
}

function createSliceAngleArc(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  angle: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const normalized = ((finiteRadians(angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return createSliceArcSegments(center, axis, radius, 0, normalized / (Math.PI * 2), 52, axes);
}

function createSliceRotationHandle(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  angle: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const normalized = ((finiteRadians(angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const arrowLength = radius * 0.12;
  const arrowWidth = radius * 0.055;
  return [
    ...createSliceArcArrowhead(center, axis, radius, normalized, 1, arrowLength, arrowWidth, axes),
    ...createSliceArcArrowhead(center, axis, radius, normalized, -1, arrowLength, arrowWidth, axes),
  ];
}

function createSliceArcArrowheads(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  startTurn: number,
  endTurn: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const arrowLength = radius * 0.12;
  const arrowWidth = radius * 0.055;
  return [
    ...createSliceArcArrowhead(center, axis, radius, startTurn * Math.PI * 2, 1, arrowLength, arrowWidth, axes),
    ...createSliceArcArrowhead(center, axis, radius, endTurn * Math.PI * 2, -1, arrowLength, arrowWidth, axes),
  ];
}

function createSliceArcArrowhead(
  center: SlicePoint,
  axis: PreviewAxis,
  radius: number,
  angle: number,
  direction: 1 | -1,
  length: number,
  width: number,
  axes: SlicePlaneAxes,
): Array<[SlicePoint, SlicePoint]> {
  const tip = createSliceCirclePoint(center, axis, radius, angle, axes);
  const behind = createSliceCirclePoint(center, axis, radius, angle - direction * (length / radius), axes);
  const radial = normalizePreviewWorldPoint({
    x: behind.x - center.x,
    y: behind.y - center.y,
    z: behind.z - center.z,
  }) ?? { x: 1, y: 0, z: 0 };
  const left = addPreviewWorldPoints(behind, scalePreviewWorldPoint(radial, width));
  const right = addPreviewWorldPoints(behind, scalePreviewWorldPoint(radial, -width));
  return [[tip, left], [tip, right], [left, right]];
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
