import { getPreviewBoundsMetrics, type PreviewBounds } from "./bounds";
import { addPreviewWorldPoints, clonePreviewWorldPoint } from "./geometry";
import type { PreviewWorldPoint } from "./types";

export interface PreviewOrbitCameraFitOptions {
  radiusMultiplier?: number;
  lowerRadiusFactor?: number;
  upperRadiusFactor?: number;
  nearFactor?: number;
  farFactor?: number;
}

export interface PreviewOrbitCameraFit {
  target: PreviewWorldPoint;
  radius: number;
  lowerRadiusLimit: number;
  upperRadiusLimit: number;
  near: number;
  far: number;
}

export interface PreviewPerspectiveCameraFitOptions {
  distanceMultiplier?: number;
  elevationFactor?: number;
  nearDivisor?: number;
  farMultiplier?: number;
  minNear?: number;
  minFar?: number;
}

export interface PreviewPerspectiveCameraFit {
  target: PreviewWorldPoint;
  position: PreviewWorldPoint;
  near: number;
  far: number;
}

export function createPreviewOrbitCameraFitFromRadius(
  target: PreviewWorldPoint,
  boundsRadius: number,
  options: PreviewOrbitCameraFitOptions = {},
): PreviewOrbitCameraFit {
  const radius = Math.max(boundsRadius, Number.EPSILON);
  const radiusMultiplier = options.radiusMultiplier ?? 2.5;
  return {
    target: clonePreviewWorldPoint(target),
    radius: radius * radiusMultiplier,
    lowerRadiusLimit: radius * (options.lowerRadiusFactor ?? 0.05),
    upperRadiusLimit: radius * (options.upperRadiusFactor ?? 10),
    near: radius * (options.nearFactor ?? 0.001),
    far: radius * (options.farFactor ?? 20),
  };
}

export function createPreviewOrbitCameraFit(
  bounds: PreviewBounds,
  options: PreviewOrbitCameraFitOptions = {},
): PreviewOrbitCameraFit {
  const metrics = getPreviewBoundsMetrics(bounds);
  return createPreviewOrbitCameraFitFromRadius(metrics.center, metrics.radius, options);
}

export function createPreviewPerspectiveCameraFit(
  bounds: PreviewBounds,
  options: PreviewPerspectiveCameraFitOptions = {},
): PreviewPerspectiveCameraFit {
  const metrics = getPreviewBoundsMetrics(bounds);
  const distance = Math.max(metrics.maxSpan, 1) * (options.distanceMultiplier ?? 1.8);
  return {
    target: clonePreviewWorldPoint(metrics.center),
    position: addPreviewWorldPoints(metrics.center, {
      x: distance,
      y: distance * (options.elevationFactor ?? 0.65),
      z: distance,
    }),
    near: Math.max(options.minNear ?? 0.01, metrics.maxSpan / (options.nearDivisor ?? 100)),
    far: Math.max(options.minFar ?? 100, metrics.maxSpan * (options.farMultiplier ?? 20)),
  };
}
