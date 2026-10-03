/**
 * Lightweight CM6 extension for Live Preview embeds.
 * The full model widget is imported only when an embed approaches the viewport.
 */

import { editorInfoField, editorLivePreviewField, type App } from "obsidian";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { Prec, StateField, RangeSet, type Range, type Text } from "@codemirror/state";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { NotePartsAccess } from "./note-parts-config";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { resolveVaultPath } from "../../utils/resolve-path";
import {
  docMayContainModelEmbed,
  transactionMayAffectModelEmbeds,
} from "./live-preview-embed-scan";
import {
  createLivePreviewPathResolverCache,
  type LivePreviewPathResolverCache,
} from "./live-preview-path-cache";
import { createStagedEl } from "../../utils/dom";
import { scanModelEmbeds } from "./model-embed-syntax";

type LivePreviewModule = typeof import("./live-preview");
type LivePreviewWidget = InstanceType<LivePreviewModule["ModelEmbedWidget"]>;

let livePreviewModulePromise: Promise<LivePreviewModule> | null = null;

function loadLivePreviewModule(): Promise<LivePreviewModule> {
  livePreviewModulePromise ??= import("./live-preview");
  return livePreviewModulePromise;
}

export class LazyModelEmbedWidget extends WidgetType {
  private mountedWidget: LivePreviewWidget | null = null;
  private mountedDom: HTMLElement | null = null;
  private viewportObs: IntersectionObserver | null = null;
  private destroyed = false;
  private mountGeneration = 0;

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

  override eq(other: LazyModelEmbedWidget): boolean {
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

  override get estimatedHeight(): number { return this.height; }

  override toDOM(): HTMLElement {
    // CM keeps decoration values when a line leaves the viewport, then reuses
    // the WidgetType to build fresh DOM on return. Each mount has its own lifetime.
    this.destroyed = false;
    const generation = ++this.mountGeneration;
    const placeholder = createStagedEl("span", "ai3d-image-embed ai3d-cm-widget ai3d-embed-preview-lazy");
    placeholder.style.width = `${this.width}px`;
    placeholder.setAttribute("contenteditable", "false");
    placeholder.style.setProperty("--ai3d-embed-height", `${this.height}px`);

    this.watchViewport(placeholder, generation);
    return placeholder;
  }

  override destroy(): void {
    this.destroyed = true;
    this.mountGeneration++;
    this.stopViewportWatch();
    this.stopRemovalWatch();
    this.mountedWidget?.destroy();
    this.mountedWidget = null;
    this.mountedDom?.remove();
    this.mountedDom = null;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  private watchViewport(placeholder: HTMLElement, generation: number): void {
    if (typeof IntersectionObserver === "undefined") {
      void this.mount(placeholder, generation);
      return;
    }

    this.viewportObs = new IntersectionObserver((entries) => {
      if (this.destroyed || generation !== this.mountGeneration || this.mountedWidget) return;
      if (!entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) return;
      this.stopViewportWatch();
      void this.mount(placeholder, generation);
    }, { rootMargin: "240px" });
    this.viewportObs.observe(placeholder);
  }

  private stopViewportWatch(): void {
    this.viewportObs?.disconnect();
    this.viewportObs = null;
  }

  private removalObserver: MutationObserver | null = null;

  private stopRemovalWatch(): void {
    this.removalObserver?.disconnect();
    this.removalObserver = null;
  }

  private async mount(placeholder: HTMLElement, generation: number): Promise<void> {
    let module: LivePreviewModule;
    try {
      module = await loadLivePreviewModule();
    } catch (error) {
      console.warn("[AI3D] Failed to load Live Preview widget runtime:", error);
      if (!this.destroyed && generation === this.mountGeneration && placeholder.isConnected) {
        placeholder.textContent = "Ai3d live preview failed to load.";
      }
      return;
    }

    const widget = new module.ModelEmbedWidget(
      this.app,
      this.modelPath,
      this.width,
      this.height,
      this.autoRotate,
      this.enabledConverterIds,
      this.freecadCommand,
      this.obj2gltfCommand,
      this.fbx2gltfCommand,
      this.freecadcmdCommand,
      this.preferObj2gltfForObj,
      this.preferFbx2gltfForFbx,
      this.annotationPreviewMode,
      this.annotationDisplayMode,
      this.previewRendererRollout,
      this.useThreeRenderer,
      this.auxiliaryFileFolder,
      this.renderQuality,
      this.renderScale,
      this.convertedAssetCache,
      this.getAnnotations,
      this.getToolbarSettings,
      this.partsAccess,
    );

    if (this.destroyed || generation !== this.mountGeneration || !placeholder.isConnected) {
      widget.destroy();
      return;
    }

    const mountedDom = widget.toDOM();
    if (this.destroyed || generation !== this.mountGeneration || !placeholder.isConnected) {
      widget.destroy();
      return;
    }

    this.mountedWidget = widget;
    this.mountedDom = mountedDom;
    // CodeMirror owns the returned root. Replacing it makes the new DOM look
    // like an editor mutation and can insert toolbar text into the document.
    placeholder.className = "ai3d-image-embed ai3d-cm-widget";
    placeholder.style.removeProperty("--ai3d-embed-height");
    placeholder.replaceChildren(mountedDom);
    // Rendered table embeds can outlive Obsidian's render-child unload callback.
    // Watch the editor-owned root, which stays in the note when the frame moves.
    if (typeof MutationObserver !== "undefined" && placeholder.ownerDocument?.body) {
      this.stopRemovalWatch();
      this.removalObserver = new MutationObserver(() => {
        if (generation === this.mountGeneration && !placeholder.isConnected) this.destroy();
      });
      this.removalObserver.observe(placeholder.ownerDocument.body, { childList: true, subtree: true });
    }
  }
}

export function createImageEmbedWidget(
  app: App,
  settings: PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  modelPath: string,
  size: { width: number; height: number },
  getAnnotations?: (modelPath: string) => AnnotationPin[],
  getToolbarSettings?: () => PluginSettings,
  partsAccess?: NotePartsAccess,
): LazyModelEmbedWidget {
  return new LazyModelEmbedWidget(
    app, modelPath, size.width, size.height, settings.autoRotateDefault,
    settings.enabledConverterIds, settings.freecadCommand, settings.obj2gltfCommand,
    settings.fbx2gltfCommand, settings.freecadcmdCommand, settings.preferObj2gltfForObj,
    settings.preferFbx2gltfForFbx, settings.annotationPreviewMode,
    settings.annotationDisplayMode, settings.previewRendererRollout, settings.useThreeRenderer,
    settings.auxiliaryFileFolder, settings.renderQuality, settings.renderScale,
    convertedAssetCache, getAnnotations, getToolbarSettings, partsAccess,
  );
}

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
  annotationDisplayMode: PluginSettings["annotationDisplayMode"],
  previewRendererRollout: PluginSettings["previewRendererRollout"],
  useThreeRenderer: boolean,
  auxiliaryFileFolder: string,
  renderQuality: PluginSettings["renderQuality"],
  renderScale: PluginSettings["renderScale"],
  convertedAssetCache: ConvertedAssetCache,
  resolvedPathCache: LivePreviewPathResolverCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
  getToolbarSettings?: () => PluginSettings,
  partsAccess?: NotePartsAccess,
): Range<Decoration>[] {
  const state = "state" in viewOrState ? viewOrState.state : viewOrState;
  const doc: Text = state.doc;
  const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
  const ranges: Range<Decoration>[] = [];
  if (state.field(editorLivePreviewField, false) === false) return ranges;
  if (!docMayContainModelEmbed(doc)) {
    return ranges;
  }

  for (const embed of scanModelEmbeds(doc.toString())) {
    const modelPath = resolvedPathCache.resolve(embed.path, sourcePath);
    if (!modelPath) continue;
    const line = doc.lineAt(embed.from);
    const standalone = !line.text.slice(0, embed.from - line.from).trim() && !line.text.slice(embed.to - line.from).trim();
    ranges.push(Decoration.replace({
      widget: new LazyModelEmbedWidget(
        app, modelPath, embed.width, embed.height, autoRotate, enabledConverterIds,
        freecadCommand, obj2gltfCommand, fbx2gltfCommand, freecadcmdCommand,
        preferObj2gltfForObj, preferFbx2gltfForFbx, annotationPreviewMode,
        annotationDisplayMode, previewRendererRollout, useThreeRenderer,
        auxiliaryFileFolder, renderQuality, renderScale, convertedAssetCache,
        getAnnotations, getToolbarSettings, partsAccess,
      ),
      // Obsidian also replaces a standalone file embed with a block widget.
      // Match that layer so its generic attachment card cannot cover ours.
      block: standalone,
    }).range(embed.from, embed.to));
  }

  return ranges;
}

type DecoSet = RangeSet<Decoration>;

function toDecoSet(ranges: Range<Decoration>[]): DecoSet {
  if (ranges.length === 0) {
    return RangeSet.empty as DecoSet;
  }
  return RangeSet.of<Decoration>(ranges, true);
}

export function registerLazyLivePreviewExtension(
  app: App,
  getSettings: () => PluginSettings,
  convertedAssetCache: ConvertedAssetCache,
  getAnnotations?: (modelPath: string) => AnnotationPin[],
  registerCleanup?: (cleanup: () => void) => void,
  partsAccess?: NotePartsAccess,
) {
  const resolvedPathCache = createLivePreviewPathResolverCache(app, resolveVaultPath);
  const clearResolvedPathCache = () => resolvedPathCache.clear();
  const vaultEventRefs = [
    app.vault.on("create", clearResolvedPathCache),
    app.vault.on("delete", clearResolvedPathCache),
    app.vault.on("rename", clearResolvedPathCache),
  ];
  registerCleanup?.(() => {
    for (const ref of vaultEventRefs) {
      app.vault.offref(ref);
    }
  });

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
        s.annotationDisplayMode,
        s.previewRendererRollout,
        s.useThreeRenderer,
        s.auxiliaryFileFolder,
        s.renderQuality,
        s.renderScale,
        convertedAssetCache,
        resolvedPathCache,
        getAnnotations,
        getSettings,
        partsAccess,
      );
      return toDecoSet(ranges);
    },
    update(value, tr): DecoSet {
      const modeChanged = tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
      if (tr.docChanged || modeChanged) {
        if (!modeChanged && !transactionMayAffectModelEmbeds(tr)) {
          return value.map(tr.changes);
        }
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
          s.annotationDisplayMode,
          s.previewRendererRollout,
          s.useThreeRenderer,
          s.auxiliaryFileFolder,
          s.renderQuality,
          s.renderScale,
          convertedAssetCache,
          resolvedPathCache,
          getAnnotations,
          getSettings,
          partsAccess,
        );
        return toDecoSet(ranges);
      }
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [Prec.highest(embedField)];
}
