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

const DEFAULT_RENDERER_ROLLOUT: PreviewRendererRollout = "babylon-safe";

/** Formats that the Three.js renderer can load directly. */
const THREE_FORMATS = new Set(["glb", "gltf", "stl", "ply", "obj"]);
const THREE_WORKBENCH_FORMATS = new Set(["glb", "gltf"]);

function resolveRendererRollout(value: PreviewFactoryOptions["rendererRollout"]): PreviewRendererRollout {
  return value ?? DEFAULT_RENDERER_ROLLOUT;
}

export function resolvePreviewRoute(options: PreviewFactoryOptions): PreviewRouteDecision {
  const ext = options.ext.trim().toLowerCase();
  const annotationMode = options.annotationMode ?? "none";
  const allowEditModeOnThree = !!options.allowEditModeOnThree;
  const allowWorkbenchFeaturesOnThree = !!options.allowWorkbenchFeaturesOnThree;
  const requireWorkbenchFeatures = !!options.requireWorkbenchFeatures;
  const rendererRollout = resolveRendererRollout(options.rendererRollout);
  const useThree = options.useThreeRenderer !== false; // default true

  // If useThreeRenderer is false, force Babylon.js for all formats
  if (!useThree) {
    return {
      backend: "babylon",
      ext,
      annotationMode,
      requireWorkbenchFeatures,
      rendererRollout,
      reason: "useThreeRenderer=false",
    };
  }

  if (THREE_FORMATS.has(ext) && (!requireWorkbenchFeatures || allowWorkbenchFeaturesOnThree)) {
    if (requireWorkbenchFeatures && !THREE_WORKBENCH_FORMATS.has(ext)) {
      return {
        backend: "babylon",
        ext,
        annotationMode,
        requireWorkbenchFeatures,
        rendererRollout,
        reason: `workbench experimental Three supports GLB/GLTF only, ext=${ext}`,
      };
    }

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

    const reason = requireWorkbenchFeatures
      ? `${ext} workbench preview`
      : annotationMode === "edit"
        ? `${ext} direct view edit preview`
        : annotationMode === "readonly"
          ? `${ext} preview with readonly annotations`
          : `simple ${ext} preview`;

    return {
      backend: "three",
      ext,
      annotationMode,
      requireWorkbenchFeatures,
      rendererRollout,
      reason,
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
