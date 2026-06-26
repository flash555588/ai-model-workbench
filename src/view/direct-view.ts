import { FileView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings, ModelPreviewSummary, ModelEvidence, ModelEvidenceFormatLineage, ModelPartSummary, PartRecord } from "../domain/models";
import type { AnnotationManager } from "../render/preview/annotations";
import { createLoggedModelPreview } from "../render/preview/selection";
import type { AnnotationPreview } from "../render/preview/types";
import { createHelperButtons } from "./inline/helper-buttons";
import type { ConvertedAssetCache } from "../io/cache/converted-asset-cache";
import type { PluginStore } from "../store/plugin-store";
import { prepareModelInput } from "../io/model-pipeline";
import { toPreviewSource, type PreviewSource } from "../io/preview/preview-source";
import { readBinaryPath, resolveVaultAbsolutePath } from "../utils/resolve-path";
import { listPreferredConversionExts } from "../io/formats/route-preferences";
import { createLoadingOverlay } from "./inline/loading-overlay";
import { describeModelLoadFailure, isMissingConverterError } from "../io/conversion/errors";
import { formatT, t } from "../i18n";
import { renderModelLoadFailure, renderModelPerformanceFeedback } from "./model-load-feedback";
import { isMobile } from "../utils/device";
import { createLogger } from "../utils/log";
import { compactRegisteredPartForPersistence } from "../utils/registered-part-persistence";
import { inferModelAssetFormat } from "./workbench/format-lineage";
import { createDirectViewLayout } from "./direct-view-layout";
import { renderDirectWorkbenchOverview } from "./direct-workbench-panel";
import { createDirectViewPreviewOptions, type DirectViewPreviewOptions } from "./direct-view-routing";
import { DIRECT_VIEW_TYPE } from "./direct-view-type";

const log = createLogger("direct-view");
const DEFERRED_EVIDENCE_DELAY_MS = 450;
const MEDIUM_DEFERRED_EVIDENCE_DELAY_MS = 1_200;
const HEAVY_DEFERRED_EVIDENCE_DELAY_MS = 1_500;
const MAX_AUTO_REGISTERED_PARTS = 256;
const MAX_AUTO_EVIDENCE_MESHES = 500;
const MAX_AUTO_EVIDENCE_TRIANGLES = 1_500_000;
const MAX_MATCH_PREVIEW_EVIDENCE_PARTS = 64;
const MAX_MATCH_PREVIEW_REGISTERED_PARTS = 512;
const REGISTERED_MATCH_PREVIEW_DELAY_MS = 250;
const MEDIUM_REGISTERED_MATCH_PREVIEW_DELAY_MS = 1_000;
const CONVERSION_OUTPUT_ROOT = ".obsidian/ai-model-workbench/converted-assets";

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
    observations: previous.reviewed || previous.notePath ? previous.observations : next.observations,
    inferredFunctions: previous.inferredFunctions.length > 0 ? previous.inferredFunctions : next.inferredFunctions,
    knowledgeTags: previous.knowledgeTags.length > 0 ? previous.knowledgeTags : next.knowledgeTags,
  };
}

function getAutoRegisteredPartRank(part: PartRecord): number {
  if (part.reviewed || part.notePath) return 0;
  if (part.source === "component") return 1;
  if (part.source === "group") return 2;
  if (part.source === "detail-cluster") return 3;
  return 4;
}

function limitAutoRegisteredParts(parts: PartRecord[]): PartRecord[] {
  if (parts.length <= MAX_AUTO_REGISTERED_PARTS) {
    return parts;
  }

  return [...parts]
    .sort((left, right) => {
      const rankDelta = getAutoRegisteredPartRank(left) - getAutoRegisteredPartRank(right);
      if (rankDelta !== 0) return rankDelta;
      const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return (right.childCount ?? 0) - (left.childCount ?? 0);
    })
    .slice(0, MAX_AUTO_REGISTERED_PARTS);
}

function createComparableRegisteredPart(part: PartRecord): Omit<PartRecord, "registeredMatches"> {
  return {
    partId: part.partId,
    assetId: part.assetId,
    parentPartId: part.parentPartId,
    name: part.name,
    source: part.source,
    componentId: part.componentId,
    occurrenceId: part.occurrenceId,
    partNumber: part.partNumber,
    componentPath: part.componentPath,
    category: part.category,
    meshRefs: part.meshRefs,
    childCount: part.childCount,
    materialRefs: part.materialRefs,
    bbox: part.bbox,
    center: part.center,
    triangleCount: part.triangleCount,
    vertexCount: part.vertexCount,
    materialName: part.materialName,
    sourceFormat: part.sourceFormat,
    effectiveFormat: part.effectiveFormat,
    loadStrategy: part.loadStrategy,
    confidence: part.confidence,
    observations: part.observations,
    inferredFunctions: part.inferredFunctions,
    knowledgeTags: part.knowledgeTags,
    notePath: part.notePath,
    reviewed: part.reviewed,
  };
}

function areRegisteredPartListsEquivalent(left: readonly PartRecord[] = [], right: readonly PartRecord[] = []): boolean {
  if (left.length !== right.length) return false;
  return JSON.stringify(left.map(createComparableRegisteredPart)) === JSON.stringify(right.map(createComparableRegisteredPart));
}

function getPerformanceTierRank(tier: ModelPreviewSummary["performanceTier"]): number {
  if (tier === "extreme") return 3;
  if (tier === "heavy") return 2;
  if (tier === "medium") return 1;
  return 0;
}

function getDeferredEvidenceDelay(summary: ModelPreviewSummary): number {
  const tierRank = getPerformanceTierRank(summary.performanceTier);
  if (tierRank >= 2) {
    return HEAVY_DEFERRED_EVIDENCE_DELAY_MS;
  }
  return tierRank === 1 ? MEDIUM_DEFERRED_EVIDENCE_DELAY_MS : DEFERRED_EVIDENCE_DELAY_MS;
}

function shouldAutoCaptureEvidence(summary: ModelPreviewSummary): boolean {
  return getPerformanceTierRank(summary.performanceTier) < 2
    && summary.meshCount <= MAX_AUTO_EVIDENCE_MESHES
    && summary.triangleCount <= MAX_AUTO_EVIDENCE_TRIANGLES;
}

function getRegisteredMatchPreviewDelay(summary: ModelPreviewSummary): number | null {
  const tierRank = getPerformanceTierRank(summary.performanceTier);
  if (tierRank >= 2) {
    return null;
  }
  return tierRank === 1 ? MEDIUM_REGISTERED_MATCH_PREVIEW_DELAY_MS : REGISTERED_MATCH_PREVIEW_DELAY_MS;
}

function getMatchPreviewPartRank(part: ModelPartSummary): number {
  if (part.source === "component") return 0;
  if (part.source === "group") return 1;
  if (part.source === "detail-cluster") return 2;
  return 3;
}

function createMatchPreviewEvidence(evidence: ModelEvidence): ModelEvidence {
  if (evidence.parts.length <= MAX_MATCH_PREVIEW_EVIDENCE_PARTS) {
    return evidence;
  }

  return {
    ...evidence,
    parts: [...evidence.parts]
      .sort((left, right) => {
        const rankDelta = getMatchPreviewPartRank(left) - getMatchPreviewPartRank(right);
        if (rankDelta !== 0) return rankDelta;
        const childDelta = (right.childCount ?? 0) - (left.childCount ?? 0);
        if (childDelta !== 0) return childDelta;
        return right.triangleCount - left.triangleCount;
      })
      .slice(0, MAX_MATCH_PREVIEW_EVIDENCE_PARTS),
  };
}

function getLargeModelQualityBudget(
  settings: PluginSettings,
  summary: ModelPreviewSummary,
): Pick<PluginSettings, "renderQuality" | "renderScale"> {
  if (summary.performanceTier === "extreme") {
    return {
      renderQuality: "low",
      renderScale: Math.min(settings.renderScale, 0.65),
    };
  }
  if (summary.performanceTier === "heavy") {
    return {
      renderQuality: settings.renderQuality === "low" ? "low" : "medium",
      renderScale: Math.min(settings.renderScale, 0.85),
    };
  }
  if (summary.performanceTier === "medium") {
    return {
      renderQuality: settings.renderQuality,
      renderScale: Math.min(settings.renderScale, 1),
    };
  }
  return {
    renderQuality: settings.renderQuality,
    renderScale: settings.renderScale,
  };
}

function createEvidenceFormatLineage(source: PreviewSource): ModelEvidenceFormatLineage {
  return {
    sourcePath: source.sourcePath,
    sourceFormat: inferModelAssetFormat(source.sourceExt || source.sourcePath),
    effectiveFormat: inferModelAssetFormat(source.ext || source.path),
    loadStrategy: source.strategy,
  };
}

function applyEvidenceFormatLineage(
  evidence: ModelEvidence,
  lineage: ModelEvidenceFormatLineage | null,
  warnings: readonly string[] = [],
): ModelEvidence {
  if (!lineage && warnings.length === 0) {
    return evidence;
  }

  const formatLineage = lineage ?? evidence.formatLineage;
  const resourceWarnings = Array.from(new Set([
    ...evidence.resourceWarnings,
    ...warnings,
  ]));

  return {
    ...evidence,
    formatLineage,
    resourceWarnings,
    parts: evidence.parts.map((part) => ({
      ...part,
      sourceFormat: part.sourceFormat ?? formatLineage?.sourceFormat,
      effectiveFormat: part.effectiveFormat ?? formatLineage?.effectiveFormat,
      loadStrategy: part.loadStrategy ?? formatLineage?.loadStrategy,
    })),
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
  private workbenchEvidenceLineage: ModelEvidenceFormatLineage | null = null;
  private workbenchSourceWarnings: string[] = [];
  private workbenchEvidenceModelPath: string | null = null;
  private workbenchEvidence: ModelEvidence | null = null;
  private evidenceRegistrationTimer: number | null = null;
  private registeredMatchPreviewTimer: number | null = null;
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
    this.clearDeferredEvidenceRegistration();
    this.clearRegisteredMatchPreview();
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
    this.clearDeferredEvidenceRegistration();
    this.clearRegisteredMatchPreview();
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.workbenchPanel = null;
    this.workbenchSummary = null;
    this.workbenchRoute = null;
    this.workbenchModelPath = null;
    this.workbenchEvidenceLineage = null;
    this.workbenchSourceWarnings = [];
    this.workbenchEvidenceModelPath = null;
    this.workbenchEvidence = null;
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
      const absolutePath = resolveVaultAbsolutePath(this.app, file.path) ?? undefined;
      const conversionOutputRoot = resolveVaultAbsolutePath(this.app, CONVERSION_OUTPUT_ROOT) ?? undefined;
      loading.setPhaseKey("loading.preparingModel");
      const prepared = await prepareModelInput({
        path: file.path,
        absolutePath,
        preferConversionExts: listPreferredConversionExts(settings),
        conversionManager: async () => {
          const { createConversionManager } = await import("../io/conversion/factory");
          return createConversionManager(settings);
        },
        convertedAssetCache: this.convertedAssetCache,
        conversionOutputRoot,
      });
      if (gen !== this.loadGeneration) {
        new Notice(t("directWorkbench.modelLoadInterrupted"));
        return;
      }
      const source = toPreviewSource(prepared);
      this.workbenchEvidenceLineage = createEvidenceFormatLineage(source);
      this.workbenchSourceWarnings = [...source.warnings];

      const basePreviewOptions = createDirectViewPreviewOptions(settings, source);
      toolbar?.syncCapabilities();
      loading.setPhaseKey("loading.loadingModel");
      const dataPromise = readBinaryPath(this.app, source.path);
      void dataPromise.catch(() => undefined);
      const created = await this.createPreviewWithFallback(canvas, dataPromise, source, basePreviewOptions, file.path, settings);
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
      this.applyLargeModelRenderBudget(created.preview, settings, summary);
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

      loading.hide();
      void this.setupAnnotationManager(file.path, gen, host, toolbar);
      this.scheduleDeferredEvidenceRegistration(file.path, gen, summary);
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
    } finally {
      loading.hide();
    }
  }

  private async setupAnnotationManager(
    modelPath: string,
    generation: number,
    host: HTMLElement,
    toolbar: ReturnType<typeof createHelperButtons> | null,
  ): Promise<void> {
    const preview = this.preview;
    if (!preview) {
      return;
    }
    const provider = preview.getAnnotationProvider();
    if (!provider.canvas) {
      return;
    }

    try {
      const [{ AnnotationManager }, { createHeadingSearch, createNoteReader }] = await Promise.all([
        import("../render/preview/annotations"),
        import("../utils/note-reader"),
      ]);
      if (generation !== this.loadGeneration || this.preview !== preview || this.workbenchModelPath !== modelPath || !host.isConnected) {
        return;
      }

      const profile = this.ps.store.getState().modelAssetProfiles[modelPath];
      const initialPins = profile?.annotations ?? [];
      const noteReader = createNoteReader(this.app);
      const headingSearch = createHeadingSearch(this.app);
      this.annotationMgr = new AnnotationManager(
        provider,
        host,
        "edit",
        initialPins,
        (pins) => {
          this.ps.updateModelProfile(modelPath, (_existing) => ({ annotations: pins }));
          toolbar?.updateAnnotationBadge(pins.length);
        },
        noteReader,
        headingSearch,
        {
          app: this.app,
          previewMode: this.getSettings().annotationPreviewMode,
          displayMode: this.getSettings().annotationDisplayMode,
        },
      );

      toolbar?.showAnnotateButton();
      toolbar?.updateAnnotationBadge(initialPins.length);

      preview.onPick((result) => {
        if (!this.annotationMode || !this.annotationMgr) return;
        const screenX = result.screenX;
        const screenY = result.screenY;
        const worldPos = this.preview?.getPickWorldPoint(result) ?? null;
        if (!worldPos) return;

        this.annotationMgr.showEditor(screenX, screenY, worldPos);
      });
    } catch (error) {
      console.warn("[AI3D] Direct view annotation runtime failed to load:", error);
    }
  }

  private async registerModelPartsFromEvidence(modelPath: string, evidence: ModelEvidence | null): Promise<void> {
    if (!evidence?.parts.length) {
      return;
    }

    const { buildPartRecordsFromEvidence } = await import("./workbench/analysis-result");
    const nextParts = buildPartRecordsFromEvidence(modelPath, evidence.parts, evidence.formatLineage);
    if (nextParts.length === 0) {
      return;
    }

    const currentProfiles = this.ps.store.getState().modelAssetProfiles;
    const existingProfile = currentProfiles[modelPath] ?? createDefaultProfile();
    const existingByKey = new Map(
      (existingProfile.registeredParts ?? []).map((part) => [createPartMergeKey(part), part]),
    );
    const registeredParts = limitAutoRegisteredParts(
      nextParts.map((part) => mergeAutoRegisteredPart(existingByKey.get(createPartMergeKey(part)), part)),
    ).map(compactRegisteredPartForPersistence);
    if (areRegisteredPartListsEquivalent(existingProfile.registeredParts, registeredParts)) {
      return;
    }

    this.ps.updateModelProfile(modelPath, (_existing) => ({ registeredParts }));
  }

  private clearDeferredEvidenceRegistration(): void {
    if (this.evidenceRegistrationTimer !== null) {
      window.clearTimeout(this.evidenceRegistrationTimer);
      this.evidenceRegistrationTimer = null;
    }
  }

  private clearRegisteredMatchPreview(): void {
    if (this.registeredMatchPreviewTimer !== null) {
      window.clearTimeout(this.registeredMatchPreviewTimer);
      this.registeredMatchPreviewTimer = null;
    }
  }

  private scheduleDeferredEvidenceRegistration(modelPath: string, generation: number, summary: ModelPreviewSummary): void {
    this.clearDeferredEvidenceRegistration();
    if (!shouldAutoCaptureEvidence(summary)) {
      this.workbenchEvidenceModelPath = modelPath;
      this.workbenchEvidence = null;
      this.refreshWorkbenchPanel();
      log.info("skip automatic evidence capture for very large model", {
        modelPath,
        performanceTier: summary.performanceTier,
        meshCount: summary.meshCount,
        triangleCount: summary.triangleCount,
      });
      return;
    }

    this.evidenceRegistrationTimer = window.setTimeout(() => {
      this.evidenceRegistrationTimer = null;
      if (generation !== this.loadGeneration || this.workbenchModelPath !== modelPath) {
        return;
      }

      void (async () => {
        const evidence = this.getCurrentModelEvidence();
        await this.registerModelPartsFromEvidence(modelPath, evidence);
        if (generation === this.loadGeneration && this.workbenchModelPath === modelPath) {
          this.refreshWorkbenchPanel();
        }
      })().catch((error) => {
        console.warn("[AI3D] Deferred model evidence capture failed:", error);
      });
    }, getDeferredEvidenceDelay(summary));
  }

  private getCurrentModelEvidence(): ModelEvidence | null {
    const modelPath = this.workbenchModelPath;
    if (modelPath && this.workbenchEvidenceModelPath === modelPath) {
      return this.workbenchEvidence;
    }

    const evidence = this.preview?.getModelEvidence?.() ?? null;
    const nextEvidence = evidence
      ? applyEvidenceFormatLineage(evidence, this.workbenchEvidenceLineage, this.workbenchSourceWarnings)
      : null;
    if (modelPath) {
      this.workbenchEvidenceModelPath = modelPath;
      this.workbenchEvidence = nextEvidence;
    }
    return nextEvidence;
  }

  private getCachedModelEvidence(modelPath: string): ModelEvidence | null {
    return this.workbenchEvidenceModelPath === modelPath ? this.workbenchEvidence : null;
  }

  private createKnowledgePreviewAdapter(): Pick<AnnotationPreview, "captureSnapshot" | "getModelEvidence"> | null {
    if (!this.preview) {
      return null;
    }
    return {
      captureSnapshot: () => this.preview?.captureSnapshot() ?? null,
      getModelEvidence: () => this.getCurrentModelEvidence(),
    };
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
    this.clearRegisteredMatchPreview();
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
        .then(({ generateKnowledgeNote }) => generateKnowledgeNote(this.app, this.ps, { preview: this.createKnowledgePreviewAdapter() }))
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

    const cachedEvidence = this.getCachedModelEvidence(modelPath);
    const evidence = cachedEvidence ? createMatchPreviewEvidence(cachedEvidence) : null;
    if (!evidence?.parts.length) {
      if (this.workbenchEvidenceModelPath === modelPath) {
        renderEmpty("directWorkbench.registeredUnavailable");
      } else {
        body.createDiv({ cls: "ai3d-direct-workbench-empty", text: t("directWorkbench.registeredLoading") });
      }
      return;
    }

    const previewDelay = getRegisteredMatchPreviewDelay(summary);
    if (previewDelay === null) {
      renderEmpty("directWorkbench.registeredUnavailable");
      return;
    }

    this.registeredMatchPreviewTimer = window.setTimeout(() => {
      this.registeredMatchPreviewTimer = null;
      if (generation !== this.loadGeneration || this.workbenchModelPath !== modelPath || !control.isConnected) {
        return;
      }

      void Promise.all([
        import("./workbench/knowledge-note"),
        import("./workbench/analysis-result"),
        import("./direct-workbench-registered-match"),
      ])
        .then(async ([{ collectRegisteredPartsFromProfiles }, { buildLocalAnalysisResult }, { renderRegisteredPartMatchRow }]) => {
          const state = this.ps.store.getState();
          const registeredParts = await collectRegisteredPartsFromProfiles(this.app, state.modelAssetProfiles, modelPath, {
            includeSidecars: false,
            maxParts: MAX_MATCH_PREVIEW_REGISTERED_PARTS,
          });
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
    }, previewDelay);
  }

  private async createPreviewWithFallback(
    canvas: HTMLCanvasElement,
    dataPromise: Promise<ArrayBuffer>,
    source: ReturnType<typeof toPreviewSource>,
    options: DirectViewPreviewOptions,
    modelPath: string,
    settings: PluginSettings,
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
    this.applyConfiguredRenderQuality(created.preview, settings);

    let data: ArrayBuffer;
    try {
      data = await dataPromise;
    } catch (error) {
      created.preview.destroy();
      throw error;
    }

    try {
      const summary = await created.preview.loadModel(data, source.ext, (path) => readBinaryPath(this.app, path), source.path);
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
      this.applyConfiguredRenderQuality(fallback.preview, settings);
      try {
        const summary = await fallback.preview.loadModel(data, source.ext, (path) => readBinaryPath(this.app, path), source.path);
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

  private applyConfiguredRenderQuality(preview: AnnotationPreview, settings: PluginSettings): void {
    preview.setRenderQuality?.(settings.renderQuality, settings.renderScale);
  }

  private applyLargeModelRenderBudget(
    preview: AnnotationPreview,
    settings: PluginSettings,
    summary: ModelPreviewSummary,
  ): void {
    const budget = getLargeModelQualityBudget(settings, summary);
    preview.setRenderQuality?.(budget.renderQuality, budget.renderScale);
  }
}
