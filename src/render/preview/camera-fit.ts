import { getPreviewBoundsMetrics, type PreviewBounds } from "./bounds";
import { addPreviewWorldPoints, clonePreviewWorldPoint } from "./geometry";
import {
  DEFAULT_VIEWPORT_FIT_MARGIN,
  fitDistanceForBoundingSphere,
} from "./viewport-fit";
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
  /**
   * Viewport aspect ratio (width / height). When supplied, the camera is pulled
   * back far enough that the model's bounding sphere fits the *limiting* field of
   * view rather than a fixed multiple of the model span.
   *
   * Omit it to keep the legacy span-based framing.
   */
  aspect?: number;
  /** Vertical field of view in degrees. Only consulted alongside `aspect`. */
  fovDegrees?: number;
  /** Extra breathing room around the fitted sphere. Only consulted alongside `aspect`. */
  fitMargin?: number;
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

/**
 * Frame a model for a perspective camera.
 *
 * Pass `aspect` to fit the model's bounding sphere against the viewport's
 * *limiting* field of view — on a pane narrower than it is tall the horizontal FOV
 * is the tighter one, and framing on the vertical axis alone clips the model left
 * and right. Omitting `aspect` keeps the legacy span-based framing.
 */
export function createPreviewPerspectiveCameraFit(
  bounds: PreviewBounds,
  options: PreviewPerspectiveCameraFitOptions = {},
): PreviewPerspectiveCameraFit {
  const metrics = getPreviewBoundsMetrics(bounds);
  const modelSpan = Math.max(metrics.maxSpan, metrics.radius, Number.EPSILON);
  const distance = options.aspect !== undefined
    ? fitDistanceForBoundingSphere(
      metrics.radius,
      options.fovDegrees ?? 45,
      options.aspect,
    ) * (options.fitMargin ?? DEFAULT_VIEWPORT_FIT_MARGIN)
    : modelSpan * (options.distanceMultiplier ?? 1.8);
  const near = Math.max(options.minNear ?? Math.max(modelSpan / 10000, 0.00001), modelSpan / (options.nearDivisor ?? 1000));
  const far = Math.max(options.minFar ?? Math.max(modelSpan * (options.farMultiplier ?? 20), 1), distance + metrics.radius * 4);
  // Spread the fitted distance across the three view-direction components so the
  // camera keeps its isometric-ish angle instead of stretching along one axis.
  const elevationFactor = options.elevationFactor ?? 0.65;
  const directionLength = Math.sqrt(1 + elevationFactor * elevationFactor + 1);
  const componentScale = options.aspect !== undefined ? distance / directionLength : distance;
  return {
    target: clonePreviewWorldPoint(metrics.center),
    position: addPreviewWorldPoints(metrics.center, {
      x: componentScale,
      y: componentScale * elevationFactor,
      z: componentScale,
    }),
    near,
    far,
  };
}
