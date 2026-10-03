import { FileView, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { RegisteredPartsModal } from "./registered-parts-modal";
import type { PluginSettings, ModelPreviewSummary, ModelEvidence, ModelEvidenceFormatLineage, ModelPartSummary, PartRecord } from "../domain/models";
import type { AnnotationManager } from "../render/preview/annotations";
import { createLoggedModelPreview } from "../render/preview/selection";
import type { AnnotationPreview } from "../render/preview/types";
import {
  isPreviewLoadInterruptedError,
  throwIfPreviewLoadInterrupted,
  type PreviewLoadOptions,
} from "../render/preview/load-control";
import { createHelperButtons } from "./inline/helper-buttons";
import type { ConvertedAssetCache } from "../io/cache/converted-asset-cache";
import type { PluginStore } from "../store/plugin-store";
import { prepareModelInput } from "../io/model-pipeline";
import { toPreviewSource, type PreviewSource } from "../io/preview/preview-source";
import { readBinaryPath, resolveVaultAbsolutePath } from "../utils/resolve-path";
import { listPreferredConversionExts } from "../io/formats/route-preferences";
import { resolveConversionOutputRoot } from "../io/conversion/output-root";
import { createLoadingOverlay } from "./inline/loading-overlay";
import { describeModelLoadFailure, isMissingConverterError } from "../io/conversion/errors";
import { formatT, t } from "../i18n";
import { renderModelLoadFailure, renderModelPerformanceFeedback } from "./model-load-feedback";
import { isMobile } from "../utils/device";
import { createLogger } from "../utils/log";
import { compactRegisteredPartForPersistence, rankRegisteredPart } from "../utils/registered-part-persistence";
import {
  buildRegisteredPartMatchReviewQueue,
  upsertRegisteredPartMatchReview,
} from "../utils/registered-match-review";
import { inferModelAssetFormat } from "./workbench/format-lineage";
import { createDirectViewLayout } from "./direct-view-layout";
import { attachDirectSidebarResize } from "./direct-view-sidebar";
import { markDirectViewDom, unmarkDirectViewDom } from "./direct-view-dom";
import { renderDirectWorkbenchOverview } from "./direct-workbench-panel";
import { getDirectKnowledgeState } from "./direct-workbench-knowledge";
import { getKnowledgeGenerationProgress, subscribeKnowledgeGenerationProgress } from "./workbench/knowledge-generation-progress";
import { createDirectViewPreviewOptions, shouldPrepareThreeDirectFileView, type DirectViewPreviewOptions } from "./direct-view-routing";
import { supportsBabylonDirectFormat } from "../io/formats/renderer-support";
import { DIRECT_VIEW_TYPE } from "./direct-view-type";
import {
  getPreviewPathRenderBudget,
  getSummaryRenderBudget,
  type RenderQualityBudget,
} from "./model-render-budget";

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
const MAX_VISIBLE_REGISTERED_MATCH_ROWS = 12;
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

function limitAutoRegisteredParts(parts: PartRecord[]): PartRecord[] {
  if (parts.length <= MAX_AUTO_REGISTERED_PARTS) {
    return parts;
  }

  return [...parts]
    .sort((left, right) => {
      const rankDelta = rankRegisteredPart(left) - rankRegisteredPart(right);
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
  private registeredPartsModal: RegisteredPartsModal | null = null;
  private previewHost: HTMLElement | null = null;
  private toolbar: ReturnType<typeof createHelperButtons> | null = null;
  private annotationMgr: AnnotationManager | null = null;
  private annotationMode = false;
  private loadGeneration = 0;
  private activeLoadController: AbortController | null = null;
  private getSettings: () => PluginSettings;
  private convertedAssetCache: ConvertedAssetCache;
  private ps: PluginStore;
  private releaseSidebarResize: (() => void) | null = null;
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
  private knowledgeControls: HTMLElement | null = null;
  private knowledgeStartingModelPath: string | null = null;
  private knowledgeError: { modelPath: string; message: string } | null = null;
  private knowledgeOpenError: { modelPath: string; message: string } | null = null;

  constructor(leaf: WorkspaceLeaf, getSettings: () => PluginSettings, convertedAssetCache: ConvertedAssetCache, ps: PluginStore) {
    super(leaf);
    this.getSettings = getSettings;
    this.convertedAssetCache = convertedAssetCache;
    this.ps = ps;
    let lastGeneration = ps.store.getState().lastKnowledgeGeneration;
    let lastRegisteredParts: readonly PartRecord[] | undefined;
    this.register(ps.store.subscribe(() => {
      const parts = this.workbenchModelPath ? ps.store.getState().modelAssetProfiles[this.workbenchModelPath]?.registeredParts : undefined;
      if (parts !== lastRegisteredParts) {
        lastRegisteredParts = parts;
        this.refreshWorkbenchPanel();
      }
      const record = ps.store.getState().lastKnowledgeGeneration;
      if (record === lastGeneration) return;
      lastGeneration = record;
      if (record && this.knowledgeError && record.modelPath === this.knowledgeError.modelPath && record.status !== "failed") {
        this.knowledgeError = null;
      }
      this.refreshKnowledgeControls();
    }));
    this.register(subscribeKnowledgeGenerationProgress(ps, () => {
      if (getKnowledgeGenerationProgress(ps)?.modelPath === this.knowledgeStartingModelPath) {
        this.knowledgeStartingModelPath = null;
      }
      this.refreshKnowledgeControls();
    }));
    const refreshRemovedKnowledge = (path: string): void => {
      const modelPath = this.workbenchModelPath;
      const profile = modelPath ? ps.store.getState().modelAssetProfiles[modelPath] : null;
      if (path === profile?.reportNotePath || path === profile?.knowledgeIndexPath) this.refreshKnowledgeControls();
    };
    this.registerEvent(this.app.vault.on("delete", file => refreshRemovedKnowledge(file.path)));
    this.registerEvent(this.app.vault.on("create", file => refreshRemovedKnowledge(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      refreshRemovedKnowledge(oldPath);
      refreshRemovedKnowledge(file.path);
    }));
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
    markDirectViewDom(this.contentEl);

    if (this.file) {
      await this.loadModel(this.file);
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.registeredPartsModal?.close();
    this.contentEl.empty();
    markDirectViewDom(this.contentEl);
    await this.loadModel(file);
  }

  onClose(): Promise<void> {
    this.registeredPartsModal?.close();
    this.toolbar?.destroy();
    this.toolbar = null;
    this.previewHost = null;
    this.workbenchPanel = null;
    this.sidebarContent = null;
    this.workbenchModelPath = null;
    unmarkDirectViewDom(this.contentEl);
    this.loadGeneration++;
    this.activeLoadController?.abort();
    this.activeLoadController = null;
    this.clearDeferredEvidenceRegistration();
    this.clearRegisteredMatchPreview();
    this.releaseSidebarResize?.();
    this.releaseSidebarResize = null;
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.preview?.destroy();
    this.preview = null;
    return Promise.resolve();
  }

  private async loadModel(file: TFile): Promise<void> {
    this.registeredPartsModal?.close();
    this.toolbar?.destroy();
    this.toolbar = null;
    this.previewHost = null;
    this.releaseSidebarResize?.();
    this.releaseSidebarResize = null;
    markDirectViewDom(this.contentEl);
    this.activeLoadController?.abort();
    const loadController = new AbortController();
    this.activeLoadController = loadController;
    const gen = ++this.loadGeneration;
    const loadOptions: PreviewLoadOptions = {
      signal: loadController.signal,
      isCurrent: () => this.loadGeneration === gen
        && this.activeLoadController === loadController
        && !loadController.signal.aborted,
    };
    const mobile = isMobile();
    this.clearDeferredEvidenceRegistration();
    this.clearRegisteredMatchPreview();
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    this.workbenchPanel = null;
    this.annotationMode = false;
    this.workbenchSummary = null;
    this.workbenchRoute = null;
    this.workbenchModelPath = null;
    this.workbenchEvidenceLineage = null;
    this.workbenchSourceWarnings = [];
    this.workbenchEvidenceModelPath = null;
    this.workbenchEvidence = null;
    this.sidebarContent = null;
    this.knowledgeControls = null;
    this.knowledgeStartingModelPath = null;
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
    this.toolbar = toolbar;
    this.previewHost = host;
    this.sidebarContent = sidebarContent;
    this.workbenchPanel = workbenchPanel;
    this.releaseSidebarResize = attachDirectSidebarResize(hHandle, topTrack, workspace);
    const loading = createLoadingOverlay(host);
    try {
      const settings = this.getSettings();
      const absolutePath = resolveVaultAbsolutePath(this.app, file.path) ?? undefined;
      const conversionOutputRoot = resolveConversionOutputRoot(this.app, settings);
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
        allowThreeDirect: shouldPrepareThreeDirectFileView(settings, file.extension),
      });
      throwIfPreviewLoadInterrupted(loadOptions);
      const source = toPreviewSource(prepared);
      this.workbenchEvidenceLineage = createEvidenceFormatLineage(source);
      this.workbenchSourceWarnings = [...source.warnings];

      const basePreviewOptions = createDirectViewPreviewOptions(settings, source);
      toolbar?.syncCapabilities();
      loading.setPhaseKey("loading.loadingModel");
      const dataPromise = readBinaryPath(this.app, source.path, { signal: loadController.signal });
      const initialRenderBudgetPromise = getPreviewPathRenderBudget(this.app, source.path, settings);
      void dataPromise.catch(() => undefined);
      void initialRenderBudgetPromise.catch(() => undefined);
      const created = await this.createPreviewWithFallback(
        canvas,
        dataPromise,
        initialRenderBudgetPromise,
        source,
        basePreviewOptions,
        file.path,
        loadOptions,
      );
      throwIfPreviewLoadInterrupted(loadOptions);
      this.preview = created.preview;
      host.dataset.ai3dBackend = created.route.backend;
      host.dataset.ai3dRouteReason = created.route.reason;
      toolbar?.syncCapabilities();
      const summary = created.summary;
      this.applyLargeModelRenderBudget(created.preview, settings, summary);
      toolbar?.syncCapabilities();
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
      if (isPreviewLoadInterruptedError(err) || gen !== this.loadGeneration) return;
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
      if (this.activeLoadController === loadController) {
        this.activeLoadController = null;
      }
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
    const preview = this.preview;
    if (!preview) {
      return null;
    }
    const evidence = this.getCurrentModelEvidence();
    let snapshot: string | null = null;
    let snapshotFailed = false;
    let snapshotError: unknown;
    try {
      snapshot = preview.captureSnapshot();
    } catch (error) {
      snapshotFailed = true;
      snapshotError = error;
    }
    return {
      captureSnapshot: () => {
        if (snapshotFailed) throw snapshotError;
        return snapshot;
      },
      getModelEvidence: () => evidence,
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
    this.knowledgeControls = this.sidebarContent.createDiv({ cls: "ai3d-direct-workbench-knowledge-host" });
    this.renderKnowledgeControls(this.knowledgeControls, modelPath);
    const section = this.sidebarContent.createDiv({ cls: "ai3d-registered-parts-entry" });
    const parts = this.ps.store.getState().modelAssetProfiles[modelPath]?.registeredParts ?? [];
    section.createEl("h4", { text: t("registeredDisplay.title") });
    section.createEl("p", { text: parts.length ? t("registeredDisplay.entryHint") : t("registeredDisplay.empty") });
    const open = section.createEl("button", { text: t("registeredDisplay.open"), attr: { type: "button", "data-ai3d-action": "show-registered-parts", "aria-haspopup": "dialog" } });
    open.disabled = !parts.length || !this.preview?.createRegisteredPartDisplay;
    open.addEventListener("click", () => this.openRegisteredParts(open));
    this.renderRegisteredPartMatches(this.sidebarContent, modelPath, summary);
  }

  private openRegisteredParts(trigger: HTMLButtonElement): void {
    const parts = this.workbenchModelPath ? this.ps.store.getState().modelAssetProfiles[this.workbenchModelPath]?.registeredParts : undefined;
    if (this.registeredPartsModal || !this.previewHost || !this.preview || !parts?.length) return;
    this.toolbar?.exitInteractionMode();
    this.annotationMgr?.hideEditor();
    const modal = new RegisteredPartsModal(this.app, this.previewHost, this.preview, parts, () => {
      this.registeredPartsModal = null;
      this.toolbar?.syncCapabilities();
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    });
    this.registeredPartsModal = modal;
    try { modal.open(); } catch (error) {
      modal.close();
      log.warn("registered part display failed", { error: error instanceof Error ? error.message : String(error) });
      new Notice(t("registeredDisplay.failed"));
    }
  }
  private refreshWorkbenchPanel(): void {
    if (!this.workbenchPanel || !this.workbenchSummary || !this.workbenchRoute || !this.workbenchModelPath) {
      return;
    }
    this.renderWorkbenchPanel(this.workbenchPanel, this.workbenchSummary, this.workbenchRoute, this.workbenchModelPath);
    this.renderSidebarContent(this.workbenchModelPath, this.workbenchSummary);
  }
  private renderKnowledgeControls(parent: HTMLElement, modelPath: string): void {
    parent.empty();
    const storeState = this.ps.store.getState();
    const profile = storeState.modelAssetProfiles[modelPath];
    const reportExists = !!profile?.reportNotePath && this.app.vault.getAbstractFileByPath(profile.reportNotePath) instanceof TFile;
    const indexExists = !!profile?.knowledgeIndexPath && this.app.vault.getAbstractFileByPath(profile.knowledgeIndexPath) instanceof TFile;
    const availableProfile = profile ? { ...profile,
      reportNotePath: reportExists ? profile.reportNotePath : undefined,
      knowledgeIndexPath: indexExists ? profile.knowledgeIndexPath : undefined,
    } : undefined;
    const error = this.knowledgeError?.modelPath === modelPath ? this.knowledgeError.message : undefined;
    const state = getDirectKnowledgeState({
      modelPath,
      profile: availableProfile,
      record: storeState.lastKnowledgeGeneration,
      progress: getKnowledgeGenerationProgress(this.ps),
      starting: this.knowledgeStartingModelPath === modelPath,
      error,
    });
    const control = parent.createDiv({ cls: "ai3d-direct-workbench-control ai3d-direct-workbench-knowledge" });
    control.dataset.ai3dKnowledgeStatus = state.status;
    control.setAttribute("aria-busy", String(state.status === "generating"));
    control.createDiv({ cls: "ai3d-direct-workbench-label", text: t("directWorkbench.knowledgeTitle") });
    control.createDiv({
      cls: "ai3d-direct-workbench-value ai3d-direct-workbench-knowledge-status",
      text: state.message,
      attr: { role: "status", "aria-live": "polite" },
    });
    if (error && state.status === "failed") {
      control.createDiv({ cls: "ai3d-direct-workbench-error", text: error });
    }
    if (this.knowledgeOpenError?.modelPath === modelPath) {
      control.createDiv({ cls: "ai3d-direct-workbench-error ai3d-direct-workbench-open-error", text: this.knowledgeOpenError.message, attr: { role: "alert" } });
    }
    if ((!reportExists && profile?.reportNotePath) || (!indexExists && profile?.knowledgeIndexPath)) {
      control.createDiv({ cls: "ai3d-direct-workbench-evidence-hint", text: t("directWorkbench.savedNoteMissing") });
    }
    control.createDiv({ cls: "ai3d-direct-workbench-evidence-hint", text: t("directWorkbench.evidenceHint") });

    const actions = control.createDiv({ cls: "ai3d-direct-workbench-actions" });
    const generateButton = actions.createEl("button", {
      cls: `ai3d-direct-workbench-action${state.primary === "generate-note" ? " is-primary" : ""}`,
      text: state.generateLabel,
      attr: { type: "button", "data-ai3d-action": "generate-note" },
    });
    generateButton.disabled = state.generateDisabled;
    generateButton.addEventListener("click", () => {
      const loadGeneration = this.loadGeneration;
      const summary = this.workbenchSummary;
      this.knowledgeStartingModelPath = modelPath;
      this.knowledgeError = null;
      this.knowledgeOpenError = null;
      this.refreshKnowledgeControls();
      let preview: ReturnType<DirectModelView["createKnowledgePreviewAdapter"]>;
      try {
        preview = this.createKnowledgePreviewAdapter();
      } catch (error) {
        this.knowledgeStartingModelPath = null;
        this.knowledgeError = { modelPath, message: error instanceof Error ? error.message : String(error) };
        this.refreshKnowledgeControls();
        return;
      }
      void import("./workbench/knowledge-note")
        .then(({ generateKnowledgeNote }) => generateKnowledgeNote(this.app, this.ps, { preview, modelPath, modelPreview: summary }))
        .catch((err) => {
          console.error("[AI3D] Generate knowledge note failed:", err);
          if (loadGeneration === this.loadGeneration && this.workbenchModelPath === modelPath) {
            this.knowledgeError = { modelPath, message: err instanceof Error ? err.message : String(err) };
          }
        })
        .finally(() => {
          if (loadGeneration === this.loadGeneration && this.workbenchModelPath === modelPath) {
            this.knowledgeStartingModelPath = null;
            this.refreshKnowledgeControls();
          }
        });
    });

    const openButton = actions.createEl("button", {
      cls: `ai3d-direct-workbench-action${state.primary === "open-note" ? " is-primary" : ""}`,
      text: t("workbench.openNoteAction"),
      attr: { type: "button", "data-ai3d-action": "open-note" },
    });
    openButton.disabled = !reportExists;
    openButton.addEventListener("click", () => {
      const reportPath = this.ps.store.getState().modelAssetProfiles[modelPath]?.reportNotePath;
      if (!reportPath) return;
      this.openKnowledgeFile(modelPath, reportPath);
    });

    const openIndexButton = actions.createEl("button", {
      cls: `ai3d-direct-workbench-action${state.primary === "open-index" ? " is-primary" : ""}`,
      text: t("workbench.openIndexAction"),
      attr: { type: "button", "data-ai3d-action": "open-index" },
    });
    openIndexButton.disabled = !indexExists;
    openIndexButton.addEventListener("click", () => {
      const indexPath = this.ps.store.getState().modelAssetProfiles[modelPath]?.knowledgeIndexPath;
      if (!indexPath) return;
      this.openKnowledgeFile(modelPath, indexPath);
    });
  }

  private openKnowledgeFile(modelPath: string, path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    this.knowledgeOpenError = null;
    if (!(file instanceof TFile)) {
      this.refreshKnowledgeControls();
      return;
    }
    const generation = this.loadGeneration;
    void (async () => {
      try {
        await this.app.workspace.getLeaf(true).openFile(file, { active: true });
      } catch (error) {
        if (generation !== this.loadGeneration || modelPath !== this.workbenchModelPath) return;
        this.knowledgeOpenError = { modelPath, message: formatT("directWorkbench.openSavedNoteFailed", {
          message: error instanceof Error ? error.message : String(error),
        }) };
        this.refreshKnowledgeControls();
      }
    })();
    this.refreshKnowledgeControls();
  }

  private refreshKnowledgeControls(): void {
    if (this.knowledgeControls?.isConnected && this.workbenchModelPath) {
      this.renderKnowledgeControls(this.knowledgeControls, this.workbenchModelPath);
    }
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
          const matchRows = buildRegisteredPartMatchReviewQueue(analysis.parts);

          if (matchRows.length === 0) {
            renderEmpty("directWorkbench.registeredEmpty");
            return;
          }

          status.setText(formatT("directWorkbench.registeredCount", { count: String(matchRows.length) }));
          const renderRows = (visibleRows: typeof matchRows): void => {
            body.empty();
            const list = body.createDiv({ cls: "ai3d-direct-workbench-match-list" });
            for (const { currentPartId, currentPartName, match } of visibleRows) {
              const row = renderRegisteredPartMatchRow(list, currentPartName, match);
              for (const reviewButton of Array.from(row.querySelectorAll("[data-ai3d-action='review-registered-part']"))) {
                if (!reviewButton.instanceOf(HTMLButtonElement)) continue;
                reviewButton.addEventListener("click", () => {
                  const requestedDecision = reviewButton.dataset.ai3dReviewDecision;
                  const decision = requestedDecision === "confirmed" || requestedDecision === "rejected"
                    ? requestedDecision
                    : null;
                  this.ps.updateModelProfile(modelPath, (existing) => ({
                    registeredMatchReviews: upsertRegisteredPartMatchReview(
                      existing.registeredMatchReviews,
                      {
                        currentPartId,
                        sourceAssetId: match.sourceAssetId,
                        sourcePartId: match.sourcePartId,
                      },
                      decision,
                    ),
                  }));
                  this.refreshWorkbenchPanel();
                });
              }
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
            if (visibleRows.length < matchRows.length) {
              const showAllButton = body.createEl("button", {
                cls: "ai3d-direct-workbench-action ai3d-direct-workbench-match-show-all",
                text: formatT("directWorkbench.registeredShowAll", { count: String(matchRows.length) }),
                attr: { type: "button" },
              });
              showAllButton.addEventListener("click", () => renderRows(matchRows));
            }
          };
          renderRows(matchRows.slice(0, MAX_VISIBLE_REGISTERED_MATCH_ROWS));
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
    initialRenderBudgetPromise: Promise<RenderQualityBudget>,
    source: ReturnType<typeof toPreviewSource>,
    options: DirectViewPreviewOptions,
    modelPath: string,
    loadOptions: PreviewLoadOptions,
  ): Promise<{
      preview: AnnotationPreview;
      summary: Awaited<ReturnType<AnnotationPreview["loadModel"]>>;
      route: Awaited<ReturnType<typeof createLoggedModelPreview<AnnotationPreview>>>["route"];
    }> {
    throwIfPreviewLoadInterrupted(loadOptions);
    const created = await createLoggedModelPreview<AnnotationPreview>(
      log,
      { surface: "direct-view", modelPath },
      canvas,
      options,
    );
    try {
      throwIfPreviewLoadInterrupted(loadOptions);
    } catch (error) {
      created.preview.destroy();
      throw error;
    }
    let initialRenderBudget: RenderQualityBudget;
    try {
      initialRenderBudget = await initialRenderBudgetPromise;
      throwIfPreviewLoadInterrupted(loadOptions);
    } catch (error) {
      created.preview.destroy();
      throw error;
    }
    this.applyRenderBudget(created.preview, initialRenderBudget);

    let data: ArrayBuffer;
    try {
      data = await dataPromise;
      throwIfPreviewLoadInterrupted(loadOptions);
    } catch (error) {
      created.preview.destroy();
      throw error;
    }

    try {
      const summary = await created.preview.loadModel(
        data,
        source.ext,
        (path) => readBinaryPath(this.app, path, { signal: loadOptions.signal }),
        source.path,
        loadOptions,
      );
      throwIfPreviewLoadInterrupted(loadOptions);
      return { preview: created.preview, summary, route: created.route };
    } catch (error) {
      created.preview.destroy();
      if (isPreviewLoadInterruptedError(error)) {
        throw error;
      }
      if (created.route.backend !== "three" || !supportsBabylonDirectFormat(source.ext)) {
        throw error;
      }
      throwIfPreviewLoadInterrupted(loadOptions);
      console.warn("[AI3D] Three direct view failed; falling back to Babylon:", error);
      const fallbackOptions = {
        ...options,
        allowWorkbenchFeaturesOnThree: false,
        rendererRollout: "babylon-safe",
        useThreeRenderer: false,
      } as const;
      const fallback = await createLoggedModelPreview<AnnotationPreview>(
        log,
        { surface: "direct-view-fallback", modelPath },
        canvas,
        fallbackOptions,
      );
      this.applyRenderBudget(fallback.preview, initialRenderBudget);
      try {
        throwIfPreviewLoadInterrupted(loadOptions);
        const summary = await fallback.preview.loadModel(
          data,
          source.ext,
          (path) => readBinaryPath(this.app, path, { signal: loadOptions.signal }),
          source.path,
          loadOptions,
        );
        throwIfPreviewLoadInterrupted(loadOptions);
        return { preview: fallback.preview, summary, route: fallback.route };
      } catch (fallbackError) {
        fallback.preview.destroy();
        if (isPreviewLoadInterruptedError(fallbackError)) {
          throw fallbackError;
        }
        if (isMissingExternalModelResourceError(error)) {
          throw error;
        }
        throw fallbackError;
      }
    }
  }

  private applyRenderBudget(preview: AnnotationPreview, budget: RenderQualityBudget): void {
    preview.setRenderQuality?.(budget.renderQuality, budget.renderScale);
  }

  private applyLargeModelRenderBudget(
    preview: AnnotationPreview,
    settings: PluginSettings,
    summary: ModelPreviewSummary,
  ): void {
    const budget = getSummaryRenderBudget(settings, summary);
    preview.setRenderQuality?.(budget.renderQuality, budget.renderScale);
  }
}
