import type { App, MarkdownPostProcessorContext } from "obsidian";
import { isDisabledSplatExtension, isSupportedModelExtension, listSupportedModelExtensions } from "../../io/formats/registry";
import type { PluginSettings, AnnotationPin } from "../../domain/models";
import { AnnotationManager } from "../../render/preview/annotations";
import type { PreviewGridRenderer } from "../../render/preview/grid";
import { createLoggedGridRenderer, createLoggedModelPreview } from "../../render/preview/selection";
import type { ModelPreview } from "../../render/preview/types";
import { supportsAnnotationPreview } from "../../render/preview/types";
import { readBinaryPath, resolveVaultAbsolutePath, resolveVaultPath } from "../../utils/resolve-path";
import { getPreset, composeSections } from "../../render/presets";
import { createHelperButtons, type HelperToolbar } from "./helper-buttons";
import type { ThreeDBlockConfig, ModelConfig, GridBlockConfig, ComposeSection } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { prepareModelInput } from "../../io/model-pipeline";
import { toPreviewSource } from "../../io/preview/preview-source";
import { listPreferredConversionExts } from "../../io/formats/route-preferences";
import { createLoadingOverlay } from "./loading-overlay";
import { createNoteReader } from "../../utils/note-reader";
import { describeModelLoadFailure, isMissingConverterError } from "../../io/conversion/errors";
import { formatT, t } from "../../i18n";
import { renderModelLoadFailure, renderModelPerformanceFeedback } from "../model-load-feedback";
import { isMobile } from "../../utils/device";
import { createLogger } from "../../utils/log";
import {
  attachGridPreviewCanvasShortcuts,
  attachModelPreviewCanvasShortcuts,
  configureGridPreviewCanvas,
  configureModelPreviewCanvas,
} from "./preview-canvas-accessibility";

const log = createLogger("inline-code-block");
const CONVERSION_OUTPUT_ROOT = ".obsidian/ai-model-workbench/converted-assets";

async function createInlineConversionManager(settings: PluginSettings) {
  const { createConversionManager } = await import("../../io/conversion/factory");
  return createConversionManager(settings);
}

interface PreparedInlineModel {
  sourcePath: string;
  effectivePath: string;
  effectiveExt: string;
  model: ModelConfig;
  warnings: string[];
}

async function prepareInlineModel(
  app: App,
  entry: string | ModelConfig,
  settings: PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
): Promise<PreparedInlineModel> {
  const inputModel = typeof entry === "string" ? { path: entry } : entry;
  const sourcePath = resolveVaultPath(app, inputModel.path);
  if (!sourcePath) {
    throw new Error(formatT("workbench.fileNotFound", { path: inputModel.path }));
  }

  const sourceExt = sourcePath.split(".").pop()?.toLowerCase() ?? "";
  if (!isSupportedModelExtension(sourceExt)) {
    if (isDisabledSplatExtension(sourceExt)) {
      throw new Error(t("codeBlock.splatDisabled"));
    }
    throw new Error(formatT("codeBlock.unsupportedFormat", {
      ext: `.${sourceExt}`,
      formats: listSupportedModelExtensions().join(", "),
    }));
  }

  const absolutePath = resolveVaultAbsolutePath(app, sourcePath) ?? undefined;
  const conversionOutputRoot = resolveVaultAbsolutePath(app, CONVERSION_OUTPUT_ROOT) ?? undefined;
  const prepared = await prepareModelInput({
    path: sourcePath,
    absolutePath,
    preferConversionExts: listPreferredConversionExts(settings),
    conversionManager: () => createInlineConversionManager(settings),
    convertedAssetCache,
    conversionOutputRoot,
  });
  const source = toPreviewSource(prepared);

  return {
    sourcePath,
    effectivePath: source.path,
    effectiveExt: source.ext,
    warnings: source.warnings,
    model: {
      ...inputModel,
      path: source.path,
    },
  };
}

async function prepareInlineSection(
  app: App,
  section: ComposeSection,
  settings: PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
): Promise<ComposeSection> {
  const models: ModelConfig[] = [];
  for (const entry of section.models) {
    const prepared = await prepareInlineModel(app, entry, settings, convertedAssetCache);
    models.push(prepared.model);
  }

  return {
    ...section,
    models,
  };
}

function appendMobileInlineHint(parent: HTMLElement): void {
  if (!isMobile()) return;
  parent.createDiv({ cls: "ai3d-mobile-mode-hint ai3d-mobile-mode-hint--inline", text: t("codeBlock.mobileHint") });
}

/**
 * Register the ```3d code block processor.
 *
 * Supports two formats:
 *
 * Simple:    ```3d path/to/model.glb```
 * JSON:      ```3d
 *            { "models": [{ "path": "model.glb" }], "scene": { "autoRotate": true } }
 *            ```
 */
export function registerCodeBlockProcessor(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
) {
  return {
    id: "3d",
    handler: (
      source: string,
      el: HTMLElement,
      _ctx: MarkdownPostProcessorContext,
    ) => {
      const trimmed = source.trim();
      if (!trimmed) {
        el.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.noModelPathOrConfig") });
        return;
      }

      // Determine format: JSON object or simple path
      let config: ThreeDBlockConfig;
      const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");

      if (isJson) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          config = normalizeConfig(parsed);
        } catch (err) {
          const errorEl = el.createDiv({ cls: "ai3d-json-error" });
          const lineMatch = String(err).match(/position\s+(\d+)/);
          let errorMsg = formatT("codeBlock.jsonParseError", { error: String(err) });
          if (lineMatch) {
            const pos = parseInt(lineMatch[1], 10);
            const lines = trimmed.substring(0, pos).split("\n");
            errorMsg += formatT("codeBlock.jsonParseLine", { line: String(lines.length) });
          }
          errorEl.createEl("pre", { text: errorMsg });
          return;
        }
      } else {
        // Simple path format
        config = { models: [{ path: trimmed }] };
      }

      if (!config.models || config.models.length === 0) {
        el.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.noModelsInConfig") });
        return;
      }

      // Validate first model path (for now, single model inline preview)
      if (config.models.length > 1) {
        console.warn(`[AI3D] \`\`\`3d only supports one model; ${config.models.length - 1} additional models ignored. Use \`\`\`3dgrid for multi-model.`);
      }
      const modelCfg = config.models[0];
      const modelPath = resolveVaultPath(app,modelCfg.path);
      if (!modelPath) {
        el.createDiv({
          cls: "ai3d-inline-empty",
          text: formatT("workbench.fileNotFound", { path: modelCfg.path }),
        });
        return;
      }

      const ext = modelPath.split(".").pop()?.toLowerCase() ?? "";
      if (!isSupportedModelExtension(ext)) {
        el.createDiv({
          cls: "ai3d-inline-empty",
          text: isDisabledSplatExtension(ext) ? t("codeBlock.splatDisabled") : formatT("codeBlock.unsupportedFormat", {
            ext: `.${ext}`,
            formats: listSupportedModelExtensions().join(", "),
          }),
        });
        return;
      }

      // Create preview host with custom dimensions
      const settings = getSettings();
      const host = el.createDiv({ cls: "ai3d-preview-host" });
      if (config.height) {
        host.style.setProperty("--min-height", typeof config.height === "number" ? `${config.height}px` : config.height);
      }
      if (config.width) {
        host.style.setProperty("--max-width", typeof config.width === "number" ? `${config.width}px` : config.width);
      }

      const canvas = host.createEl("canvas", { cls: "ai3d-canvas-full" });
      configureModelPreviewCanvas(canvas, "inline", modelPath);
      host.appendChild(canvas);

      // Add helper buttons
      let preview: ModelPreview | null = null;
      let annotationMgr: AnnotationManager | null = null;
      let annotationVisible = true;
      let destroyed = false;
      let loaded = false;
      attachModelPreviewCanvasShortcuts(canvas, () => destroyed ? null : preview);

      const toolbar: HelperToolbar = createHelperButtons(el, host, app, () => preview, () => modelPath, () => {
        if (destroyed) return;
        destroyed = true;
        observer.disconnect();
        io.disconnect();
        annotationMgr?.destroy();
        annotationMgr = null;
        preview?.destroy();
        preview = null;
        host.remove();
      }, getSettings, () => {
        annotationVisible = !annotationVisible;
        if (annotationMgr) {
          const overlay = host.querySelector(".ai3d-annotation-overlay");
          if (overlay) overlay.classList.toggle("is-hidden", !annotationVisible);
        }
        return annotationVisible;
      }, undefined, {
        labelKey: "helper.toggleAnnotationsVisibilityLabel",
        activeTooltipKey: "helper.annotationsVisible",
        inactiveTooltipKey: "helper.annotationsHidden",
      });
      appendMobileInlineHint(el);

      // Auto-destroy when the DOM element is removed
      const observer = new MutationObserver(() => {
        if (destroyed) return;
        if (!el.contains(host)) {
          destroyed = true;
          observer.disconnect();
          io.disconnect();
          annotationMgr?.destroy();
          annotationMgr = null;
          preview?.destroy();
          preview = null;
        }
      });
      observer.observe(el, { childList: true });

      async function loadPreview() {
        if (loaded || destroyed || !modelPath) return;
        loaded = true;

        const loading = createLoadingOverlay(host);

        try {
          const absolutePath = resolveVaultAbsolutePath(app, modelPath) ?? undefined;
          const conversionOutputRoot = resolveVaultAbsolutePath(app, CONVERSION_OUTPUT_ROOT) ?? undefined;
          loading.setPhaseKey("loading.preparingModel");
          const prepared = await prepareModelInput({
            path: modelPath,
            absolutePath,
            preferConversionExts: listPreferredConversionExts(settings),
            conversionManager: () => createInlineConversionManager(settings),
            convertedAssetCache,
            conversionOutputRoot,
          });
          const source = toPreviewSource(prepared);
          const pins = getAnnotations?.(modelPath) ?? [];
          const previewOptions = {
            ext: source.ext,
            annotationMode: pins.length > 0 ? "readonly" : "none",
            rendererRollout: settings.previewRendererRollout,
            useThreeRenderer: settings.useThreeRenderer,
          } as const;
          const { preview: nextPreview } = await createLoggedModelPreview(
            log,
            { surface: "code-block", modelPath },
            canvas,
            previewOptions,
          );
          preview = nextPreview;
          toolbar.syncCapabilities();
          loading.setPhaseKey("loading.loadingModel");
          const data = await readBinaryPath(app, source.path);
          const readFile = async (p: string) => readBinaryPath(app, p);

          if (destroyed) { loading.hide(); return; }
          const summary = await preview.loadModel(data, source.ext, readFile, source.path);
          loading.setProgress(100);
          renderModelPerformanceFeedback(host, summary);

          if (destroyed) { loading.hide(); return; }
          if (config.scene?.autoRotate === undefined && settings.autoRotateDefault) {
            config.scene = { ...config.scene, autoRotate: true, autoRotateSpeed: settings.autoRotateSpeed };
          }
          preview.applyConfig(config);
          preview.setRenderQuality?.(settings.renderQuality, settings.renderScale);
          toolbar.syncCapabilities();

          // Readonly annotations
          if (pins.length > 0 && supportsAnnotationPreview(preview)) {
            const provider = preview.getAnnotationProvider();
            if (provider.canvas) {
              annotationMgr = new AnnotationManager(
                provider,
                host,
                "readonly",
                pins,
                undefined,
                createNoteReader(app),
                undefined,
                {
                  app,
                  previewMode: settings.annotationPreviewMode,
                  displayMode: settings.annotationDisplayMode,
                },
              );
              toolbar.showAnnotateButton();
              toolbar.updateAnnotationBadge(pins.length);
            }
          }

          if (ext === "stl" && modelCfg.color) {
            preview.setSTLColor?.(modelCfg.color);
          }
          if (ext === "stl" && modelCfg.wireframe !== undefined) {
            preview.setWireframe?.(modelCfg.wireframe);
          }

          if (preview.hasAnimations?.()) {
            toolbar.showAnimButton();
          }

          loading.hide();
        } catch (err) {
          destroyed = true;
          observer.disconnect();
          io.disconnect();
          loading.hide();
          preview?.destroy();
          preview = null;
          host.replaceChildren();
          const failure = describeModelLoadFailure(err);
          if (isMissingConverterError(err)) {
            console.warn("[AI3D] Inline preview blocked by converter settings:", failure.message);
          } else {
            console.error("[AI3D] Inline preview failed:", err);
          }
          renderModelLoadFailure(host, failure);
        }
      }

      // Lazy-load: only create Engine when scrolled into view
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            void loadPreview();
          }
        }
      }, { rootMargin: "200px" });
      io.observe(host);
    },
  };
}

/**
 * Normalize a raw parsed JSON object into ThreeDBlockConfig.
 * Handles both single-model shorthand and full config.
 */
function normalizeConfig(raw: unknown): ThreeDBlockConfig {
  // If it's a string, treat as simple path
  if (typeof raw === "string") {
    return { models: [{ path: raw }] };
  }

  if (typeof raw !== "object" || raw === null) {
    return { models: [] };
  }

  const obj = raw as Record<string, unknown>;

  // If it has a "path" property at top level, it's a single model config
  if (typeof obj.path === "string") {
    return {
      models: [{ path: obj.path, color: obj.color as string | undefined, wireframe: obj.wireframe as boolean | undefined }],
      camera: obj.camera as ThreeDBlockConfig["camera"],
      lights: obj.lights as ThreeDBlockConfig["lights"],
      scene: obj.scene as ThreeDBlockConfig["scene"],
      stl: obj.stl as ThreeDBlockConfig["stl"],
      width: obj.width as number | string | undefined,
      height: obj.height as number | string | undefined,
    };
  }

  // Full config with models array
  const models: ModelConfig[] = Array.isArray(obj.models)
    ? obj.models
        .filter((m: unknown) => {
          const p = typeof m === "string" ? m : m && typeof m === "object" && "path" in m ? (m as Record<string, unknown>).path : undefined;
          return typeof p === "string" && p.length > 0;
        })
        .map((m: unknown) => {
          if (typeof m === "string") return { path: m };
          const mo = m as Record<string, unknown>;
          return { path: mo.path as string, color: mo.color as string | undefined, wireframe: mo.wireframe as boolean | undefined };
        })
    : [];

  return {
    models,
    camera: obj.camera as ThreeDBlockConfig["camera"],
    lights: obj.lights as ThreeDBlockConfig["lights"],
    scene: obj.scene as ThreeDBlockConfig["scene"],
    stl: obj.stl as ThreeDBlockConfig["stl"],
    width: obj.width as number | string | undefined,
    height: obj.height as number | string | undefined,
  };
}

/**
 * Register the ```3dgrid code block processor.
 *
 * Renders multiple models in a single Babylon Scene using per-cell viewports.
 * One Engine / one WebGL context — no context limit risk.
 *
 * JSON config:
 * ```3dgrid
 * { "models": ["a.glb", "b.glb", "c.glb"], "columns": 3, "rowHeight": 300 }
 * ```
 */
export function registerGridCodeBlockProcessor(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
) {
  return {
    id: "3dgrid",
    handler: (
      source: string,
      el: HTMLElement,
      _ctx: MarkdownPostProcessorContext,
    ) => {
      const trimmed = source.trim();
      if (!trimmed) {
        el.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.noConfigSpecified") });
        return;
      }

      let config: GridBlockConfig;
      try {
        config = JSON.parse(trimmed) as GridBlockConfig;
      } catch (err) {
        const errorEl = el.createDiv({ cls: "ai3d-json-error" });
        errorEl.createEl("pre", { text: `JSON parse error: ${String(err)}` });
        return;
      }

      if (config.preset !== "compose" && (!config.models || config.models.length === 0)) {
        el.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.noModelsSpecified") });
        return;
      }

      const settings = getSettings();
      const gridLoading = createLoadingOverlay(el);

      void (async () => {
      const preparedModels: PreparedInlineModel[] = [];
      for (const entry of config.models ?? []) {
        try {
          const prepared = await prepareInlineModel(app, entry, settings, convertedAssetCache);
          preparedModels.push(prepared);
        } catch (err) {
          gridLoading.hide();
          el.createDiv({
            cls: "ai3d-inline-empty",
            text: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }
      const resolved: ModelConfig[] = preparedModels.map((item) => item.model);
      let helperSourcePath = preparedModels[0]?.sourcePath ?? "";

      // Create grid container
      const gridHost = el.createDiv({ cls: "ai3d-grid-host" });
      const canvas = gridHost.createEl("canvas");
      configureGridPreviewCanvas(canvas);
      gridHost.appendChild(canvas);

      // Height controlled by CSS max-height only; rowHeight sets inline height (capped by CSS max-height)
      if (typeof config.rowHeight === "number") {
        const rows = config.preset === "compose" ? 1 : Math.ceil(resolved.length / (config.columns ?? Math.min(resolved.length, 3)));
        gridHost.style.setProperty("--grid-height", `${config.rowHeight * rows}px`);
      }

      let renderer: PreviewGridRenderer | null = null;
      let destroyed = false;
      let loaded = false;
      attachGridPreviewCanvasShortcuts(canvas, () => destroyed ? null : renderer);

      const gridToolbar: HelperToolbar = createHelperButtons(el, gridHost, app, () => renderer, () => helperSourcePath, () => {
        if (destroyed) return;
        destroyed = true;
        observer.disconnect();
        gridIo.disconnect();
        renderer?.destroy();
        renderer = null;
        gridHost.remove();
      }, getSettings);
      appendMobileInlineHint(el);

      const observer = new MutationObserver(() => {
        if (destroyed) return;
        if (!el.contains(gridHost)) {
          destroyed = true;
          observer.disconnect();
          gridIo.disconnect();
          renderer?.destroy();
          renderer = null;
        }
      });
      observer.observe(el, { childList: true });

      async function loadGrid() {
        if (loaded || destroyed) return;
        loaded = true;
        gridLoading.setPhaseKey("codeBlock.renderingGrid");
        gridLoading.setProgress(-1);

        try {
          const { renderer: nextRenderer } = await createLoggedGridRenderer(
            log,
            {
              surface: "3dgrid",
              preset: config.preset ?? "compare",
              modelCount: config.models?.length ?? 0,
            },
            canvas,
          );
          renderer = nextRenderer;
          gridToolbar.syncCapabilities();
          const activeRenderer = renderer;
          const readFile = async (path: string) => readBinaryPath(app, path);

          if (config.preset === "compose") {
            if (!config.sections || config.sections.length === 0) {
              gridLoading.hide();
              gridHost.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.composeRequiresSections") });
              renderer.destroy();
              renderer = null;
              return;
            }
            const preparedSections: ComposeSection[] = [];
            for (const section of config.sections) {
              try {
                if (!helperSourcePath) {
                  const firstEntry = section.models[0];
                  if (firstEntry) {
                    const rawPath = typeof firstEntry === "string" ? firstEntry : firstEntry.path;
                    helperSourcePath = resolveVaultPath(app, rawPath) ?? rawPath;
                  }
                }
                const preparedSection = await prepareInlineSection(app, section, settings, convertedAssetCache);
                preparedSections.push(preparedSection);
              } catch (err) {
                gridLoading.hide();
                gridHost.createDiv({
                  cls: "ai3d-inline-empty",
                  text: err instanceof Error ? err.message : String(err),
                });
                activeRenderer.destroy();
                renderer = null;
                return;
              }
            }
            const result = composeSections(
              preparedSections,
              config.direction ?? "horizontal",
              Number(config.params?.gap) || 0.02,
              (entry) => {
                if (typeof entry === "string") return null;
                return entry;
              },
              getPreset,
            );
            if (!result) {
              gridLoading.hide();
              gridHost.createDiv({ cls: "ai3d-inline-empty", text: t("codeBlock.composeNoValidSections") });
              activeRenderer.destroy();
              renderer = null;
              return;
            }
            await activeRenderer.loadWithPreset(result, readFile);
          } else if (config.preset) {
            const preset = getPreset(config.preset);
            if (!preset) {
              gridLoading.hide();
              gridHost.createDiv({
                cls: "ai3d-inline-empty",
                text: formatT("codeBlock.unknownPreset", { preset: config.preset }),
              });
              activeRenderer.destroy();
              renderer = null;
              return;
            }
            const result = preset.compute(resolved, config.params ?? {});
            if (!result) {
              gridLoading.hide();
              gridHost.createDiv({
                cls: "ai3d-inline-empty",
                text: formatT("codeBlock.presetRequiresModels", {
                  preset: config.preset,
                  min: String(preset.minModels),
                  max: String(preset.maxModels),
                  count: String(resolved.length),
                }),
              });
              activeRenderer.destroy();
              renderer = null;
              return;
            }
            await activeRenderer.loadWithPreset(result, readFile);
          } else {
            await activeRenderer.loadModels(resolved, config, readFile);
          }

          if (destroyed) { gridLoading.hide(); return; }
          gridLoading.hide();
        } catch (err) {
          destroyed = true;
          observer.disconnect();
          gridIo.disconnect();
          gridLoading.hide();
          renderer?.destroy();
          renderer = null;
          console.error("[AI3D Grid] Failed:", err);
          gridHost.createDiv({ cls: "ai3d-inline-empty", text: formatT("codeBlock.gridFailed", { reason: String(err) }) });
        }
      }

      // Lazy-load: only create Engine when scrolled into view
      const gridIo = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            gridIo.disconnect();
            void loadGrid();
          }
        }
      }, { rootMargin: "200px" });
      gridIo.observe(gridHost);
      })(); // end async IIFE
    },
  };
}
