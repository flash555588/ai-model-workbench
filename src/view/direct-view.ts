import { FileView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings, ModelPreviewSummary, ModelEvidence, PartRecord } from "../domain/models";
import { AnnotationManager } from "../render/preview/annotations";
import { createLoggedModelPreview } from "../render/preview/selection";
import type { AnnotationPreview } from "../render/preview/types";
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
import { formatT, t } from "../i18n";
import { renderModelLoadFailure, renderModelPerformanceFeedback } from "./model-load-feedback";
import { isMobile } from "../utils/device";
import { createLogger } from "../utils/log";
import { buildLocalAnalysisResult, buildPartRecordsFromEvidence } from "./workbench/analysis-result";
import { renderRegisteredPartMatchRow } from "./direct-workbench-registered-match";
import { createDirectViewLayout } from "./direct-view-layout";
import { renderDirectWorkbenchOverview } from "./direct-workbench-panel";
import { createDirectViewPreviewOptions, type DirectViewPreviewOptions } from "./direct-view-routing";

export const DIRECT_VIEW_TYPE = "ai3d-direct-view";

const log = createLogger("direct-view");

import { createDefaultProfile } from "../store/plugin-store";

function isMissingExternalModelResourceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Missing external model resource:");
}

function createPartMergeKey(
  part: Pick<PartRecord, "source" | "name" | "meshRefs" | "componentId" | "occurrenceId" | "partNumber">,
): string {
  const identity = part.occurrenceId ?? part.componentId ?? part.partNumber;
  if (identity?.trim()) {
    return `component:${identity.trim().toLowerCase()}`;
  }
  const meshRefs = part.meshRefs
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  return `${part.source ?? "mesh"}:${part.name.trim().toLowerCase()}:${meshRefs}`;
}

function mergeAutoRegisteredPart(previous: PartRecord | undefined, next: PartRecord): PartRecord {
  if (!previous) {
    return next;
  }

  return {
    ...next,
    notePath: previous.notePath,
    reviewed: previous.reviewed,
    inferredFunctions: previous.inferredFunctions.length > 0 ? previous.inferredFunctions : next.inferredFunctions,
    knowledgeTags: previous.knowledgeTags.length > 0 ? previous.knowledgeTags : next.knowledgeTags,
  };
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
  private workbenchPanel: HTMLElement | null = null;
  private workbenchSummary: ModelPreviewSummary | null = null;
  private workbenchRoute: { backend: string; reason: string } | null = null;
  private workbenchModelPath: string | null = null;
  private sidebarContent: HTMLElement | null = null;

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
    this.workbenchPanel = null;
    this.workbenchSummary = null;
    this.workbenchRoute = null;
    this.workbenchModelPath = null;
    this.sidebarContent = null;
    this.preview?.destroy();
    this.preview = null;
    this.ps.setCurrentModel(file.path, null);
    const {
      workspace,
      topTrack,
      mainArea,
      hHandle,
      host,
      canvas,
      modeOverlay,
      sidebarContent,
      vHandle,
      workbenchPanel,
    } = createDirectViewLayout({
      contentEl: this.contentEl,
      filePath: file.path,
      mobile,
      getPreview: () => this.preview,
    });
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
      mainArea,
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
    this.sidebarContent = sidebarContent;
    this.workbenchPanel = workbenchPanel;
    this.setupResizeHandles(hHandle, vHandle, topTrack, workspace);
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
      if (gen !== this.loadGeneration) {
        new Notice(t("directWorkbench.modelLoadInterrupted"));
        return;
      }
      const source = toPreviewSource(prepared);

      const basePreviewOptions = createDirectViewPreviewOptions(settings, source);
      toolbar?.syncCapabilities();
      loading.setPhaseKey("loading.loadingModel");
      const data = await readBinaryPath(this.app, source.path);
      const created = await this.createPreviewWithFallback(canvas, data, source, basePreviewOptions, file.path);
      if (gen !== this.loadGeneration) {
        created.preview.destroy();
        new Notice(t("directWorkbench.modelLoadInterrupted"));
        return;
      }
      this.preview = created.preview;
      host.dataset.ai3dBackend = created.route.backend;
      host.dataset.ai3dRouteReason = created.route.reason;
      toolbar?.syncCapabilities();
      const summary = created.summary;
      const evidence = this.preview.getModelEvidence?.() ?? null;
      this.registerModelPartsFromEvidence(file.path, evidence);
      renderModelPerformanceFeedback(host, summary);
      this.workbenchPanel = workbenchPanel;
      this.workbenchSummary = summary;
      this.workbenchRoute = created.route;
      this.workbenchModelPath = file.path;
      this.renderWorkbenchPanel(workbenchPanel, summary, created.route, file.path);
      this.renderSidebarContent(file.path, summary);
      this.ps.setCurrentModel(file.path, summary);
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
            this.ps.updateModelProfile(file.path, (_existing) => ({ annotations: pins }));
            // Update badge count
            toolbar.updateAnnotationBadge(pins.length);
          },
          noteReader,
          headingSearch,
          {
            app: this.app,
            previewMode: this.getSettings().annotationPreviewMode,
            displayMode: this.getSettings().annotationDisplayMode,
          },
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
      this.workbenchPanel?.addClass("is-hidden");
      const failure = describeModelLoadFailure(err);
      if (isMissingConverterError(err)) {
        console.warn("[AI3D] Direct view blocked by converter settings:", failure.message);
      } else {
        console.error("[AI3D] Direct view failed:", err);
      }
      if (this.ps.store.getState().currentModelPath === file.path) {
        this.ps.clearModelPreview();
      }
      renderModelLoadFailure(host, failure);
    }
  }

  private registerModelPartsFromEvidence(modelPath: string, evidence: ModelEvidence | null): void {
    if (!evidence?.parts.length) {
      return;
    }

    const nextParts = buildPartRecordsFromEvidence(modelPath, evidence.parts);
    if (nextParts.length === 0) {
      return;
    }

    const currentProfiles = this.ps.store.getState().modelAssetProfiles;
    const existingProfile = currentProfiles[modelPath] ?? createDefaultProfile();
    const existingByKey = new Map(
      (existingProfile.registeredParts ?? []).map((part) => [createPartMergeKey(part), part]),
    );
    const registeredParts = nextParts.map((part) => mergeAutoRegisteredPart(existingByKey.get(createPartMergeKey(part)), part));

    this.ps.updateModelProfile(modelPath, (_existing) => ({ registeredParts }));
  }
  private renderWorkbenchPanel(
    panel: HTMLElement,
    summary: ModelPreviewSummary,
    route: { backend: string; reason: string },
    modelPath: string,
  ): void {
    renderDirectWorkbenchOverview({
      panel,
      summary,
      route,
      registeredPartCount: this.ps.store.getState().modelAssetProfiles[modelPath]?.registeredParts?.length,
    });
  }
  private renderSidebarContent(modelPath: string, summary: ModelPreviewSummary): void {
    if (!this.sidebarContent) return;
    this.sidebarContent.empty();
    this.renderKnowledgeControls(this.sidebarContent, modelPath);
    this.renderRegisteredPartMatches(this.sidebarContent, modelPath, summary);
  }
  private refreshWorkbenchPanel(): void {
    if (!this.workbenchPanel || !this.workbenchSummary || !this.workbenchRoute || !this.workbenchModelPath) {
      return;
    }
    this.renderWorkbenchPanel(this.workbenchPanel, this.workbenchSummary, this.workbenchRoute, this.workbenchModelPath);
    this.renderSidebarContent(this.workbenchModelPath, this.workbenchSummary);
  }
  private setupResizeHandles(
    hHandle: HTMLElement,
    vHandle: HTMLElement,
    topTrack: HTMLElement,
    workspace: HTMLElement,
  ): void {
    const setupDrag = (
      handle: HTMLElement,
      onMove: (dx: number, dy: number) => void,
      onEnd: () => void,
    ): void => {
      let startX = 0;
      let startY = 0;
      const onMouseMove = (e: MouseEvent) => {
        onMove(e.clientX - startX, e.clientY - startY);
        startX = e.clientX;
        startY = e.clientY;
      };
      const onMouseUp = () => {
        activeDocument.removeEventListener("mousemove", onMouseMove);
        activeDocument.removeEventListener("mouseup", onMouseUp);
        onEnd();
      };
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        activeDocument.addEventListener("mousemove", onMouseMove);
        activeDocument.addEventListener("mouseup", onMouseUp);
      });
    };
    // Horizontal resize: adjust sidebar width
    let sidebarWidth = 200;
    setupDrag(hHandle, (dx) => {
      sidebarWidth = Math.max(48, Math.min(400, sidebarWidth - dx));
      topTrack.style.gridTemplateColumns = `1fr 4px ${sidebarWidth}px`;
    }, () => {});
    // Vertical resize: adjust bottom panel height
    let bottomHeight = 220;
    setupDrag(vHandle, (_dx, dy) => {
      bottomHeight = Math.max(120, Math.min(500, bottomHeight - dy));
      workspace.style.gridTemplateRows = `1fr 4px ${bottomHeight}px`;
    }, () => {});
  }
  private renderKnowledgeControls(parent: HTMLElement, modelPath: string): void {
    const profile = this.ps.store.getState().modelAssetProfiles[modelPath];
    const control = parent.createDiv({ cls: "ai3d-direct-workbench-control ai3d-direct-workbench-knowledge" });
    control.createDiv({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.knowledgeTitle") });
    control.createDiv({
      cls: "ai3d-direct-workbench-value",
      text: profile?.knowledgeIndexPath
        ? t("workbench.indexReady")
        : profile?.reportNotePath
          ? t("workbench.noteReady")
          : t("workbench.noReportYet"),
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
        .then(({ generateKnowledgeNote }) => generateKnowledgeNote(this.app, this.ps, { preview: this.preview }))
        .catch((err) => {
          console.error("[AI3D] Generate knowledge note failed:", err);
        })
        .finally(() => {
          generateButton.disabled = false;
          this.refreshWorkbenchPanel();
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

    const openIndexButton = actions.createEl("button", {
      cls: "ai3d-direct-workbench-action",
      text: t("workbench.openIndexAction"),
      attr: { type: "button", "data-ai3d-action": "open-index" },
    });
    openIndexButton.disabled = !profile?.knowledgeIndexPath;
    openIndexButton.addEventListener("click", () => {
      const indexPath = this.ps.store.getState().modelAssetProfiles[modelPath]?.knowledgeIndexPath;
      if (!indexPath) return;
      const file = this.app.vault.getAbstractFileByPath(indexPath);
      if (file instanceof TFile) {
        void this.app.workspace.getLeaf(true).openFile(file, { active: true });
      }
    });
  }

  private renderRegisteredPartMatches(parent: HTMLElement, modelPath: string, summary: ModelPreviewSummary): void {
    const generation = this.loadGeneration;
    const control = parent.createDiv({ cls: "ai3d-direct-workbench-control ai3d-direct-workbench-registered" });
    const header = control.createDiv({ cls: "ai3d-direct-workbench-control-head" });
    header.createSpan({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.registeredTitle") });
    const status = header.createSpan({ cls: "ai3d-direct-workbench-value", text: t("directWorkbench.registeredLoading") });
    const body = control.createDiv({ cls: "ai3d-direct-workbench-registered-body" });

    const renderEmpty = (messageKey: Parameters<typeof t>[0]) => {
      status.setText("");
      body.empty();
      body.createDiv({ cls: "ai3d-direct-workbench-empty", text: t(messageKey) });
    };

    const evidence = this.preview?.getModelEvidence?.() ?? null;
    if (!evidence?.parts.length) {
      renderEmpty("directWorkbench.registeredUnavailable");
      return;
    }

    void import("./workbench/knowledge-note")
      .then(async ({ collectRegisteredPartsFromProfiles }) => {
        const state = this.ps.store.getState();
        const registeredParts = await collectRegisteredPartsFromProfiles(this.app, state.modelAssetProfiles, modelPath);
        if (generation !== this.loadGeneration || this.workbenchModelPath !== modelPath || !control.isConnected) {
          return;
        }
        if (registeredParts.length === 0) {
          renderEmpty("directWorkbench.registeredEmpty");
          return;
        }

        const profile = this.ps.store.getState().modelAssetProfiles[modelPath];
        const analysis = buildLocalAnalysisResult({
          modelPath,
          profile,
          preview: summary,
          evidence,
          registeredParts,
        });
        const matchedParts = analysis.parts
          .filter((part) => part.registeredMatches?.length)
          .sort((left, right) => (right.registeredMatches?.[0]?.matchScore ?? 0) - (left.registeredMatches?.[0]?.matchScore ?? 0))
          .slice(0, 5);

        if (matchedParts.length === 0) {
          renderEmpty("directWorkbench.registeredEmpty");
          return;
        }

        status.setText(formatT("directWorkbench.registeredCount", { count: String(matchedParts.length) }));
        body.empty();
        const list = body.createDiv({ cls: "ai3d-direct-workbench-match-list" });
        for (const part of matchedParts) {
          const match = part.registeredMatches?.[0];
          if (!match) continue;
          const row = renderRegisteredPartMatchRow(list, part.name, match);
          const openButton = row.querySelector("[data-ai3d-action='open-registered-part']");
          if (!(openButton instanceof HTMLButtonElement)) continue;
          openButton.addEventListener("click", () => {
            const targetPath = openButton.getAttribute("data-ai3d-target-path") || undefined;
            if (!targetPath) return;
            const file = this.app.vault.getAbstractFileByPath(targetPath);
            if (file instanceof TFile) {
              void this.app.workspace.getLeaf(true).openFile(file, { active: true });
            }
          });
        }
      })
      .catch((error) => {
        console.warn("[AI3D] Registered part match preview failed:", error);
        if (generation === this.loadGeneration && this.workbenchModelPath === modelPath && control.isConnected) {
          renderEmpty("directWorkbench.registeredUnavailable");
        }
      });
  }

  private async createPreviewWithFallback(
    canvas: HTMLCanvasElement,
    data: ArrayBuffer,
    source: ReturnType<typeof toPreviewSource>,
    options: DirectViewPreviewOptions,
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
      if (created.route.backend !== "three" || !options.requireWorkbenchFeatures || !options.allowWorkbenchFeaturesOnThree) {
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
        if (isMissingExternalModelResourceError(error)) {
          throw error;
        }
        throw fallbackError;
      }
    }
  }
}
