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
  const modelSpan = Math.max(metrics.maxSpan, metrics.radius, Number.EPSILON);
  const distance = modelSpan * (options.distanceMultiplier ?? 1.8);
  const near = Math.max(options.minNear ?? Math.max(modelSpan / 10000, 0.00001), modelSpan / (options.nearDivisor ?? 1000));
  const far = Math.max(options.minFar ?? Math.max(modelSpan * (options.farMultiplier ?? 20), 1), distance + metrics.radius * 4);
  return {
    target: clonePreviewWorldPoint(metrics.center),
    position: addPreviewWorldPoints(metrics.center, {
      x: distance,
      y: distance * (options.elevationFactor ?? 0.65),
      z: distance,
    }),
    near,
    far,
  };
}
