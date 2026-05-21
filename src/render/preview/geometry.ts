import type { PreviewAxis, PreviewWorldPoint } from "./types";

export interface PreviewLineOfSight {
  direction: PreviewWorldPoint;
  distance: number;
  epsilon: number;
}

export interface PreviewPlane {
  point: PreviewWorldPoint;
  normal: PreviewWorldPoint;
}

export interface PreviewRay {
  origin: PreviewWorldPoint;
  direction: PreviewWorldPoint;
}

export interface PreviewQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PreviewRotationDragInput {
  startPosition: PreviewWorldPoint;
  pivot: PreviewWorldPoint;
  startRotationQuaternion: PreviewQuaternion;
  yawAxis: PreviewWorldPoint;
  pitchAxis: PreviewWorldPoint;
  deltaX: number;
  deltaY: number;
  sensitivity: number;
}

export interface PreviewRotationDragResult {
  position: PreviewWorldPoint;
  rotationQuaternion: PreviewQuaternion;
}

export function toPreviewWorldPoint(value: { x: number; y: number; z: number }): PreviewWorldPoint {
  return { x: value.x, y: value.y, z: value.z };
}

export function clonePreviewWorldPoint(point: PreviewWorldPoint): PreviewWorldPoint {
  return { x: point.x, y: point.y, z: point.z };
}

export function subtractPreviewWorldPoints(
  left: PreviewWorldPoint,
  right: PreviewWorldPoint,
): PreviewWorldPoint {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

export function scalePreviewWorldPoint(point: PreviewWorldPoint, factor: number): PreviewWorldPoint {
  return {
    x: point.x * factor,
    y: point.y * factor,
    z: point.z * factor,
  };
}

export function distancePreviewWorldPoints(left: PreviewWorldPoint, right: PreviewWorldPoint): number {
  const delta = subtractPreviewWorldPoints(left, right);
  return Math.hypot(delta.x, delta.y, delta.z);
}

export function normalizePreviewWorldPoint(point: PreviewWorldPoint): PreviewWorldPoint | null {
  const length = Math.hypot(point.x, point.y, point.z);
  if (length <= Number.EPSILON) {
    return null;
  }
  return scalePreviewWorldPoint(point, 1 / length);
}

export function addPreviewWorldPoints(
  left: PreviewWorldPoint,
  right: PreviewWorldPoint,
): PreviewWorldPoint {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

export function dotPreviewWorldPoints(left: PreviewWorldPoint, right: PreviewWorldPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function offsetPreviewWorldPointOnAxis(
  point: PreviewWorldPoint,
  axis: PreviewAxis,
  delta: number,
): PreviewWorldPoint {
  return {
    x: axis === "x" ? point.x + delta : point.x,
    y: axis === "y" ? point.y + delta : point.y,
    z: axis === "z" ? point.z + delta : point.z,
  };
}

export function previewOcclusionEpsilon(distance: number): number {
  return Math.max(distance * 0.01, 0.01);
}

export function isPreviewHitOccluded(
  hitDistance: number,
  targetDistance: number,
  epsilon = previewOcclusionEpsilon(targetDistance),
): boolean {
  return hitDistance < targetDistance - epsilon;
}

export function createPreviewLineOfSight(
  origin: PreviewWorldPoint,
  target: PreviewWorldPoint,
): PreviewLineOfSight | null {
  const offset = subtractPreviewWorldPoints(target, origin);
  const distance = Math.hypot(offset.x, offset.y, offset.z);
  const direction = normalizePreviewWorldPoint(offset);
  if (!direction) {
    return null;
  }
  return {
    direction,
    distance,
    epsilon: previewOcclusionEpsilon(distance),
  };
}

export function createPreviewPlane(
  point: PreviewWorldPoint,
  normal: PreviewWorldPoint,
): PreviewPlane | null {
  const normalizedNormal = normalizePreviewWorldPoint(normal);
  if (!normalizedNormal) {
    return null;
  }
  return {
    point: clonePreviewWorldPoint(point),
    normal: normalizedNormal,
  };
}

export function intersectPreviewRayWithPlane(
  ray: PreviewRay,
  plane: PreviewPlane,
): PreviewWorldPoint | null {
  const denominator = dotPreviewWorldPoints(ray.direction, plane.normal);
  if (Math.abs(denominator) <= Number.EPSILON) {
    return null;
  }

  const originToPlane = subtractPreviewWorldPoints(plane.point, ray.origin);
  const distance = dotPreviewWorldPoints(originToPlane, plane.normal) / denominator;
  if (!Number.isFinite(distance)) {
    return null;
  }

  return addPreviewWorldPoints(ray.origin, scalePreviewWorldPoint(ray.direction, distance));
}

export function toPreviewQuaternion(value: { x: number; y: number; z: number; w: number }): PreviewQuaternion {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function multiplyPreviewQuaternions(left: PreviewQuaternion, right: PreviewQuaternion): PreviewQuaternion {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  };
}

function conjugatePreviewQuaternion(quaternion: PreviewQuaternion): PreviewQuaternion {
  return {
    x: -quaternion.x,
    y: -quaternion.y,
    z: -quaternion.z,
    w: quaternion.w,
  };
}

function createPreviewQuaternionFromAxisAngle(
  axis: PreviewWorldPoint,
  angle: number,
): PreviewQuaternion | null {
  const normalizedAxis = normalizePreviewWorldPoint(axis);
  if (!normalizedAxis) {
    return null;
  }
  const halfAngle = angle / 2;
  const sinHalf = Math.sin(halfAngle);
  return {
    x: normalizedAxis.x * sinHalf,
    y: normalizedAxis.y * sinHalf,
    z: normalizedAxis.z * sinHalf,
    w: Math.cos(halfAngle),
  };
}

function rotatePreviewWorldPointByQuaternion(
  point: PreviewWorldPoint,
  quaternion: PreviewQuaternion,
): PreviewWorldPoint {
  const pointQuaternion: PreviewQuaternion = { x: point.x, y: point.y, z: point.z, w: 0 };
  const rotated = multiplyPreviewQuaternions(
    multiplyPreviewQuaternions(quaternion, pointQuaternion),
    conjugatePreviewQuaternion(quaternion),
  );
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}

export function applyPreviewRotationDrag(
  input: PreviewRotationDragInput,
): PreviewRotationDragResult | null {
  const yaw = createPreviewQuaternionFromAxisAngle(input.yawAxis, input.deltaX * input.sensitivity);
  const pitch = createPreviewQuaternionFromAxisAngle(input.pitchAxis, input.deltaY * input.sensitivity);
  if (!yaw || !pitch) {
    return null;
  }

  const delta = multiplyPreviewQuaternions(yaw, pitch);
  const offset = subtractPreviewWorldPoints(input.startPosition, input.pivot);
  const rotatedOffset = rotatePreviewWorldPointByQuaternion(offset, delta);

  return {
    position: addPreviewWorldPoints(input.pivot, rotatedOffset),
    rotationQuaternion: multiplyPreviewQuaternions(delta, input.startRotationQuaternion),
  };
}
