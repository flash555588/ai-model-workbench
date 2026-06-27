import type { App, MarkdownPostProcessorContext } from "obsidian";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";

type CodeBlockModule = typeof import("./code-block");
type CodeBlockHandler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<unknown> | void;

let modulePromise: Promise<CodeBlockModule> | null = null;
const CODE_BLOCK_LAZY_ROOT_MARGIN = "240px";

function loadCodeBlockModule(): Promise<CodeBlockModule> {
  modulePromise ??= import("./code-block");
  return modulePromise;
}

function createLazyCodeBlockHandler(getHandler: () => Promise<CodeBlockHandler>): CodeBlockHandler {
  return (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const placeholder = activeDocument.createElement("div");
    placeholder.className = "ai3d-preview-host ai3d-code-block-lazy";
    placeholder.setAttribute("aria-busy", "true");
    el.appendChild(placeholder);

    const load = async () => {
      if (!placeholder.isConnected) {
        return;
      }
      try {
        const handler = await getHandler();
        if (!placeholder.isConnected) {
          return;
        }
        placeholder.remove();
        await handler(source, el, ctx);
      } catch (error) {
        console.warn("[AI3D] Failed to load inline code block runtime:", error);
        const errorEl = placeholder.isConnected ? placeholder : activeDocument.createElement("div");
        if (!placeholder.isConnected) {
          el.appendChild(errorEl);
        }
        errorEl.classList.remove("ai3d-preview-host");
        errorEl.classList.add("ai3d-inline-empty");
        errorEl.removeAttribute("aria-busy");
        errorEl.textContent = "AI3D inline preview failed to load.";
      }
    };

    if (typeof IntersectionObserver === "undefined") {
      void load();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        return;
      }
      observer.disconnect();
      void load();
    }, { rootMargin: CODE_BLOCK_LAZY_ROOT_MARGIN });
    observer.observe(placeholder);
  };
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
    handler: createLazyCodeBlockHandler(getHandler),
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
    handler: createLazyCodeBlockHandler(getHandler),
  };
}
