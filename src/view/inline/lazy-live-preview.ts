/**
 * Lightweight CM6 extension for Live Preview embeds.
 * The full model widget is imported only when an embed is mounted into the DOM.
 */

import type { App } from "obsidian";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { Prec, StateField, RangeSet, type Range } from "@codemirror/state";
import { isSupportedModelExtension } from "../../io/formats/registry";
import type { AnnotationPin, PluginSettings } from "../../domain/models";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { resolveVaultPath } from "../../utils/resolve-path";
import { transactionMayAffectModelEmbeds } from "./live-preview-embed-scan";

type LivePreviewModule = typeof import("./live-preview");
type LivePreviewWidget = InstanceType<LivePreviewModule["ModelEmbedWidget"]>;

let livePreviewModulePromise: Promise<LivePreviewModule> | null = null;

function loadLivePreviewModule(): Promise<LivePreviewModule> {
  livePreviewModulePromise ??= import("./live-preview");
  return livePreviewModulePromise;
}

class LazyModelEmbedWidget extends WidgetType {
  private mountedWidget: LivePreviewWidget | null = null;
  private mountedDom: HTMLElement | null = null;
  private destroyed = false;

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
    private convertedAssetCache: ConvertedAssetCache,
    private getAnnotations?: (modelPath: string) => AnnotationPin[],
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
      this.convertedAssetCache === other.convertedAssetCache
    );
  }

  override toDOM(): HTMLElement {
    const placeholder = activeDocument.createElement("div");
    placeholder.className = "ai3d-embed-preview ai3d-cm-widget ai3d-embed-preview-lazy";
    placeholder.setAttribute("contenteditable", "false");

    void this.mount(placeholder);
    return placeholder;
  }

  override destroy(): void {
    this.destroyed = true;
    this.mountedWidget?.destroy();
    this.mountedWidget = null;
    this.mountedDom?.remove();
    this.mountedDom = null;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  private async mount(placeholder: HTMLElement): Promise<void> {
    let module: LivePreviewModule;
    try {
      module = await loadLivePreviewModule();
    } catch (error) {
      console.warn("[AI3D] Failed to load Live Preview widget runtime:", error);
      if (!this.destroyed && placeholder.isConnected) {
        placeholder.textContent = "AI3D live preview failed to load.";
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
      this.convertedAssetCache,
      this.getAnnotations,
    );

    if (this.destroyed || !placeholder.isConnected) {
      widget.destroy();
      return;
    }

    const mountedDom = widget.toDOM();
    if (this.destroyed || !placeholder.isConnected) {
      widget.destroy();
      return;
    }

    this.mountedWidget = widget;
    this.mountedDom = mountedDom;
    placeholder.replaceWith(mountedDom);
  }
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

      ranges.push(
        Decoration.replace({
          widget: new LazyModelEmbedWidget(
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
            annotationDisplayMode,
            previewRendererRollout,
            useThreeRenderer,
            convertedAssetCache,
            getAnnotations,
          ),
          block: true,
        }).range(line.from + start, line.from + end + 2),
      );

      pos = end + 2;
    }
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
        s.annotationDisplayMode,
        s.previewRendererRollout,
        s.useThreeRenderer,
        convertedAssetCache,
        getAnnotations,
      );
      return toDecoSet(ranges);
    },
    update(value, tr): DecoSet {
      if (tr.docChanged) {
        if (!transactionMayAffectModelEmbeds(tr)) {
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
