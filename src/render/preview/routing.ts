import type { PreviewRendererRollout } from "../../domain/models";
import type { PreviewAnnotationMode, PreviewFactoryOptions } from "./types";

export type PreviewBackend = "three" | "babylon";

export interface PreviewRouteDecision {
  backend: PreviewBackend;
  ext: string;
  annotationMode: PreviewAnnotationMode;
  requireWorkbenchFeatures: boolean;
  rendererRollout: PreviewRendererRollout;
  reason: string;
}

export interface GridRouteDecision {
  backend: "babylon";
  reason: string;
}

const DEFAULT_RENDERER_ROLLOUT: PreviewRendererRollout = "three-direct-glb";

/** Formats that the Three.js renderer can load directly. */
const THREE_FORMATS = new Set(["glb", "gltf", "stl", "ply", "obj"]);

function resolveRendererRollout(value: PreviewFactoryOptions["rendererRollout"]): PreviewRendererRollout {
  return value ?? DEFAULT_RENDERER_ROLLOUT;
}

export function resolvePreviewRoute(options: PreviewFactoryOptions): PreviewRouteDecision {
  const ext = options.ext.trim().toLowerCase();
  const annotationMode = options.annotationMode ?? "none";
  const allowEditModeOnThree = !!options.allowEditModeOnThree;
  const requireWorkbenchFeatures = !!options.requireWorkbenchFeatures;
  const rendererRollout = resolveRendererRollout(options.rendererRollout);

  if (THREE_FORMATS.has(ext) && !requireWorkbenchFeatures) {
    if (annotationMode === "edit" && rendererRollout !== "three-direct-glb") {
      return {
        backend: "babylon",
        ext,
        annotationMode,
        requireWorkbenchFeatures,
        rendererRollout,
        reason: `annotationMode=edit, rendererRollout=${rendererRollout}`,
      };
    }

    if (rendererRollout === "babylon-safe") {
      return {
        backend: "babylon",
        ext,
        annotationMode,
        requireWorkbenchFeatures,
        rendererRollout,
        reason: `rendererRollout=${rendererRollout}`,
      };
    }

    if (annotationMode === "edit" && !allowEditModeOnThree) {
      return {
        backend: "babylon",
        ext,
        annotationMode,
        requireWorkbenchFeatures,
        rendererRollout,
        reason: "annotationMode=edit, allowEditModeOnThree=false",
      };
    }

    return {
      backend: "three",
      ext,
      annotationMode,
      requireWorkbenchFeatures,
      rendererRollout,
      reason: annotationMode === "edit"
        ? `${ext} direct view edit preview`
        : annotationMode === "readonly"
          ? `${ext} preview with readonly annotations`
          : `simple ${ext} preview`,
    };
  }

  const reasons: string[] = [];
  if (!THREE_FORMATS.has(ext)) reasons.push(`ext=${ext}`);
  if (annotationMode !== "none") reasons.push(`annotationMode=${annotationMode}`);
  if (annotationMode === "edit" && !allowEditModeOnThree) reasons.push("allowEditModeOnThree=false");
  if (requireWorkbenchFeatures) reasons.push("requireWorkbenchFeatures=true");
  if (rendererRollout !== DEFAULT_RENDERER_ROLLOUT) reasons.push(`rendererRollout=${rendererRollout}`);

  return {
    backend: "babylon",
    ext,
    annotationMode,
    requireWorkbenchFeatures,
    rendererRollout,
    reason: reasons.join(", ") || "fallback route",
  };
}

export function resolveGridRoute(): GridRouteDecision {
  return {
    backend: "babylon",
    reason: "grid previews remain on the Babylon grid renderer",
  };
}
