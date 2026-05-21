import type { Logger } from "../../utils/log";
import { createModelPreview } from "./factory";
import { createGridRenderer, type PreviewGridRenderer } from "./grid";
import {
  resolveGridRoute,
  resolvePreviewRoute,
  type GridRouteDecision,
  type PreviewRouteDecision,
} from "./routing";
import type { ModelPreview, PreviewFactoryOptions } from "./types";

export interface PreviewSelectionLogContext {
  surface: string;
  modelPath?: string;
  path?: string;
}

export interface GridSelectionLogContext {
  surface: string;
  preset?: string;
  modelCount?: number;
}

export interface CreatedModelPreview<T extends ModelPreview = ModelPreview> {
  preview: T;
  route: PreviewRouteDecision;
}

export interface CreatedGridRenderer {
  renderer: PreviewGridRenderer;
  route: GridRouteDecision;
}

export function logModelPreviewSelection(
  logger: Logger,
  context: PreviewSelectionLogContext,
  route: PreviewRouteDecision,
): void {
  logger.info("select preview backend", {
    ...context,
    backend: route.backend,
    reason: route.reason,
    ext: route.ext,
    annotationMode: route.annotationMode,
    requireWorkbenchFeatures: route.requireWorkbenchFeatures,
    rendererRollout: route.rendererRollout,
  });
}

export async function createLoggedModelPreview<T extends ModelPreview = ModelPreview>(
  logger: Logger,
  context: PreviewSelectionLogContext,
  canvas: HTMLCanvasElement,
  options: PreviewFactoryOptions,
): Promise<CreatedModelPreview<T>> {
  const route = resolvePreviewRoute(options);
  logModelPreviewSelection(logger, context, route);
  const preview = await createModelPreview(canvas, options) as T;
  return { preview, route };
}

export function logGridPreviewSelection(
  logger: Logger,
  context: GridSelectionLogContext,
  route: GridRouteDecision,
): void {
  logger.info("select preview backend", {
    ...context,
    backend: route.backend,
    reason: route.reason,
  });
}

export async function createLoggedGridRenderer(
  logger: Logger,
  context: GridSelectionLogContext,
  canvas: HTMLCanvasElement,
): Promise<CreatedGridRenderer> {
  const route = resolveGridRoute();
  logGridPreviewSelection(logger, context, route);
  const renderer = await createGridRenderer(canvas);
  return { renderer, route };
}
