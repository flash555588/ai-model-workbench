import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings, ModelAssetProfile } from "../domain/models";
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
import { t } from "../i18n";
import { renderModelLoadFailure } from "./model-load-feedback";
import { isMobile } from "../utils/device";
import { createLogger } from "../utils/log";

export const DIRECT_VIEW_TYPE = "ai3d-direct-view";

const log = createLogger("direct-view");

function createDefaultProfile(): ModelAssetProfile {
  return { tags: [], notes: "", annotations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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

      const previewOptions = {
        ext: source.ext,
        annotationMode: "edit",
        allowEditModeOnThree: true,
        rendererRollout: settings.previewRendererRollout,
        useThreeRenderer: settings.useThreeRenderer,
      } as const;
      const { preview } = await createLoggedModelPreview<AnnotationPreview>(
        log,
        { surface: "direct-view", modelPath: file.path },
        canvas,
        previewOptions,
      );
      this.preview = preview;
      toolbar?.syncCapabilities();
      loading.setPhaseKey("loading.loadingModel");
      const data = await readBinaryPath(this.app, source.path);
      if (gen !== this.loadGeneration) { this.preview.destroy(); this.preview = null; return; }
      const readFile = async (p: string) => readBinaryPath(this.app, p);
      const summary = await this.preview.loadModel(data, source.ext, readFile, source.path);
      if (gen !== this.loadGeneration) { this.preview.destroy(); this.preview = null; return; }
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
}
