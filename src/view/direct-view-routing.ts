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
  return source.strategy === "direct"
    && THREE_DIRECT_VIEW_FORMATS.has(source.ext)
    && THREE_DIRECT_VIEW_FORMATS.has(source.sourceExt);
}

export function createDirectViewPreviewOptions(
  settings: PluginSettings,
  source: PreviewSource,
): DirectViewPreviewOptions {
  const allowWorkbenchFeaturesOnThree = canUseExperimentalThreeWorkbench(settings, source);
  return {
    ext: source.ext,
    annotationMode: "edit",
    allowEditModeOnThree: true,
    allowWorkbenchFeaturesOnThree,
    requireWorkbenchFeatures: allowWorkbenchFeaturesOnThree || !canUseThreeDirectFileView(source),
    rendererRollout: settings.previewRendererRollout,
    useThreeRenderer: settings.useThreeRenderer,
  };
}
