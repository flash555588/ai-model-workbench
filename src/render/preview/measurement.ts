import type { MeasurementPreview, MeasurementReading, MeasurementRecord, MeasurementScale, MeasurementSnapKind, MeasurementState, MeasurementUnit, PreviewWorldPoint } from "./types";

export type { MeasurementReading, MeasurementRecord } from "./types";

export const MEASUREMENT_STYLE = {
  line: "#f8fafc",
  marker: "#f8fafc",
  pending: "#f59e0b",
  hover: "#ffffff",
  preview: "#e5e7eb",
  labelPlate: "rgba(248, 250, 252, 0.94)",
  labelPlateBorder: "rgba(15, 23, 42, 0.58)",
  labelText: "#111827",
  labelSecondary: "rgba(51, 65, 85, 0.82)",
  labelOutline: "rgba(248, 250, 252, 0.22)",
} as const;

export const MEASUREMENT_LABEL_CANVAS = {
  width: 760,
  height: 220,
} as const;

const MEASUREMENT_ACTIVE_CLASS = "ai3d-measurement-active";
const MEASUREMENT_FOCUS_AGGREGATION_CLASS = "ai3d-measurement-focus-aggregation";
const MEASUREMENT_FOCUS_AGGREGATION_MS = 1100;

const UNIT_FACTORS_TO_METERS: Record<MeasurementUnit, number> = {
  um: 0.000001,
  mm: 0.001,
  cm: 0.01,
  m: 1,
};

const MIN_MEASUREMENT_SIZE = 1e-9;
const MEASUREMENT_EDGE_KEY_SCALE = 1_000_000;
const MEASUREMENT_COPLANAR_EDGE_DOT = 0.9995;

export interface MeasurementSnapVertexCandidate {
  point: PreviewWorldPoint;
  targetId?: string;
}

export interface MeasurementSnapEdgeCandidate {
  start: PreviewWorldPoint;
  end: PreviewWorldPoint;
  targetId?: string;
}

export interface MeasurementGeometrySnapInput {
  vertices: readonly MeasurementSnapVertexCandidate[];
  edges: readonly MeasurementSnapEdgeCandidate[];
  targetId?: string;
  vertexRadius?: number;
  maxDistance?: number;
}

export interface MeasurementSnapResult {
  point: PreviewWorldPoint;
  kind: MeasurementSnapKind;
  distance: number;
  targetId?: string;
}

export interface MeasurementDraftingLayoutOptions {
  viewPosition?: PreviewWorldPoint | null;
  viewUp?: PreviewWorldPoint | null;
  offset?: number;
  extensionGap?: number;
  extensionOvershoot?: number;
  arrowLength?: number;
  arrowWidth?: number;
  labelGap?: number;
}

export interface MeasurementDraftingLayout {
  lineSegments: Array<[PreviewWorldPoint, PreviewWorldPoint]>;
  labelPoint: PreviewWorldPoint;
}

const UNIT_LABELS: Record<MeasurementUnit, string> = {
  um: "μm",
  mm: "mm",
  cm: "cm",
  m: "m",
};

export function normalizeMeasurementUnit(unit: string | undefined): MeasurementUnit {
  switch (unit) {
    case "\u00b5m":
    case "\u03bcm":
      return "um";
    case "um":
    case "mm":
    case "cm":
    case "m":
      return unit;
    default:
      return "mm";
  }
}

export function sanitizeMeasurementScale(scale: MeasurementScale): MeasurementScale {
  return {
    x: Number.isFinite(scale.x) && scale.x > 0 ? scale.x : 1,
    y: Number.isFinite(scale.y) && scale.y > 0 ? scale.y : 1,
    z: Number.isFinite(scale.z) && scale.z > 0 ? scale.z : 1,
  };
}

export function formatMeasurementNumber(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return formatNumber(value, decimals);
}

export function createReferenceMeasurementScale(
  currentScale: MeasurementScale,
  measuredDistance: number,
  realDistance: number,
): MeasurementScale | null {
  if (!Number.isFinite(measuredDistance) || measuredDistance <= MIN_MEASUREMENT_SIZE) {
    return null;
  }
  if (!Number.isFinite(realDistance) || realDistance <= MIN_MEASUREMENT_SIZE) {
    return null;
  }

  const safeScale = sanitizeMeasurementScale(currentScale);
  const factor = realDistance / measuredDistance;
  return sanitizeMeasurementScale({
    x: safeScale.x * factor,
    y: safeScale.y * factor,
    z: safeScale.z * factor,
  });
}

export function scaleMeasurementPointFromBase(
  point: PreviewWorldPoint,
  pivot: PreviewWorldPoint,
  scale: MeasurementScale,
): PreviewWorldPoint {
  const safeScale = sanitizeMeasurementScale(scale);
  return {
    x: pivot.x + (point.x - pivot.x) * safeScale.x,
    y: pivot.y + (point.y - pivot.y) * safeScale.y,
    z: pivot.z + (point.z - pivot.z) * safeScale.z,
  };
}

export function unscaleMeasurementPointToBase(
  point: PreviewWorldPoint,
  pivot: PreviewWorldPoint,
  scale: MeasurementScale,
): PreviewWorldPoint {
  const safeScale = sanitizeMeasurementScale(scale);
  return {
    x: pivot.x + (point.x - pivot.x) / safeScale.x,
    y: pivot.y + (point.y - pivot.y) / safeScale.y,
    z: pivot.z + (point.z - pivot.z) / safeScale.z,
  };
}

export function snapMeasurementPointToGeometry(
  point: PreviewWorldPoint,
  input: MeasurementGeometrySnapInput,
): MeasurementSnapResult | null {
  if (!isFiniteMeasurementPoint(point)) {
    return null;
  }

  let nearestVertex: MeasurementSnapResult | null = null;
  for (const vertex of input.vertices) {
    if (!isFiniteMeasurementPoint(vertex.point)) continue;
    nearestVertex = chooseNearestMeasurementSnapResult(nearestVertex, {
      point: vertex.point,
      kind: "vertex",
      distance: distanceMeasurementPoints(point, vertex.point),
      targetId: vertex.targetId ?? input.targetId,
    });
  }

  let nearestEdge: MeasurementSnapResult | null = null;
  for (const edge of input.edges) {
    if (!isFiniteMeasurementPoint(edge.start) || !isFiniteMeasurementPoint(edge.end)) continue;
    const edgePoint = projectMeasurementPointToSegment(point, edge.start, edge.end);
    if (!edgePoint) continue;
    nearestEdge = chooseNearestMeasurementSnapResult(nearestEdge, {
      point: edgePoint,
      kind: "edge",
      distance: distanceMeasurementPoints(point, edgePoint),
      targetId: edge.targetId ?? input.targetId,
    });
  }

  const vertexRadius = Math.max(input.vertexRadius ?? 0, 0);
  const candidate = nearestVertex && nearestVertex.distance <= vertexRadius
    ? nearestVertex
    : nearestEdge ?? nearestVertex;
  if (!candidate) {
    return null;
  }
  if (Number.isFinite(input.maxDistance) && candidate.distance > (input.maxDistance ?? 0)) {
    return null;
  }

  return {
    point: { ...candidate.point },
    kind: candidate.kind,
    distance: candidate.distance,
    targetId: candidate.targetId,
  };
}

export function createMeasurementGeometryEdgesFromTriangles(
  vertices: readonly PreviewWorldPoint[],
  triangles: readonly [number, number, number][],
  targetId?: string,
): MeasurementSnapEdgeCandidate[] {
  const edgeEntries = new Map<string, {
    start: PreviewWorldPoint;
    end: PreviewWorldPoint;
    normals: PreviewWorldPoint[];
    targetId?: string;
  }>();
  for (const [a, b, c] of triangles) {
    const triangleVertices = [vertices[a], vertices[b], vertices[c]] as const;
    if (triangleVertices.some((point) => !point || !isFiniteMeasurementPoint(point))) continue;
    const normal = createMeasurementTriangleNormal(triangleVertices[0], triangleVertices[1], triangleVertices[2]);
    for (const [left, right] of [[a, b], [b, c], [c, a]] as const) {
      const start = vertices[left];
      const end = vertices[right];
      if (!start || !end || !isFiniteMeasurementPoint(start) || !isFiniteMeasurementPoint(end)) continue;
      if (distanceMeasurementPoints(start, end) <= MIN_MEASUREMENT_SIZE) continue;
      const key = createMeasurementEdgeKey(start, end);
      const entry = edgeEntries.get(key);
      if (entry) {
        if (normal) entry.normals.push(normal);
      } else {
        edgeEntries.set(key, {
          start,
          end,
          normals: normal ? [normal] : [],
          targetId,
        });
      }
    }
  }
  return Array.from(edgeEntries.values())
    .filter((edge) => !isCoplanarSharedMeasurementEdge(edge.normals))
    .map((edge) => ({ start: edge.start, end: edge.end, targetId: edge.targetId }));
}

export function createMeasurementTrianglesFromIndices(
  vertexCount: number,
  indices?: ArrayLike<number> | null,
): Array<[number, number, number]> {
  const triangles: Array<[number, number, number]> = [];
  if (indices && indices.length >= 3) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (isValidMeasurementVertexIndex(a, vertexCount)
        && isValidMeasurementVertexIndex(b, vertexCount)
        && isValidMeasurementVertexIndex(c, vertexCount)) {
        triangles.push([a, b, c]);
      }
    }
    return triangles;
  }

  for (let i = 0; i + 2 < vertexCount; i += 3) {
    triangles.push([i, i + 1, i + 2]);
  }
  return triangles;
}

export function createMeasurementDraftingLayout(
  start: PreviewWorldPoint,
  end: PreviewWorldPoint,
  options: MeasurementDraftingLayoutOptions = {},
): MeasurementDraftingLayout | null {
  if (!isFiniteMeasurementPoint(start) || !isFiniteMeasurementPoint(end)) {
    return null;
  }

  const measureVector = subtractMeasurementPoints(end, start);
  const length = lengthMeasurementVector(measureVector);
  if (length <= MIN_MEASUREMENT_SIZE) {
    return null;
  }

  const axis = scaleMeasurementVector(measureVector, 1 / length);
  const mid = scaleMeasurementVector(addMeasurementPoints(start, end), 0.5);
  const viewPosition = options.viewPosition ?? { x: mid.x, y: mid.y, z: mid.z + 1 };
  const viewDirection = normalizeMeasurementVector(subtractMeasurementPoints(viewPosition, mid))
    ?? { x: 0, y: 0, z: 1 };
  const viewUp = normalizeMeasurementVector(options.viewUp ?? { x: 0, y: 1, z: 0 })
    ?? { x: 0, y: 1, z: 0 };
  let normal = normalizeMeasurementVector(crossMeasurementVectors(viewDirection, axis))
    ?? normalizeMeasurementVector(crossMeasurementVectors(viewUp, axis))
    ?? pickMeasurementPerpendicular(axis);
  if (dotMeasurementVectors(normal, viewUp) < 0) {
    normal = scaleMeasurementVector(normal, -1);
  }

  const baseOffset = options.offset ?? Math.max(length * 0.08, MIN_MEASUREMENT_SIZE * 1000);
  const offset = Math.max(baseOffset, MIN_MEASUREMENT_SIZE * 1000);
  const extensionGap = Math.max(options.extensionGap ?? offset * 0.16, 0);
  const extensionOvershoot = Math.max(options.extensionOvershoot ?? offset * 0.22, 0);
  const arrowLength = Math.min(
    Math.max(options.arrowLength ?? offset * 0.62, offset * 0.2),
    length * 0.42,
  );
  const arrowWidth = Math.max(options.arrowWidth ?? arrowLength * 0.34, offset * 0.08);
  const labelGap = Math.max(options.labelGap ?? arrowWidth * 1.18, 0);

  const dimStart = addMeasurementPoints(start, scaleMeasurementVector(normal, offset));
  const dimEnd = addMeasurementPoints(end, scaleMeasurementVector(normal, offset));
  const startExtensionNear = addMeasurementPoints(start, scaleMeasurementVector(normal, extensionGap));
  const endExtensionNear = addMeasurementPoints(end, scaleMeasurementVector(normal, extensionGap));
  const startExtensionFar = addMeasurementPoints(dimStart, scaleMeasurementVector(normal, extensionOvershoot));
  const endExtensionFar = addMeasurementPoints(dimEnd, scaleMeasurementVector(normal, extensionOvershoot));
  const startArrowBase = addMeasurementPoints(dimStart, scaleMeasurementVector(axis, arrowLength));
  const endArrowBase = addMeasurementPoints(dimEnd, scaleMeasurementVector(axis, -arrowLength));
  const arrowOffset = scaleMeasurementVector(normal, arrowWidth);
  const labelPoint = addMeasurementPoints(
    scaleMeasurementVector(addMeasurementPoints(dimStart, dimEnd), 0.5),
    scaleMeasurementVector(normal, labelGap),
  );

  return {
    lineSegments: [
      [startExtensionNear, startExtensionFar],
      [endExtensionNear, endExtensionFar],
      [dimStart, dimEnd],
      [dimStart, addMeasurementPoints(startArrowBase, arrowOffset)],
      [dimStart, subtractMeasurementPoints(startArrowBase, arrowOffset)],
      [dimEnd, addMeasurementPoints(endArrowBase, arrowOffset)],
      [dimEnd, subtractMeasurementPoints(endArrowBase, arrowOffset)],
    ],
    labelPoint,
  };
}

export function createBoundsMeasurementScale(
  bounds: PreviewWorldPoint,
  realSize: Partial<PreviewWorldPoint>,
  currentScale: MeasurementScale,
  lockRatio: boolean,
): MeasurementScale | null {
  const safeScale = sanitizeMeasurementScale(currentScale);
  const axes = ["x", "y", "z"] as const;

  if (lockRatio) {
    const axis = axes.find((entry) =>
      Number.isFinite(realSize[entry]) &&
      (realSize[entry] ?? 0) > MIN_MEASUREMENT_SIZE &&
      bounds[entry] > MIN_MEASUREMENT_SIZE);
    if (!axis) {
      return null;
    }
    const ratio = (realSize[axis] ?? 0) / bounds[axis];
    return sanitizeMeasurementScale({ x: ratio, y: ratio, z: ratio });
  }

  let changed = false;
  const next: MeasurementScale = { ...safeScale };
  for (const axis of axes) {
    const value = realSize[axis];
    if (Number.isFinite(value) && (value ?? 0) > MIN_MEASUREMENT_SIZE && bounds[axis] > MIN_MEASUREMENT_SIZE) {
      next[axis] = (value ?? 0) / bounds[axis];
      changed = true;
    }
  }

  return changed ? sanitizeMeasurementScale(next) : null;
}

export function createMeasurementState(options: {
  active: boolean;
  pending: boolean;
  records: MeasurementRecord[];
  unit: MeasurementUnit;
  scale: MeasurementScale;
  bounds: PreviewWorldPoint | null;
  targetLocked?: boolean;
  targetName?: string | null;
  snapKind?: MeasurementSnapKind | null;
}): MeasurementState {
  const phase: MeasurementState["phase"] = options.active
    ? options.pending ? "picking-end" : options.targetLocked ? "ready" : "select-target"
    : options.records.length > 0 ? "reviewing" : "inactive";
  return {
    active: options.active,
    phase,
    records: options.records,
    unit: normalizeMeasurementUnit(options.unit),
    scale: sanitizeMeasurementScale(options.scale),
    bounds: options.bounds,
    targetLocked: !!options.targetLocked,
    targetName: options.targetName ?? null,
    snapKind: options.snapKind ?? null,
  };
}

export function cancelOrDeactivateMeasurement(preview: MeasurementPreview): boolean {
  const state = preview.getMeasurementState();
  if (!state.active) return false;
  if (state.phase === "picking-end") {
    preview.cancelMeasurement();
  } else {
    preview.toggleMeasurement();
  }
  return true;
}

export function setMeasurementCanvasActive(canvas: HTMLCanvasElement | null | undefined, active: boolean): void {
  if (!canvas) return;
  canvas.classList.toggle(MEASUREMENT_ACTIVE_CLASS, active);
  if (!active) {
    canvas.classList.remove(MEASUREMENT_FOCUS_AGGREGATION_CLASS);
    delete canvas.dataset.ai3dMeasurementFocusToken;
    return;
  }

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  canvas.dataset.ai3dMeasurementFocusToken = token;
  canvas.classList.remove(MEASUREMENT_FOCUS_AGGREGATION_CLASS);
  canvas.getBoundingClientRect();
  canvas.classList.add(MEASUREMENT_FOCUS_AGGREGATION_CLASS);

  window.setTimeout(() => {
    if (canvas.dataset.ai3dMeasurementFocusToken === token) {
      canvas.classList.remove(MEASUREMENT_FOCUS_AGGREGATION_CLASS);
      delete canvas.dataset.ai3dMeasurementFocusToken;
    }
  }, MEASUREMENT_FOCUS_AGGREGATION_MS);
}

export function createMeasurementReading(
  start: PreviewWorldPoint,
  end: PreviewWorldPoint,
  scale: MeasurementScale,
  unit: MeasurementUnit,
): MeasurementReading {
  const safeScale = sanitizeMeasurementScale(scale);
  const delta = {
    x: (end.x - start.x) * safeScale.x,
    y: (end.y - start.y) * safeScale.y,
    z: (end.z - start.z) * safeScale.z,
  };
  const absDelta = {
    x: Math.abs(delta.x),
    y: Math.abs(delta.y),
    z: Math.abs(delta.z),
  };
  return {
    distance: Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z),
    delta,
    absDelta,
    unit,
  };
}

function formatNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

function isFiniteMeasurementPoint(point: PreviewWorldPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function createMeasurementPointKey(point: PreviewWorldPoint): string {
  return [
    Math.round(point.x * MEASUREMENT_EDGE_KEY_SCALE),
    Math.round(point.y * MEASUREMENT_EDGE_KEY_SCALE),
    Math.round(point.z * MEASUREMENT_EDGE_KEY_SCALE),
  ].join(",");
}

function createMeasurementEdgeKey(start: PreviewWorldPoint, end: PreviewWorldPoint): string {
  const left = createMeasurementPointKey(start);
  const right = createMeasurementPointKey(end);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function createMeasurementTriangleNormal(
  a: PreviewWorldPoint,
  b: PreviewWorldPoint,
  c: PreviewWorldPoint,
): PreviewWorldPoint | null {
  return normalizeMeasurementVector(crossMeasurementVectors(
    subtractMeasurementPoints(b, a),
    subtractMeasurementPoints(c, a),
  ));
}

function isCoplanarSharedMeasurementEdge(normals: readonly PreviewWorldPoint[]): boolean {
  if (normals.length < 2) return false;
  for (let i = 0; i < normals.length; i++) {
    for (let j = i + 1; j < normals.length; j++) {
      if (Math.abs(dotMeasurementVectors(normals[i], normals[j])) < MEASUREMENT_COPLANAR_EDGE_DOT) {
        return false;
      }
    }
  }
  return true;
}

function distanceMeasurementPoints(left: PreviewWorldPoint, right: PreviewWorldPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function addMeasurementPoints(left: PreviewWorldPoint, right: PreviewWorldPoint): PreviewWorldPoint {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractMeasurementPoints(left: PreviewWorldPoint, right: PreviewWorldPoint): PreviewWorldPoint {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleMeasurementVector(vector: PreviewWorldPoint, scale: number): PreviewWorldPoint {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function lengthMeasurementVector(vector: PreviewWorldPoint): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeMeasurementVector(vector: PreviewWorldPoint | null | undefined): PreviewWorldPoint | null {
  if (!vector || !isFiniteMeasurementPoint(vector)) return null;
  const length = lengthMeasurementVector(vector);
  if (length <= MIN_MEASUREMENT_SIZE) return null;
  return scaleMeasurementVector(vector, 1 / length);
}

function dotMeasurementVectors(left: PreviewWorldPoint, right: PreviewWorldPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossMeasurementVectors(left: PreviewWorldPoint, right: PreviewWorldPoint): PreviewWorldPoint {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function pickMeasurementPerpendicular(axis: PreviewWorldPoint): PreviewWorldPoint {
  const seed = Math.abs(axis.y) < 0.8 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalizeMeasurementVector(crossMeasurementVectors(seed, axis)) ?? { x: 0, y: 0, z: 1 };
}

function chooseNearestMeasurementSnapResult(
  left: MeasurementSnapResult | null,
  right: MeasurementSnapResult | null,
): MeasurementSnapResult | null {
  if (!left) return right;
  if (!right) return left;
  if (right.distance < left.distance) return right;
  if (right.distance === left.distance && right.kind === "vertex" && left.kind !== "vertex") return right;
  return left;
}

function projectMeasurementPointToSegment(
  point: PreviewWorldPoint,
  start: PreviewWorldPoint,
  end: PreviewWorldPoint,
): PreviewWorldPoint | null {
  const segment = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
  const lengthSquared = segment.x * segment.x + segment.y * segment.y + segment.z * segment.z;
  if (lengthSquared <= MIN_MEASUREMENT_SIZE) {
    return null;
  }
  const offset = {
    x: point.x - start.x,
    y: point.y - start.y,
    z: point.z - start.z,
  };
  const t = Math.max(0, Math.min(1, (offset.x * segment.x + offset.y * segment.y + offset.z * segment.z) / lengthSquared));
  return {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t,
    z: start.z + segment.z * t,
  };
}

function isValidMeasurementVertexIndex(index: number | undefined, vertexCount: number): index is number {
  return typeof index === "number" && Number.isInteger(index) && index >= 0 && index < vertexCount;
}

function chooseDisplayUnit(value: number, unit: MeasurementUnit): MeasurementUnit {
  if (value === 0) return unit;
  const meters = Math.abs(value) * UNIT_FACTORS_TO_METERS[unit];
  if (meters < 0.001) return "um";
  if (meters < 0.1) return "mm";
  if (meters < 1) return "cm";
  return "m";
}

function getMeasurementUnitLabel(unit: MeasurementUnit): string {
  return unit === "um" ? "um" : UNIT_LABELS[unit];
}

export function formatMeasurementValue(value: number, unit: MeasurementUnit, autoUnit = true): string {
  const displayUnit = autoUnit ? chooseDisplayUnit(value, unit) : unit;
  const converted = value * UNIT_FACTORS_TO_METERS[unit] / UNIT_FACTORS_TO_METERS[displayUnit];
  const abs = Math.abs(converted);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return `${formatNumber(converted, decimals)} ${getMeasurementUnitLabel(displayUnit)}`;
}

export function formatMeasurementAxisValue(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : 3;
  return formatNumber(abs, decimals);
}

export function createMeasurementLabel(reading: MeasurementReading): { primary: string; secondary: string } {
  return {
    primary: formatMeasurementValue(reading.distance, reading.unit),
    secondary: [
      `X ${formatMeasurementAxisValue(reading.absDelta.x)}`,
      `Y ${formatMeasurementAxisValue(reading.absDelta.y)}`,
      `Z ${formatMeasurementAxisValue(reading.absDelta.z)}`,
      getMeasurementUnitLabel(reading.unit),
    ].join("  "),
  };
}

export function drawMeasurementLabelCanvas(
  ctx: CanvasRenderingContext2D,
  text: { primary: string; secondary: string },
  width: number = MEASUREMENT_LABEL_CANVAS.width,
  height: number = MEASUREMENT_LABEL_CANVAS.height,
): void {
  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const plateWidth = Math.min(
    width - 120,
    Math.max(250, text.primary.length * 24 + 92),
  );
  const plateHeight = 78;
  const plateX = (width - plateWidth) / 2;
  const plateY = (height - plateHeight) / 2;
  const primaryY = centerY;

  drawRoundedRectPath(ctx, plateX, plateY, plateWidth, plateHeight, 4);
  ctx.fillStyle = MEASUREMENT_STYLE.labelPlate;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = MEASUREMENT_STYLE.labelPlateBorder;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.fillStyle = MEASUREMENT_STYLE.labelText;
  ctx.font = "700 38px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(text.primary, centerX, primaryY, plateWidth - 72);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function createMeasurementMarkdown(records: readonly MeasurementRecord[]): string {
  if (records.length === 0) return "";
  const lines = [
    "## Measurements",
    "",
    "| # | Distance | Delta X | Delta Y | Delta Z | Start | End |",
    "|---|----------|---------|---------|---------|-------|-----|",
  ];
  for (const record of records) {
    const unit = record.reading.unit;
    const start = formatPoint(record.start);
    const end = formatPoint(record.end);
    lines.push([
      record.index,
      formatMeasurementValue(record.reading.distance, unit),
      formatMeasurementValue(record.reading.absDelta.x, unit, false),
      formatMeasurementValue(record.reading.absDelta.y, unit, false),
      formatMeasurementValue(record.reading.absDelta.z, unit, false),
      start,
      end,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return lines.join("\n");
}

function formatPoint(point: PreviewWorldPoint): string {
  return `${formatNumber(point.x, 3)}, ${formatNumber(point.y, 3)}, ${formatNumber(point.z, 3)}`;
}
