import { MarkdownRenderChild, type App, type MarkdownPostProcessor } from "obsidian";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { isSupportedModelExtension } from "../../io/formats/registry";
import { resolveVaultPath } from "../../utils/resolve-path";
import { createImageEmbedWidget } from "./lazy-live-preview";
import { parseModelEmbedSize } from "./model-embed-syntax";
import type { NotePartsAccess } from "./note-parts-config";

/** Render normal wikilink embeds in their original paragraph/list/table context. */
export function createReadingImageEmbedProcessor(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
  partsAccess?: NotePartsAccess,
): MarkdownPostProcessor {
  return (root, context) => {
    const embeds = Array.from(root.querySelectorAll<HTMLElement>(".internal-embed[src]"));
    if (root.matches(".internal-embed[src]")) embeds.unshift(root);
    for (const embed of embeds) {
      if (embed.closest(".ai3d-image-embed, pre, code")) continue;
      const rawPath = embed.getAttribute("src") ?? "";
      if (!isSupportedModelExtension(rawPath.split(".").pop()?.toLowerCase() ?? "")) continue;
      const modelPath = resolveVaultPath(app, rawPath, context.sourcePath);
      if (!modelPath) continue;
      const width = embed.getAttribute("width");
      const height = embed.getAttribute("height");
      const size = parseModelEmbedSize(width ? `${width}${height ? `x${height}` : ""}` : embed.getAttribute("alt") ?? "");
      const widget = createImageEmbedWidget(app, getSettings(), convertedAssetCache, modelPath, size, getAnnotations, getSettings, partsAccess);
      const container = widget.toDOM();
      container.classList.remove("ai3d-cm-widget");
      container.dataset.ai3dModelPath = modelPath;
      const child = new MarkdownRenderChild(container);
      child.register(() => widget.destroy());
      embed.replaceWith(container);
      context.addChild(child);
    }
  };
}
