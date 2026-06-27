import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "../domain/models";
import type { ConvertedAssetCache } from "../io/cache/converted-asset-cache";
import type { PluginStore } from "../store/plugin-store";
import { t } from "../i18n";
import { DIRECT_VIEW_TYPE } from "./direct-view-type";
import { markDirectViewDom, unmarkDirectViewDom } from "./direct-view-dom";

type DirectViewDelegate = FileView & {
  contentEl: HTMLElement;
  file: TFile | null;
  onLoadFile(file: TFile): Promise<void>;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
};

export class LazyDirectModelView extends FileView {
  private delegate: DirectViewDelegate | null = null;
  private delegatePromise: Promise<DirectViewDelegate | null> | null = null;
  private closed = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly getSettings: () => PluginSettings,
    private readonly convertedAssetCache: ConvertedAssetCache,
    private readonly ps: PluginStore,
  ) {
    super(leaf);
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
    this.closed = false;
    if (this.file) {
      await this.onLoadFile(this.file);
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.closed = false;
    const delegate = await this.ensureDelegate();
    if (!delegate || this.closed) {
      return;
    }
    delegate.file = file;
    await delegate.onLoadFile(file);
  }

  async onClose(): Promise<void> {
    this.closed = true;
    unmarkDirectViewDom(this.contentEl);
    const delegate = this.delegate;
    this.delegate = null;
    await delegate?.onClose();
  }

  private async ensureDelegate(): Promise<DirectViewDelegate | null> {
    if (this.delegate) {
      return this.delegate;
    }
    if (!this.delegatePromise) {
      this.delegatePromise = this.loadDelegate();
    }
    return this.delegatePromise;
  }

  private async loadDelegate(): Promise<DirectViewDelegate | null> {
    this.contentEl.empty();
    markDirectViewDom(this.contentEl);
    this.contentEl.createDiv({ cls: "ai3d-inline-empty", text: t("loading.preparingModel") });
    const { DirectModelView } = await import("./direct-view");
    const delegate = new DirectModelView(this.leaf, this.getSettings, this.convertedAssetCache, this.ps);
    delegate.contentEl = this.contentEl;
    delegate.file = this.file;
    this.delegatePromise = null;
    if (this.closed) {
      await delegate.onClose();
      return null;
    }
    this.delegate = delegate;
    return delegate;
  }
}
