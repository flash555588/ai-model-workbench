import type { AnnotationPreview, ModelPreview, PreviewFactoryOptions, WorkbenchPreview } from "./types";
import { resolvePreviewRoute } from "./routing";

export async function createModelPreview(
  canvas: HTMLCanvasElement,
  options: PreviewFactoryOptions & { requireWorkbenchFeatures: true },
): Promise<WorkbenchPreview>;
export async function createModelPreview(
  canvas: HTMLCanvasElement,
  options: PreviewFactoryOptions & { annotationMode: "readonly" | "edit" },
): Promise<AnnotationPreview>;
export async function createModelPreview(
  canvas: HTMLCanvasElement,
  options: PreviewFactoryOptions,
): Promise<ModelPreview>;
export async function createModelPreview(
  canvas: HTMLCanvasElement,
  options: PreviewFactoryOptions,
): Promise<ModelPreview> {
  const route = resolvePreviewRoute(options);
  if (route.backend === "three") {
    const { createThreeModelPreview } = await import("../three/scene");
    return createThreeModelPreview(canvas);
  }

  const { createBabylonModelPreview } = await import("../babylon/scene");
  return createBabylonModelPreview(canvas);
}
