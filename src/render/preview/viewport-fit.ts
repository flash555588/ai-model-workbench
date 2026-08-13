/**
 * Viewport-aspect arithmetic shared by the preview backends.
 *
 * Both the perspective and orthographic paths previously derived their framing
 * from the vertical axis alone. That is only correct while the viewport is wider
 * than it is tall: below an aspect of 1 the horizontal field of view is the
 * narrower one, so a vertical-only fit clips the model left and right. Obsidian
 * panes are routinely dragged into tall, narrow shapes, so this is a common case
 * rather than an edge case.
 *
 * These helpers are pure so they can be unit-tested without a WebGL context,
 * which `scene.ts` requires.
 */

/** Smallest viewport aspect treated as usable; guards divide-by-zero on collapsed panes. */
const MIN_USABLE_ASPECT = 0.0001;

/** Fractional aspect change that justifies recomputing a camera fit. */
export const ASPECT_REFIT_EPSILON = 0.02;

/** Breathing room used by perspective and orthographic default framing. */
export const DEFAULT_VIEWPORT_FIT_MARGIN = 1.12;

export function normalizeViewportAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return Math.max(aspect, MIN_USABLE_ASPECT);
}

/**
 * Horizontal field of view implied by a vertical FOV and viewport aspect.
 * Both angles are in radians.
 */
export function horizontalFovFromVertical(verticalFov: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(verticalFov / 2) * normalizeViewportAspect(aspect));
}

/**
 * The narrower of the two frustum angles, in radians. This is the one that decides
 * whether a model fits, so it is the one a camera fit must respect.
 */
export function limitingFov(verticalFovDegrees: number, aspect: number): number {
  const verticalFov = (Math.max(verticalFovDegrees, Number.EPSILON) * Math.PI) / 180;
  return Math.min(verticalFov, horizontalFovFromVertical(verticalFov, aspect));
}

/**
 * Distance at which a bounding sphere of `radius` is fully contained by the
 * frustum. Uses `sin` (not `tan`) because the sphere is tangent to the frustum
 * walls rather than inscribed in the view plane.
 */
export function fitDistanceForBoundingSphere(
  radius: number,
  verticalFovDegrees: number,
  aspect: number,
): number {
  const safeRadius = Math.max(radius, Number.EPSILON);
  const fov = limitingFov(verticalFovDegrees, aspect);
  return safeRadius / Math.max(Math.sin(fov / 2), Number.EPSILON);
}

export interface OrthographicHalfExtents {
  halfWidth: number;
  halfHeight: number;
}

/**
 * Orthographic half-extents that keep `viewSpan` visible on both axes.
 *
 * On a portrait viewport the height is expanded so the width still covers the
 * span; on a landscape viewport the height carries the span directly.
 */
export function computeOrthographicHalfExtents(
  viewSpan: number,
  aspect: number,
): OrthographicHalfExtents {
  const safeAspect = normalizeViewportAspect(aspect);
  const halfHeight = Math.max(viewSpan, Number.EPSILON) / 2 / Math.min(1, safeAspect);
  return { halfWidth: halfHeight * safeAspect, halfHeight };
}

/** Whether an aspect change is large enough to warrant recomputing a fit. */
export function shouldRefitForAspect(previousAspect: number, nextAspect: number): boolean {
  if (!Number.isFinite(nextAspect) || nextAspect <= 0) return false;
  if (!Number.isFinite(previousAspect) || previousAspect <= 0) return true;
  return Math.abs(nextAspect - previousAspect) / previousAspect >= ASPECT_REFIT_EPSILON;
}
