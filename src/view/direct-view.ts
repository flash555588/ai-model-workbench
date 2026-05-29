import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings, ModelAssetProfile, ModelPreviewSummary } from "../domain/models";
import { AnnotationManager } from "../render/preview/annotations";
import { createLoggedModelPreview } from "../render/preview/selection";
import { supportsWorkbenchPreview, type AnnotationPreview, type PreviewAxis } from "../render/preview/types";
import { createHelperButtons } from "./inline/helper-buttons";
import { createConversionManager } from "../io/conversion/factory";
import type { ConvertedAssetCache } from "../io/cache/converted-asset-cache";
import type { PluginStore } from "../store/plugin-store";
import { prepareModelInput } from "../io/model-pipeline";
import { toPreviewSource } from "../io/preview/preview-source";
import { readBinaryPath, resolveVaultAbsolutePath } from "../utils/resolve-path";
import { listPreferredConversionExts } from "../io/formats/route-preferences";
import { createNoteReader, createHeadingSearch } from "../utils/note-reader";
import { createLoadingOverlay } from "./inline/loading-overlay";
import { describeModelLoadFailure, isMissingConverterError } from "../io/conversion/errors";
import { t } from "../i18n";
import { renderModelLoadFailure, renderModelPerformanceFeedback } from "./model-load-feedback";
import { isMobile } from "../utils/device";
import { createLogger } from "../utils/log";

export const DIRECT_VIEW_TYPE = "ai3d-direct-view";

const log = createLogger("direct-view");
const THREE_WORKBENCH_DIRECT_EXTS = new Set(["glb", "gltf"]);
const EXPLODE_AXES: PreviewAxis[] = ["x", "y", "z"];

function createDefaultProfile(): ModelAssetProfile {
  return { tags: [], notes: "", annotations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function canUseExperimentalThreeWorkbench(settings: PluginSettings, source: ReturnType<typeof toPreviewSource>): boolean {
  return settings.experimentalThreeWorkbench
    && settings.useThreeRenderer
    && source.strategy === "direct"
    && THREE_WORKBENCH_DIRECT_EXTS.has(source.ext)
    && THREE_WORKBENCH_DIRECT_EXTS.has(source.sourceExt);
}

function formatCount(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString();
}

function formatBounds(summary: ModelPreviewSummary): string {
  return [
    summary.boundingSize.x,
    summary.boundingSize.y,
    summary.boundingSize.z,
  ].map((value) => value.toFixed(2)).join(" x ");
}

function formatBackendName(backend: string): string {
  return backend === "three" ? "Three.js" : "Babylon.js";
}

export class DirectModelView extends FileView {
  private preview: AnnotationPreview | null = null;
  private annotationMgr: AnnotationManager | null = null;
  private annotationMode = false;
  private loadGeneration = 0;
  private getSettings: () => PluginSettings;
  private convertedAssetCache: ConvertedAssetCache;
  private ps: PluginStore;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, getSettings: () => PluginSettings, convertedAssetCache: ConvertedAssetCache, ps: PluginStore) {
    super(leaf);
    this.getSettings = getSettings;
    this.convertedAssetCache = convertedAssetCache;
    this.ps = ps;
  }

  getViewType(): string {
    return DIRECT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? t("workbench.modelTitle");
  }

  getIcon(): string {
    return "box";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("ai3d-direct-view");

    if (this.file) {
      await this.loadModel(this.file);
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    await this.loadModel(file);
  }

  onClose(): Promise<void> {
    if (this.escHandler) {
      activeDocument.removeEventListener("keydown", this.escHandler);
      this.escHandler = null;
    }
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.preview?.destroy();
    this.preview = null;
    return Promise.resolve();
  }

  private async loadModel(file: TFile): Promise<void> {
    const gen = ++this.loadGeneration;
    const mobile = isMobile();
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.annotationMode = false;
    this.preview?.destroy();
    this.preview = null;
    this.ps.store.setState({
      currentModelPath: file.path,
      modelPreview: null,
      selectedPart: null,
    });

    // Use a detached staging container to avoid "Only one element on document" error.
    // This happens because contentEl may be the document itself during onLoadFile.
    const staging = createDiv();
    const host = staging.createDiv({ cls: "ai3d-preview-host" });

    const canvas = staging.createEl("canvas");
    canvas.className = "ai3d-canvas-full";
    host.appendChild(canvas);

    // Semi-transparent overlay for annotation mode
    const modeOverlay = staging.createDiv();
    modeOverlay.className = "ai3d-annot-mode-overlay is-hidden";
    host.appendChild(modeOverlay);

    this.contentEl.appendChild(host);

    let toolbar: ReturnType<typeof createHelperButtons> | null = null;

    const setAnnotationMode = (active: boolean) => {
      this.annotationMode = active;
      if (mobile && active) {
        toolbar?.setMobileInteractionMode(true);
      }
      this.annotationMgr?.hideEditor();
      modeOverlay.classList.toggle("is-hidden", !active);
    };

    // ESC key to exit annotation mode
    if (this.escHandler) activeDocument.removeEventListener("keydown", this.escHandler);
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.annotationMode) {
        setAnnotationMode(false);
      }
    };
    activeDocument.addEventListener("keydown", this.escHandler);

    toolbar = createHelperButtons(
      this.contentEl,
      host,
      this.app,
      () => this.preview,
      () => file.path,
      () => {
        this.leaf.detach();
      },
      this.getSettings,
      // annotation toggle callback
      () => {
        setAnnotationMode(!this.annotationMode);
        return this.annotationMode;
      },
      (interactive) => {
        if (!interactive && this.annotationMode) {
          setAnnotationMode(false);
        }
      },
    );
    const workbenchPanel = this.contentEl.createDiv({ cls: "ai3d-direct-workbench-panel is-hidden" });

    if (mobile) {
      this.contentEl.createDiv({
        cls: "ai3d-mobile-mode-hint ai3d-mobile-mode-hint--inline",
        text: t("directView.mobileHint"),
      });
    }

    const loading = createLoadingOverlay(host);

    try {
      const settings = this.getSettings();
      const conversionManager = createConversionManager(settings);
      const absolutePath = resolveVaultAbsolutePath(this.app, file.path) ?? undefined;
      loading.setPhaseKey("loading.preparingModel");
      const prepared = await prepareModelInput({
        path: file.path,
        absolutePath,
        preferConversionExts: listPreferredConversionExts(settings),
        conversionManager,
        convertedAssetCache: this.convertedAssetCache,
      });
      if (gen !== this.loadGeneration) return;
      const source = toPreviewSource(prepared);

      const basePreviewOptions = {
        ext: source.ext,
        annotationMode: "edit",
        allowEditModeOnThree: true,
        allowWorkbenchFeaturesOnThree: canUseExperimentalThreeWorkbench(settings, source),
        requireWorkbenchFeatures: true,
        rendererRollout: settings.previewRendererRollout,
        useThreeRenderer: settings.useThreeRenderer,
      } as const;
      toolbar?.syncCapabilities();
      loading.setPhaseKey("loading.loadingModel");
      const data = await readBinaryPath(this.app, source.path);
      const created = await this.createPreviewWithFallback(canvas, data, source, basePreviewOptions, file.path);
      if (gen !== this.loadGeneration) { created.preview.destroy(); return; }
      this.preview = created.preview;
      host.dataset.ai3dBackend = created.route.backend;
      host.dataset.ai3dRouteReason = created.route.reason;
      toolbar?.syncCapabilities();
      const summary = created.summary;
      renderModelPerformanceFeedback(host, summary);
      this.renderWorkbenchPanel(workbenchPanel, summary, created.route, file.path);
      this.ps.store.setState({
        currentModelPath: file.path,
        modelPreview: summary,
        selectedPart: null,
      });
      log.info("direct view model loaded", {
        path: file.path,
        effectivePath: source.path,
        effectiveExt: source.ext,
        strategy: source.strategy,
        backend: created.route.backend,
        routeReason: created.route.reason,
        meshCount: summary.meshCount,
        triangleCount: summary.triangleCount,
      });
      loading.setProgress(100);

      // Set up annotation manager (edit mode)
      const provider = this.preview.getAnnotationProvider();
      if (provider.canvas) {
        const profile = this.ps.store.getState().modelAssetProfiles[file.path];
        const initialPins = profile?.annotations ?? [];
        const noteReader = createNoteReader(this.app);
        const headingSearch = createHeadingSearch(this.app);
        this.annotationMgr = new AnnotationManager(
          provider,
          host,
          "edit",
          initialPins,
          (pins) => {
            const current = this.ps.store.getState().modelAssetProfiles;
            const existing = current[file.path] ?? createDefaultProfile();
            this.ps.store.setState({
              modelAssetProfiles: { ...current, [file.path]: { ...existing, annotations: pins, updatedAt: new Date().toISOString() } },
            });
            // Update badge count
            toolbar.updateAnnotationBadge(pins.length);
          },
          noteReader,
          headingSearch,
          { app: this.app, previewMode: this.getSettings().annotationPreviewMode },
        );

        // Show annotate button with badge
        toolbar.showAnnotateButton();
        toolbar.updateAnnotationBadge(initialPins.length);

        // Wire pick callback
        this.preview.onPick((result) => {
          if (!this.annotationMode || !this.annotationMgr) return;
          const screenX = result.screenX;
          const screenY = result.screenY;
          const worldPos = this.preview?.getPickWorldPoint(result) ?? null;
          if (!worldPos) return;

          this.annotationMgr.showEditor(screenX, screenY, worldPos);
        });
      }

      loading.hide();
    } catch (err) {
      if (gen !== this.loadGeneration) return;
      loading.hide();
      this.preview?.destroy();
      this.preview = null;
      host.replaceChildren();
      workbenchPanel.addClass("is-hidden");
      const failure = describeModelLoadFailure(err);
      if (isMissingConverterError(err)) {
        console.warn("[AI3D] Direct view blocked by converter settings:", failure.message);
      } else {
        console.error("[AI3D] Direct view failed:", err);
      }
      if (this.ps.store.getState().currentModelPath === file.path) {
        this.ps.store.setState({ modelPreview: null, selectedPart: null });
      }
      renderModelLoadFailure(host, failure);
    }
  }

  private renderWorkbenchPanel(
    panel: HTMLElement,
    summary: ModelPreviewSummary,
    route: { backend: string; reason: string },
    modelPath: string,
  ): void {
    panel.empty();
    panel.removeClass("is-hidden");
    panel.dataset.ai3dBackend = route.backend;
    panel.dataset.ai3dRouteReason = route.reason;

    const status = panel.createDiv({ cls: "ai3d-direct-workbench-status" });
    const backendLine = status.createDiv({ cls: "ai3d-direct-workbench-line" });
    backendLine.createSpan({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.backendLabel") });
    backendLine.createSpan({ cls: "ai3d-direct-workbench-value", text: formatBackendName(route.backend) });
    const routeLine = status.createDiv({ cls: "ai3d-direct-workbench-line ai3d-direct-workbench-route" });
    routeLine.createSpan({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.routeLabel") });
    routeLine.createSpan({ cls: "ai3d-direct-workbench-value", text: route.reason });

    const metrics = panel.createDiv({ cls: "ai3d-direct-workbench-metrics" });
    this.renderMetric(metrics, t("workbench.meshesLabel"), formatCount(summary.meshCount));
    this.renderMetric(
      metrics,
      summary.splatCount !== undefined ? t("workbench.splatsLabel") : t("workbench.trianglesLabel"),
      formatCount(summary.splatCount ?? summary.triangleCount),
    );
    this.renderMetric(metrics, t("workbench.materialsLabel"), formatCount(summary.materialCount));
    this.renderMetric(metrics, t("workbench.boundingSizeLabel"), formatBounds(summary));
    this.renderMetric(metrics, t("directWorkbench.performanceLabel"), summary.performanceTier ?? "light");

    const controls = panel.createDiv({ cls: "ai3d-direct-workbench-controls" });
    this.renderExplodeControls(controls);
    this.renderKnowledgeControls(controls, modelPath);
  }

  private renderMetric(parent: HTMLElement, label: string, value: string): void {
    const metric = parent.createDiv({ cls: "ai3d-direct-workbench-metric" });
    metric.createSpan({ cls: "ai3d-direct-workbench-label", text: label });
    metric.createSpan({ cls: "ai3d-direct-workbench-value", text: value });
  }

  private renderExplodeControls(parent: HTMLElement): void {
    const supportsExplode = !!this.preview && supportsWorkbenchPreview(this.preview);
    const control = parent.createDiv({ cls: "ai3d-direct-workbench-control" });
    const header = control.createDiv({ cls: "ai3d-direct-workbench-control-head" });
    header.createSpan({ cls: "ai3d-direct-workbench-label", text: t("workbench.explodeLabel") });
    const valueLabel = header.createSpan({ cls: "ai3d-direct-workbench-value", text: "0%" });

    let axis: PreviewAxis = "x";
    const axisGroup = control.createDiv({
      cls: "ai3d-direct-workbench-axis",
      attr: { "aria-label": t("directWorkbench.explodeAxisLabel") },
    });
    for (const nextAxis of EXPLODE_AXES) {
      const button = axisGroup.createEl("button", {
        cls: nextAxis === axis ? "is-active" : "",
        text: nextAxis.toUpperCase(),
        attr: { type: "button", "data-ai3d-action": `set-explode-axis-${nextAxis}` },
      });
      button.disabled = !supportsExplode;
      button.addEventListener("click", () => {
        axis = nextAxis;
        for (const peer of Array.from(axisGroup.querySelectorAll("button"))) {
          peer.classList.toggle("is-active", peer === button);
        }
        applyExplode();
      });
    }

    const row = control.createDiv({ cls: "ai3d-direct-workbench-range-row" });
    const range = row.createEl("input", {
      cls: "ai3d-direct-workbench-range",
      attr: { "data-ai3d-action": "set-explode" },
    });
    range.type = "range";
    range.min = "0";
    range.max = "0.85";
    range.step = "0.05";
    range.value = "0";
    range.disabled = !supportsExplode;

    const resetButton = row.createEl("button", {
      cls: "ai3d-direct-workbench-reset",
      text: t("directWorkbench.explodeResetLabel"),
      attr: { type: "button", "data-ai3d-action": "reset-explode" },
    });
    resetButton.disabled = !supportsExplode;

    const applyExplode = () => {
      const factor = Number.parseFloat(range.value);
      valueLabel.setText(`${Math.round(factor * 100)}%`);
      resetButton.classList.toggle("is-active", factor > 0);
      if (this.preview && supportsWorkbenchPreview(this.preview)) {
        this.preview.setExplode(factor, axis);
      }
    };

    range.addEventListener("input", applyExplode);
    resetButton.addEventListener("click", () => {
      range.value = "0";
      valueLabel.setText("0%");
      resetButton.classList.remove("is-active");
      if (this.preview && supportsWorkbenchPreview(this.preview)) {
        this.preview.resetExplode();
      }
    });
  }

  private renderKnowledgeControls(parent: HTMLElement, modelPath: string): void {
    const profile = this.ps.store.getState().modelAssetProfiles[modelPath];
    const control = parent.createDiv({ cls: "ai3d-direct-workbench-control ai3d-direct-workbench-knowledge" });
    control.createDiv({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.knowledgeTitle") });
    control.createDiv({
      cls: "ai3d-direct-workbench-value",
      text: profile?.reportNotePath ? t("workbench.noteReady") : t("workbench.noReportYet"),
    });

    const actions = control.createDiv({ cls: "ai3d-direct-workbench-actions" });
    const generateButton = actions.createEl("button", {
      cls: "ai3d-direct-workbench-action",
      text: t("workbench.generateNoteAction"),
      attr: { type: "button", "data-ai3d-action": "generate-note" },
    });
    generateButton.addEventListener("click", () => {
      generateButton.disabled = true;
      void import("./workbench/knowledge-note")
        .then(({ generateKnowledgeNote }) => generateKnowledgeNote(this.app, this.ps))
        .catch((err) => {
          console.error("[AI3D] Generate knowledge note failed:", err);
        })
        .finally(() => {
          generateButton.disabled = false;
        });
    });

    const openButton = actions.createEl("button", {
      cls: "ai3d-direct-workbench-action",
      text: t("workbench.openNoteAction"),
      attr: { type: "button", "data-ai3d-action": "open-note" },
    });
    openButton.disabled = !profile?.reportNotePath;
    openButton.addEventListener("click", () => {
      const reportPath = this.ps.store.getState().modelAssetProfiles[modelPath]?.reportNotePath;
      if (!reportPath) return;
      const file = this.app.vault.getAbstractFileByPath(reportPath);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf(true).openFile(file, { active: true });
      }
    });
  }

  private async createPreviewWithFallback(
    canvas: HTMLCanvasElement,
    data: ArrayBuffer,
    source: ReturnType<typeof toPreviewSource>,
    options: {
      ext: string;
      annotationMode: "edit";
      allowEditModeOnThree: boolean;
      allowWorkbenchFeaturesOnThree: boolean;
      requireWorkbenchFeatures: true;
      rendererRollout: PluginSettings["previewRendererRollout"];
      useThreeRenderer: boolean;
    },
    modelPath: string,
  ): Promise<{
      preview: AnnotationPreview;
      summary: Awaited<ReturnType<AnnotationPreview["loadModel"]>>;
      route: Awaited<ReturnType<typeof createLoggedModelPreview<AnnotationPreview>>>["route"];
    }> {
    const created = await createLoggedModelPreview<AnnotationPreview>(
      log,
      { surface: "direct-view", modelPath },
      canvas,
      options,
    );

    try {
      const summary = await created.preview.loadModel(data.slice(0), source.ext, (path) => readBinaryPath(this.app, path), source.path);
      return { preview: created.preview, summary, route: created.route };
    } catch (error) {
      created.preview.destroy();
      if (created.route.backend !== "three" || !options.allowWorkbenchFeaturesOnThree) {
        throw error;
      }
      console.warn("[AI3D] Experimental Three workbench failed; falling back to Babylon:", error);
      const fallbackOptions = {
        ...options,
        allowWorkbenchFeaturesOnThree: false,
      } as const;
      const fallback = await createLoggedModelPreview<AnnotationPreview>(
        log,
        { surface: "direct-view-fallback", modelPath },
        canvas,
        fallbackOptions,
      );
      try {
        const summary = await fallback.preview.loadModel(data.slice(0), source.ext, (path) => readBinaryPath(this.app, path), source.path);
        return { preview: fallback.preview, summary, route: fallback.route };
      } catch (fallbackError) {
        fallback.preview.destroy();
        throw fallbackError;
      }
    }
  }
}
