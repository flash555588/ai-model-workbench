import { addPreviewWorldPoints, clonePreviewWorldPoint, distancePreviewWorldPoints, scalePreviewWorldPoint, subtractPreviewWorldPoints } from "./geometry";
import type { PreviewWorldPoint } from "./types";

export interface PreviewBounds {
  min: PreviewWorldPoint;
  max: PreviewWorldPoint;
}

export interface PreviewBoundsMetrics {
  center: PreviewWorldPoint;
  size: PreviewWorldPoint;
  diagonalLength: number;
  radius: number;
  maxSpan: number;
}

export function createPreviewBounds(min: PreviewWorldPoint, max: PreviewWorldPoint): PreviewBounds {
  return {
    min: clonePreviewWorldPoint(min),
    max: clonePreviewWorldPoint(max),
  };
}

export function mergePreviewBounds(current: PreviewBounds | null, next: PreviewBounds): PreviewBounds {
  if (!current) {
    return createPreviewBounds(next.min, next.max);
  }

  return {
    min: {
      x: Math.min(current.min.x, next.min.x),
      y: Math.min(current.min.y, next.min.y),
      z: Math.min(current.min.z, next.min.z),
    },
    max: {
      x: Math.max(current.max.x, next.max.x),
      y: Math.max(current.max.y, next.max.y),
      z: Math.max(current.max.z, next.max.z),
    },
  };
}

export function getPreviewBoundsSize(bounds: PreviewBounds): PreviewWorldPoint {
  return subtractPreviewWorldPoints(bounds.max, bounds.min);
}

export function getPreviewBoundsCenter(bounds: PreviewBounds): PreviewWorldPoint {
  return addPreviewWorldPoints(bounds.min, scalePreviewWorldPoint(getPreviewBoundsSize(bounds), 0.5));
}

export function getPreviewBoundsDiagonalLength(bounds: PreviewBounds): number {
  return distancePreviewWorldPoints(bounds.min, bounds.max);
}

export function getPreviewBoundsRadius(bounds: PreviewBounds): number {
  return getPreviewBoundsDiagonalLength(bounds) / 2;
}

export function getPreviewBoundsMaxSpan(bounds: PreviewBounds): number {
  const size = getPreviewBoundsSize(bounds);
  return Math.max(size.x, size.y, size.z);
}

export function getPreviewBoundsMetrics(bounds: PreviewBounds): PreviewBoundsMetrics {
  const size = getPreviewBoundsSize(bounds);
  const diagonalLength = getPreviewBoundsDiagonalLength(bounds);
  return {
    center: addPreviewWorldPoints(bounds.min, scalePreviewWorldPoint(size, 0.5)),
    size,
    diagonalLength,
    radius: diagonalLength / 2,
    maxSpan: Math.max(size.x, size.y, size.z),
  };
}
