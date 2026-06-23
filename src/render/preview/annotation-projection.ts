import type { AnnotationViewportProvider, PreviewProjectionResult } from "./types";

export interface AnnotationCameraStateSegment {
  value: number;
  digits: number;
}

export interface AnnotationProjectionVector {
  x: number;
  y: number;
  z: number;
}

export interface AnnotationViewportProviderOptions {
  canvas: HTMLCanvasElement;
  observeRender: AnnotationViewportProvider["observeRender"];
  getCameraStateKey: AnnotationViewportProvider["getCameraStateKey"];
  projectWorldPoint: AnnotationViewportProvider["projectWorldPoint"];
  isWorldPointOccluded: AnnotationViewportProvider["isWorldPointOccluded"];
}

export function createAnnotationViewportProvider(
  options: AnnotationViewportProviderOptions,
): AnnotationViewportProvider {
  return {
    canvas: options.canvas,
    observeRender: options.observeRender,
    getCameraStateKey: options.getCameraStateKey,
    projectWorldPoint: options.projectWorldPoint,
    isWorldPointOccluded: options.isWorldPointOccluded,
  };
}

export function formatAnnotationCameraStateKey(
  segments: readonly AnnotationCameraStateSegment[],
): string {
  return segments
    .map((segment) => segment.value.toFixed(segment.digits))
    .join("_");
}

export function isFiniteAnnotationProjection(
  projection: AnnotationProjectionVector,
): boolean {
  return Number.isFinite(projection.x)
    && Number.isFinite(projection.y)
    && Number.isFinite(projection.z);
}

export function projectNormalizedDevicePointToCanvas(
  projection: AnnotationProjectionVector,
  canvas: Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">,
  result: PreviewProjectionResult,
): boolean {
  if (!isFiniteAnnotationProjection(projection)
    || canvas.clientWidth === 0
    || canvas.clientHeight === 0) {
    return false;
  }

  result.screenX = ((projection.x + 1) / 2) * canvas.clientWidth;
  result.screenY = ((1 - projection.y) / 2) * canvas.clientHeight;
  result.depth = (projection.z + 1) / 2;
  return true;
}

export function projectViewportPointToCanvas(
  projection: AnnotationProjectionVector,
  renderWidth: number,
  renderHeight: number,
  canvas: Pick<HTMLCanvasElement, "clientWidth" | "clientHeight">,
  result: PreviewProjectionResult,
): boolean {
  if (!isFiniteAnnotationProjection(projection)
    || renderWidth === 0
    || renderHeight === 0
    || canvas.clientWidth === 0
    || canvas.clientHeight === 0) {
    return false;
  }

  result.screenX = projection.x * (canvas.clientWidth / renderWidth);
  result.screenY = projection.y * (canvas.clientHeight / renderHeight);
  result.depth = projection.z;
  return true;
}
