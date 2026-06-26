import type { App, MarkdownPostProcessorContext } from "obsidian";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";

type CodeBlockModule = typeof import("./code-block");
type CodeBlockHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void;

let modulePromise: Promise<CodeBlockModule> | null = null;

function loadCodeBlockModule(): Promise<CodeBlockModule> {
  modulePromise ??= import("./code-block");
  return modulePromise;
}

export function registerLazyCodeBlockProcessor(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
) {
  let handlerPromise: Promise<CodeBlockHandler> | null = null;
  const getHandler = async () => {
    handlerPromise ??= loadCodeBlockModule().then((module) => (
      module.registerCodeBlockProcessor(app, getSettings, convertedAssetCache, getAnnotations).handler
    ));
    return handlerPromise;
  };

  return {
    id: "3d",
    handler: async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const handler = await getHandler();
      return handler(source, el, ctx);
    },
  };
}

export function registerLazyGridCodeBlockProcessor(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
) {
  let handlerPromise: Promise<CodeBlockHandler> | null = null;
  const getHandler = async () => {
    handlerPromise ??= loadCodeBlockModule().then((module) => (
      module.registerGridCodeBlockProcessor(app, getSettings, convertedAssetCache).handler
    ));
    return handlerPromise;
  };

  return {
    id: "3dgrid",
    handler: async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const handler = await getHandler();
      return handler(source, el, ctx);
    },
  };
}
