import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { PluginStore } from "../store/plugin-store";
import type { ConvertedAssetCache } from "../io/cache/converted-asset-cache";
import { mountWorkbench } from "./workbench/app";

export const VIEW_TYPE = "ai-3d-workbench";

export class AnalysisView extends ItemView {
  private store: PluginStore;
  private convertedAssetCache: ConvertedAssetCache;
  private unmount: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: PluginStore, convertedAssetCache: ConvertedAssetCache) {
    super(leaf);
    this.store = store;
    this.convertedAssetCache = convertedAssetCache;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI 3d workbench";
  }

  getIcon(): string {
    return "box";
  }

  onOpen(): Promise<void> {
    this.unmount?.();
    this.unmount = mountWorkbench(this.contentEl, this.app, this.store, this.convertedAssetCache);
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.unmount?.();
    this.unmount = null;
    return Promise.resolve();
  }
}
