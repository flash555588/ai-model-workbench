/**
 * CM6 ViewPlugin for Live Preview embed rendering.
 * Replaces `![[model.glb]]` syntax with inline 3D preview widgets.
 */

import type { App } from "obsidian";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { Prec, StateField, RangeSet, Range } from "@codemirror/state";
import { isSupportedModelExtension } from "../../io/formats/registry";
import type { PluginSettings, AnnotationPin } from "../../domain/models";
import { AnnotationManager } from "../../render/preview/annotations";
import { createLoggedModelPreview } from "../../render/preview/selection";
import type { ModelPreview } from "../../render/preview/types";
import { supportsAnnotationPreview } from "../../render/preview/types";
import { readBinaryPath, resolveVaultAbsolutePath, resolveVaultPath } from "../../utils/resolve-path";
import { createConversionManager } from "../../io/conversion/factory";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { prepareModelInput } from "../../io/model-pipeline";
import { listPreferredConversionExts } from "../../io/formats/route-preferences";
import { createLoadingOverlay, type LoadingOverlay } from "./loading-overlay";
import { createNoteReader } from "../../utils/note-reader";
import { createStagedDiv, createStagedEl } from "../../utils/dom";
import { describeModelLoadFailure, isMissingConverterError } from "../../io/conversion/errors";
import { isMobile } from "../../utils/device";
import { renderModelLoadFailure } from "../model-load-feedback";
import { t } from "../../i18n";
import { createLogger } from "../../utils/log";

const log = createLogger("inline-live-preview");

// ── Widget ────────────────────────────────────────────────────────

class ModelEmbedWidget extends WidgetType {
  private preview: ModelPreview | null = null;
  private annotationMgr: AnnotationManager | null = null;
  private readyObs: ResizeObserver | null = null;
  private pollId = 0;
  private initStarted = false;
  private destroyed = false;
  private initGeneration = 0;

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
    private previewRendererRollout: PluginSettings["previewRendererRollout"],
    private useThreeRenderer: boolean,
    private convertedAssetCache: ConvertedAssetCache,
    private getAnnotations?: (modelPath: string) => AnnotationPin[],
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
      this.previewRendererRollout === other.previewRendererRollout &&
      this.convertedAssetCache === other.convertedAssetCache
    );
  }

  override toDOM(): HTMLElement {
    const mobile = isMobile();
    const host = createStagedDiv("ai3d-embed-preview ai3d-cm-widget");
    host.setAttribute("contenteditable", "false");
    if (mobile) {
      host.classList.add("is-mobile", "is-mobile-scroll-mode");
    }

    const canvas = createStagedEl("canvas", "ai3d-embed-canvas");
    const effectiveHeight = mobile ? Math.min(this.height, 220) : this.height;
    canvas.style.setProperty("--ai3d-embed-height", `${effectiveHeight}px`);
    host.appendChild(canvas);

    const loading = createLoadingOverlay(host);

    const error = createStagedDiv("ai3d-embed-error is-hidden");
    host.appendChild(error);

    if (mobile) {
      let mobileInteractive = false;
      const footer = createStagedDiv("ai3d-mobile-mode-bar");
      const hint = createStagedDiv("ai3d-mobile-mode-hint");
      hint.textContent = t("livePreview.mobileHint");
      const modeBtn = createStagedEl("button", "ai3d-mobile-mode-btn");
      modeBtn.type = "button";

      const renderInteractionMode = () => {
        host.classList.toggle("is-mobile-interactive", mobileInteractive);
        host.classList.toggle("is-mobile-scroll-mode", !mobileInteractive);
        modeBtn.textContent = mobileInteractive ? t("helper.scrollAction") : t("helper.interactAction");
        modeBtn.classList.toggle("ai3d-btn-active", mobileInteractive);
        modeBtn.setAttribute(
          "aria-label",
          mobileInteractive ? t("helper.disableInteractionLabel") : t("helper.enableInteractionLabel"),
        );
      };

      modeBtn.addEventListener("click", () => {
        mobileInteractive = !mobileInteractive;
        renderInteractionMode();
      });

      renderInteractionMode();
      footer.append(hint, modeBtn);
      host.appendChild(footer);
    }

    const tryInit = () => {
      if (this.destroyed || this.initStarted) return;
      if (!host.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      this.initStarted = true;
      this.stopReadyWatch();
      void this.initPreview(host, canvas, loading, error, ++this.initGeneration);
    };

    this.readyObs = new ResizeObserver(() => tryInit());
    this.readyObs.observe(host);
    this.readyObs.observe(canvas);

    let attempts = 0;
    const poll = () => {
      if (this.destroyed || this.initStarted) return;
      tryInit();
      if (this.initStarted) return;
      if (++attempts > 240) return; // ~4s at 60fps, then rely on resize observer only
      this.pollId = window.requestAnimationFrame(poll);
    };
    this.pollId = window.requestAnimationFrame(poll);

    return host;
  }

  private async initPreview(
    host: HTMLElement,
    canvas: HTMLCanvasElement,
    loading: LoadingOverlay,
    error: HTMLDivElement,
    generation: number,
  ): Promise<void> {
    try {
      const absolutePath = resolveVaultAbsolutePath(this.app, this.modelPath) ?? undefined;
      const conversionManager = createConversionManager({
        enabledConverterIds: this.enabledConverterIds,
        freecadCommand: this.freecadCommand,
        obj2gltfCommand: this.obj2gltfCommand,
        fbx2gltfCommand: this.fbx2gltfCommand,
        freecadcmdCommand: this.freecadcmdCommand,
      });
      loading.setPhaseKey("loading.preparingModel");
      const prepared = await prepareModelInput({
        path: this.modelPath,
        absolutePath,
        preferConversionExts: listPreferredConversionExts({
          preferObj2gltfForObj: this.preferObj2gltfForObj,
          preferFbx2gltfForFbx: this.preferFbx2gltfForFbx,
        }),
        conversionManager,
        convertedAssetCache: this.convertedAssetCache,
      });
      const pins = this.getAnnotations?.(this.modelPath) ?? [];
      const previewOptions = {
        ext: prepared.effectiveExt,
        annotationMode: pins.length > 0 ? "readonly" : "none",
        rendererRollout: this.previewRendererRollout,
        useThreeRenderer: this.useThreeRenderer,
      } as const;
      const { preview } = await createLoggedModelPreview(
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
      loading.setPhaseKey("loading.loadingModel");
      const data = await readBinaryPath(this.app, prepared.effectivePath);
      if (this.destroyed || generation !== this.initGeneration) {
        this.preview?.destroy();
        this.preview = null;
        return;
      }
      await this.preview.loadModel(
        data,
        prepared.effectiveExt,
        (path) => readBinaryPath(this.app, path),
        prepared.effectivePath,
      );
      if (this.destroyed || generation !== this.initGeneration) {
        this.preview?.destroy();
        this.preview = null;
        return;
      }

      if (this.autoRotate) {
        this.preview.applyConfig({
          models: [],
          scene: { autoRotate: true, autoRotateSpeed: 0.5 },
        });
      }

      // Readonly annotations
      if (pins.length > 0 && supportsAnnotationPreview(this.preview)) {
        const provider = this.preview.getAnnotationProvider();
        if (provider.canvas) {
          this.annotationMgr = new AnnotationManager(
            provider,
            host,
            "readonly",
            pins,
            undefined,
            createNoteReader(this.app),
            undefined,
            { app: this.app, previewMode: this.annotationPreviewMode },
          );
        }
      }

      loading.setProgress(100);
      loading.hide();
    } catch (err) {
      if (this.destroyed || generation !== this.initGeneration) {
        return;
      }
      this.preview?.destroy();
      this.preview = null;
      loading.hide();
      error.remove();
      host.replaceChildren();
      const failure = describeModelLoadFailure(err);
      if (isMissingConverterError(err)) {
        console.warn("[AI3D] Live Preview blocked by converter settings:", failure.message);
      } else {
        console.error("[AI3D] Live Preview failed:", err);
      }
      renderModelLoadFailure(host, failure);
    }
  }

  override destroy(): void {
    this.destroyed = true;
    window.cancelAnimationFrame(this.pollId);
    this.pollId = 0;
    this.stopReadyWatch();
    this.annotationMgr?.destroy();
    this.annotationMgr = null;
    if (this.preview) {
      this.preview.destroy();
      this.preview = null;
    }
    this.initStarted = false;
  }

  private stopReadyWatch(): void {
    this.readyObs?.disconnect();
    this.readyObs = null;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// ── Document scanner ──────────────────────────────────────────────

function findEmbeds(
  viewOrState: { state: import("@codemirror/state").EditorState } | import("@codemirror/state").EditorState,
  app: App,
  autoRotate: boolean,
  enabledConverterIds: string[],
  freecadCommand: string,
  obj2gltfCommand: string,
  fbx2gltfCommand: string,
  freecadcmdCommand: string,
  preferObj2gltfForObj: boolean,
  preferFbx2gltfForFbx: boolean,
  annotationPreviewMode: PluginSettings["annotationPreviewMode"],
  previewRendererRollout: PluginSettings["previewRendererRollout"],
  useThreeRenderer: boolean,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
): Range<Decoration>[] {
  const doc = "state" in viewOrState ? viewOrState.state.doc : viewOrState.doc;
  const ranges: Range<Decoration>[] = [];

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    if (!text.includes("![")) continue;

    let pos = 0;
    while (pos < text.length) {
      const start = text.indexOf("![[", pos);
      if (start === -1) break;

      // Skip escaped embeds: \![[model.glb]]
      if (start > 0 && text[start - 1] === "\\") {
        pos = start + 3;
        continue;
      }

      const end = text.indexOf("]]", start + 3);
      if (end === -1) break;

      const raw = text.slice(start + 3, end);
      const parts = raw.split("|");
      const filename = parts[0].trim();

      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      if (!isSupportedModelExtension(ext)) {
        pos = end + 2;
        continue;
      }

      // Parse optional size: ![[model.glb|400x300]]
      let w = 400;
      let h = 300;
      if (parts.length > 1) {
        const sizeMatch = parts[1].trim().match(/^(\d+)\s*x\s*(\d+)$/);
        if (sizeMatch) {
          w = parseInt(sizeMatch[1], 10);
          h = parseInt(sizeMatch[2], 10);
        }
      }

      const modelPath = resolveVaultPath(app, filename);
      if (!modelPath) {
        pos = end + 2;
        continue;
      }

      const from = line.from + start;
      const to = line.from + end + 2;

      ranges.push(
        Decoration.replace({
          widget: new ModelEmbedWidget(
            app,
            modelPath,
            w,
            h,
            autoRotate,
            enabledConverterIds,
            freecadCommand,
            obj2gltfCommand,
            fbx2gltfCommand,
            freecadcmdCommand,
            preferObj2gltfForObj,
            preferFbx2gltfForFbx,
            annotationPreviewMode,
            previewRendererRollout,
            useThreeRenderer,
            convertedAssetCache,
            getAnnotations,
          ),
          block: true,
        }).range(from, to),
      );

      pos = end + 2;
    }
  }

  return ranges;
}

// ── StateField + ViewPlugin ───────────────────────────────────────

type DecoSet = RangeSet<Decoration>;

function toDecoSet(ranges: Range<Decoration>[]): DecoSet {
  if (ranges.length === 0) {
    return RangeSet.empty as DecoSet;
  }
  return RangeSet.of<Decoration>(ranges, true);
}

export function registerLivePreviewExtension(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
) {
  const embedField = StateField.define<DecoSet>({
    create(state): DecoSet {
      const s = getSettings();
      const ranges = findEmbeds(
        state,
        app,
        s.autoRotateDefault,
        s.enabledConverterIds,
        s.freecadCommand,
        s.obj2gltfCommand,
        s.fbx2gltfCommand,
        s.freecadcmdCommand,
        s.preferObj2gltfForObj,
        s.preferFbx2gltfForFbx,
        s.annotationPreviewMode,
        s.previewRendererRollout,
        s.useThreeRenderer,
        convertedAssetCache,
        getAnnotations,
      );
      return toDecoSet(ranges);
    },
    update(value, tr): DecoSet {
      if (tr.docChanged) {
        const s = getSettings();
        const ranges = findEmbeds(
          tr.state,
          app,
          s.autoRotateDefault,
          s.enabledConverterIds,
          s.freecadCommand,
          s.obj2gltfCommand,
          s.fbx2gltfCommand,
          s.freecadcmdCommand,
          s.preferObj2gltfForObj,
          s.preferFbx2gltfForFbx,
          s.annotationPreviewMode,
          s.previewRendererRollout,
          s.useThreeRenderer,
          convertedAssetCache,
          getAnnotations,
        );
        return toDecoSet(ranges);
      }
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [Prec.highest(embedField)];
}
