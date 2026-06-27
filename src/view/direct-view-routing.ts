import type { PluginSettings } from "../domain/models";
import type { PreviewSource } from "../io/preview/preview-source";
import type { PreviewFactoryOptions } from "../render/preview/types";

const THREE_DIRECT_VIEW_FORMATS = new Set(["glb", "gltf", "stl", "ply", "obj"]);
const THREE_WORKBENCH_DIRECT_EXTS = new Set(["glb", "gltf"]);

export type DirectViewPreviewOptions = PreviewFactoryOptions & {
  annotationMode: "edit";
  allowEditModeOnThree: true;
  allowWorkbenchFeaturesOnThree: boolean;
  requireWorkbenchFeatures: boolean;
  rendererRollout: PluginSettings["previewRendererRollout"];
  useThreeRenderer: boolean;
};

function canUseExperimentalThreeWorkbench(settings: PluginSettings, source: PreviewSource): boolean {
  return settings.experimentalThreeWorkbench
    && settings.useThreeRenderer
    && source.strategy === "direct"
    && THREE_WORKBENCH_DIRECT_EXTS.has(source.ext)
    && THREE_WORKBENCH_DIRECT_EXTS.has(source.sourceExt);
}

function canUseThreeDirectFileView(source: PreviewSource): boolean {
  if (!THREE_DIRECT_VIEW_FORMATS.has(source.ext)) {
    return false;
  }
  if (source.strategy === "direct") {
    return THREE_DIRECT_VIEW_FORMATS.has(source.sourceExt);
  }
  return source.strategy === "convert" && THREE_WORKBENCH_DIRECT_EXTS.has(source.ext);
}

function shouldUseFastConvertedDirectView(settings: PluginSettings, source: PreviewSource): boolean {
  return settings.useThreeForConvertedDirectView
    && source.strategy === "convert"
    && THREE_WORKBENCH_DIRECT_EXTS.has(source.ext);
}

export function createDirectViewPreviewOptions(
  settings: PluginSettings,
  source: PreviewSource,
): DirectViewPreviewOptions {
  const allowWorkbenchFeaturesOnThree = canUseExperimentalThreeWorkbench(settings, source);
  const useThreeDirectFileView = canUseThreeDirectFileView(source);
  const useFastConvertedDirectView = shouldUseFastConvertedDirectView(settings, source);
  return {
    ext: source.ext,
    annotationMode: "edit",
    allowEditModeOnThree: true,
    allowWorkbenchFeaturesOnThree,
    requireWorkbenchFeatures: allowWorkbenchFeaturesOnThree || !useThreeDirectFileView,
    rendererRollout: useFastConvertedDirectView ? "three-direct-glb" : settings.previewRendererRollout,
    useThreeRenderer: useFastConvertedDirectView ? true : settings.useThreeRenderer,
  };
}
