/**
 * CM6 ViewPlugin for Live Preview embed rendering.
 * Replaces `![[model.glb]]` syntax with inline 3D preview widgets.
 */

import type { App } from "obsidian";
import { WidgetType } from "@codemirror/view";
import { isThreeDirectRoute } from "../../render/preview/routing";
import type { PluginSettings, AnnotationPin } from "../../domain/models";
import type { AnnotationManager } from "../../render/preview/annotations";
import type { ModelPreview } from "../../render/preview/types";
import { readBinaryPath, resolveVaultAbsolutePath } from "../../utils/resolve-path";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { resolveConversionOutputRoot } from "../../io/conversion/output-root";
import { createLoadingOverlay, type LoadingOverlay } from "./loading-overlay";
import { createStagedDiv, createStagedEl } from "../../utils/dom";
import { isMobile } from "../../utils/device";
import { createLogger } from "../../utils/log";
import {
  attachModelPreviewCanvasShortcuts,
  configureModelPreviewCanvas,
} from "./preview-canvas-accessibility";
import { createHelperButtons, type HelperToolbar } from "./helper-buttons";
import { createNotePreviewHeader } from "./note-preview-header";
import { scheduleInlinePreviewLoad } from "./preview-load-scheduler";
import { getPreviewPathRenderBudget } from "../model-render-budget";
import { createImageEmbedControls } from "./image-embed-controls";
import type { NotePartsAccess } from "./note-parts-config";
import { createNoteRegisteredPartsControls, type NotePartsControls } from "./note-registered-parts";

const log = createLogger("inline-live-preview");

// ── Widget ────────────────────────────────────────────────────────

export class ModelEmbedWidget extends WidgetType {
  private preview: ModelPreview | null = null;
  private annotationMgr: AnnotationManager | null = null;
  private readyObs: ResizeObserver | null = null;
  private viewportObs: IntersectionObserver | null = null;
  private pollId = 0;
  private initStarted = false;
  private destroyed = false;
  private initGeneration = 0;
  private viewportReady = false;
  private helperToolbar: HelperToolbar | null = null;
  private imageControls: ReturnType<typeof createImageEmbedControls> | null = null;
  private modelReady = false;
  private partsControls: NotePartsControls | null = null;

  constructor(
    private app: App,
    private modelPath: string,
    private width: number,
    private height: number,
    private autoRotate: boolean,
    private enabledConverterIds: string[],
    private freecadCommand: string,
    private obj2gltfCommand: string,
    private fbx2gltfCommand: string,
    private freecadcmdCommand: string,
    private preferObj2gltfForObj: boolean,
    private preferFbx2gltfForFbx: boolean,
    private annotationPreviewMode: PluginSettings["annotationPreviewMode"],
    private annotationDisplayMode: PluginSettings["annotationDisplayMode"],
    private previewRendererRollout: PluginSettings["previewRendererRollout"],
    private useThreeRenderer: boolean,
    private auxiliaryFileFolder: string,
    private renderQuality: PluginSettings["renderQuality"],
    private renderScale: PluginSettings["renderScale"],
    private convertedAssetCache: ConvertedAssetCache,
    private getAnnotations?: (modelPath: string) => AnnotationPin[],
    private getToolbarSettings?: () => PluginSettings,
    private partsAccess?: NotePartsAccess,
  ) {
    super();
  }

  override eq(other: ModelEmbedWidget): boolean {
    return (
      this.modelPath === other.modelPath &&
      this.width === other.width &&
      this.height === other.height &&
      this.autoRotate === other.autoRotate &&
      this.enabledConverterIds.join("|") === other.enabledConverterIds.join("|") &&
      this.freecadCommand === other.freecadCommand &&
      this.obj2gltfCommand === other.obj2gltfCommand &&
      this.fbx2gltfCommand === other.fbx2gltfCommand &&
      this.freecadcmdCommand === other.freecadcmdCommand &&
      this.preferObj2gltfForObj === other.preferObj2gltfForObj &&
      this.preferFbx2gltfForFbx === other.preferFbx2gltfForFbx &&
      this.annotationPreviewMode === other.annotationPreviewMode &&
      this.annotationDisplayMode === other.annotationDisplayMode &&
      this.previewRendererRollout === other.previewRendererRollout &&
      this.useThreeRenderer === other.useThreeRenderer &&
      this.auxiliaryFileFolder === other.auxiliaryFileFolder &&
      this.renderQuality === other.renderQuality &&
      this.renderScale === other.renderScale &&
      this.convertedAssetCache === other.convertedAssetCache
    );
  }

  override toDOM(): HTMLElement {
    const mobile = isMobile();
    const frame = createStagedDiv("ai3d-embed-preview ai3d-note-preview ai3d-cm-widget");
    frame.setAttribute("contenteditable", "false");
    createNotePreviewHeader(frame, this.modelPath);
    const host = frame.createDiv({ cls: "ai3d-preview-host" });
    if (mobile) {
      frame.classList.add("is-mobile");
    }

    const canvas = createStagedEl("canvas", "ai3d-embed-canvas");
    const effectiveHeight = mobile ? Math.min(this.height, 220) : this.height;
    canvas.style.setProperty("--ai3d-embed-height", `${effectiveHeight}px`);
    host.appendChild(canvas);
    configureModelPreviewCanvas(canvas, "live-preview", this.modelPath);
    attachModelPreviewCanvasShortcuts(canvas, () => this.destroyed || !this.modelReady ? null : this.preview);
    let annotationsVisible = true;
    this.helperToolbar = createHelperButtons(frame, host, this.app,
      () => this.destroyed || !this.modelReady ? null : this.preview, () => this.modelPath, null,
      () => this.getToolbarSettings?.() ?? { renderScale: this.renderScale, snapshotFolder: "Media/3D Previews", snapshotNaming: "model-name" },
      () => {
        annotationsVisible = !annotationsVisible;
        host.querySelector(".ai3d-annotation-overlay")?.classList.toggle("is-hidden", !annotationsVisible);
        return annotationsVisible;
      }, undefined, {
        kind: "visibility",
        labelKey: "helper.toggleAnnotationsVisibilityLabel",
        activeTooltipKey: "helper.annotationsVisible",
        inactiveTooltipKey: "helper.annotationsHidden",
      });

    this.imageControls = createImageEmbedControls(this.app, frame, canvas,
      () => this.destroyed || !this.modelReady ? null : this.preview,
      () => this.helperToolbar?.exitInteractionMode(),
      () => this.helperToolbar?.handleEscape() ?? false,
      () => this.helperToolbar?.syncCapabilities());
    this.partsControls = createNoteRegisteredPartsControls(this.app, frame, host,
      () => this.destroyed || !this.modelReady ? null : this.preview, this.modelPath, this.partsAccess,
      () => this.helperToolbar?.exitInteractionMode(), () => this.helperToolbar?.syncCapabilities());

    const loading = createLoadingOverlay(host);

    const error = createStagedDiv("ai3d-embed-error is-hidden");
    host.appendChild(error);


    const tryInit = () => {
      if (this.destroyed || this.initStarted) return;
      if (!this.viewportReady) return;
      if (!host.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      this.initStarted = true;
      this.stopReadyPoll();
      this.stopReadyWatch();
      this.stopViewportWatch();
      void this.initPreview(host, canvas, loading, error, ++this.initGeneration);
    };

    this.readyObs = new ResizeObserver(() => tryInit());
    this.readyObs.observe(host);
    this.readyObs.observe(canvas);

    const startReadyPoll = () => {
      if (this.pollId || this.destroyed || this.initStarted) return;
      let attempts = 0;
      const poll = () => {
        this.pollId = 0;
        if (this.destroyed || this.initStarted) return;
        tryInit();
        if (this.initStarted) return;
        if (++attempts > 240) return; // ~4s at 60fps, then rely on resize observer only
        this.pollId = window.requestAnimationFrame(poll);
      };
      this.pollId = window.requestAnimationFrame(poll);
    };

    if (typeof IntersectionObserver === "undefined") {
      this.viewportReady = true;
      startReadyPoll();
      tryInit();
    } else {
      this.viewportObs = new IntersectionObserver((entries) => {
        if (this.destroyed || this.initStarted) return;
        if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return;
        this.viewportReady = true;
        this.stopViewportWatch();
        startReadyPoll();
        tryInit();
      }, { rootMargin: "200px" });
      this.viewportObs.observe(host);
    }

    return frame;
  }

  private stopReadyPoll(): void {
    if (!this.pollId) return;
    window.cancelAnimationFrame(this.pollId);
    this.pollId = 0;
  }

  private async initPreview(
    host: HTMLElement,
    canvas: HTMLCanvasElement,
    loading: LoadingOverlay,
    error: HTMLDivElement,
    generation: number,
  ): Promise<void> {
    try {
      loading.setPhaseKey("loading.preparingModel");
      await scheduleInlinePreviewLoad(async () => {
        if (this.destroyed || generation !== this.initGeneration || !host.isConnected) {
          loading.hide();
          return;
        }
        const [
          { prepareModelInput },
          { listPreferredConversionExts },
          { createLoggedModelPreview },
          { supportsAnnotationPreview },
          { AnnotationManager: AnnotationManagerCtor },
          { createNoteReader },
          { renderModelPerformanceFeedback },
        ] = await Promise.all([
          import("../../io/model-pipeline"),
          import("../../io/formats/route-preferences"),
          import("../../render/preview/selection"),
          import("../../render/preview/types"),
          import("../../render/preview/annotations"),
          import("../../utils/note-reader"),
          import("../model-load-feedback"),
        ]);
        const absolutePath = resolveVaultAbsolutePath(this.app, this.modelPath) ?? undefined;
        loading.setPhaseKey("loading.preparingModel");
        const conversionOutputRoot = resolveConversionOutputRoot(this.app, {
          auxiliaryFileFolder: this.auxiliaryFileFolder,
        });
        const pins = this.getAnnotations?.(this.modelPath) ?? [];
        const extForRoute = this.modelPath.split(".").pop()?.toLowerCase() ?? "";
        const allowThreeDirect = isThreeDirectRoute({
          ext: extForRoute,
          annotationMode: pins.length > 0 ? "readonly" : "none",
          rendererRollout: this.previewRendererRollout,
          useThreeRenderer: this.useThreeRenderer,
        });
        const prepared = await prepareModelInput({
          path: this.modelPath,
          absolutePath,
          preferConversionExts: listPreferredConversionExts({
            preferObj2gltfForObj: this.preferObj2gltfForObj,
            preferFbx2gltfForFbx: this.preferFbx2gltfForFbx,
          }),
          conversionManager: async () => {
            const { createConversionManager } = await import("../../io/conversion/factory");
            return createConversionManager({
              enabledConverterIds: this.enabledConverterIds,
              freecadCommand: this.freecadCommand,
              obj2gltfCommand: this.obj2gltfCommand,
              fbx2gltfCommand: this.fbx2gltfCommand,
              freecadcmdCommand: this.freecadcmdCommand,
            });
          },
          convertedAssetCache: this.convertedAssetCache,
          conversionOutputRoot,
          allowThreeDirect,
        });
        const previewOptions = {
          ext: prepared.effectiveExt,
          annotationMode: pins.length > 0 ? "readonly" : "none",
          rendererRollout: this.previewRendererRollout,
          useThreeRenderer: this.useThreeRenderer,
        } as const;
        const initialRenderBudgetPromise = getPreviewPathRenderBudget(this.app, prepared.effectivePath, {
          renderQuality: this.renderQuality,
          renderScale: this.renderScale,
        });
        const dataPromise = readBinaryPath(this.app, prepared.effectivePath);
        void initialRenderBudgetPromise.catch(() => undefined);
        void dataPromise.catch(() => undefined);
        const { preview, route } = await createLoggedModelPreview(
          log,
          { surface: "live-preview", modelPath: this.modelPath },
          canvas,
          previewOptions,
        );
        if (this.destroyed || generation !== this.initGeneration) {
          preview.destroy();
          return;
        }
        this.preview = preview;
        host.dataset.ai3dBackend = route.backend;
        this.helperToolbar?.syncCapabilities();
        const initialRenderBudget = await initialRenderBudgetPromise;
        this.preview.setRenderQuality?.(initialRenderBudget.renderQuality, initialRenderBudget.renderScale);
        loading.setPhaseKey("loading.loadingModel");
        const data = await dataPromise;
        if (this.destroyed || generation !== this.initGeneration) {
          this.preview?.destroy();
          this.preview = null;
          return;
        }
        const summary = await this.preview.loadModel(
          data,
          prepared.effectiveExt,
          (path) => readBinaryPath(this.app, path),
          prepared.effectivePath,
        );
        if (this.destroyed || generation !== this.initGeneration) {
          this.preview?.destroy();
          this.preview = null;
          this.helperToolbar?.syncCapabilities();
          return;
        }
        renderModelPerformanceFeedback(host, summary);
        this.modelReady = true;

        if (this.autoRotate) {
          this.preview.applyConfig({
            models: [],
            scene: { autoRotate: true, autoRotateSpeed: 0.5 },
          });
        }
        this.helperToolbar?.syncCapabilities();
        this.imageControls?.sync();
        this.partsControls?.sync();

        // Readonly annotations
        if (pins.length > 0 && supportsAnnotationPreview(this.preview)) {
          const provider = this.preview.getAnnotationProvider();
          if (provider.canvas) {
            this.annotationMgr = new AnnotationManagerCtor(
              provider,
              host,
              "readonly",
              pins,
              undefined,
              createNoteReader(this.app),
              undefined,
              {
                app: this.app,
                previewMode: this.annotationPreviewMode,
                displayMode: this.annotationDisplayMode,
              },
            );
            this.helperToolbar?.showAnnotateButton();
            this.helperToolbar?.updateAnnotationBadge(pins.length);
          }
        }

        loading.setProgress(100);
        loading.hide();
      });
    } catch (err) {
      if (this.destroyed || generation !== this.initGeneration) {
        return;
      }
      this.modelReady = false;
      this.partsControls?.destroy();
      this.imageControls?.destroy();
      this.helperToolbar?.destroy();
      this.preview?.destroy();
      this.preview = null;
      loading.hide();
      error.remove();
      host.replaceChildren();
      const [
        { describeModelLoadFailure, isMissingConverterError },
        { renderModelLoadFailure },
      ] = await Promise.all([
        import("../../io/conversion/errors"),
        import("../model-load-feedback"),
      ]);
      const failure = describeModelLoadFailure(err);
      if (isMissingConverterError(err)) {
        console.warn("[AI3D] Live Preview blocked by converter settings:", failure.message);
      } else {
        console.error("[AI3D] Live Preview failed:", err);
      }
      renderModelLoadFailure(host, failure);
    } finally {
      loading.hide();
    }
  }

  override destroy(): void {
    this.destroyed = true;
    this.partsControls?.destroy();
    this.partsControls = null;
    this.imageControls?.destroy();
    this.imageControls = null;
    this.modelReady = false;
    this.stopReadyPoll();
    this.stopReadyWatch();
    this.stopViewportWatch();
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.helperToolbar?.destroy();
    this.helperToolbar = null;
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
    }
    this.initStarted = false;
    this.viewportReady = false;
  }

  private stopReadyWatch(): void {
    this.readyObs?.disconnect();
    this.readyObs = null;
  }

  private stopViewportWatch(): void {
    this.viewportObs?.disconnect();
    this.viewportObs = null;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export { registerLazyLivePreviewExtension as registerLivePreviewExtension } from "./lazy-live-preview";
