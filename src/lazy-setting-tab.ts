import { PluginSettingTab, type App } from "obsidian";
import type AI3DModelWorkbench from "./main";

export class LazyAI3DSettingTab extends PluginSettingTab {
  private delegate: PluginSettingTab | null = null;
  private delegatePromise: Promise<PluginSettingTab> | null = null;

  constructor(app: App, private readonly plugin: AI3DModelWorkbench) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", { cls: "setting-item-description", text: "Loading AI Model Workbench settings..." });
    void this.ensureDelegate()
      .then((delegate) => {
        delegate.containerEl = this.containerEl;
        delegate.display();
      })
      .catch((error: unknown) => {
        this.containerEl.empty();
        this.containerEl.createEl("p", {
          cls: "setting-item-description",
          text: `Failed to load AI Model Workbench settings: ${String(error)}`,
        });
      });
  }

  hide(): void {
    this.delegate?.hide();
  }

  private ensureDelegate(): Promise<PluginSettingTab> {
    if (this.delegate) {
      return Promise.resolve(this.delegate);
    }
    this.delegatePromise ??= import("./settings").then(({ AI3DSettingTab }) => {
      const delegate = new AI3DSettingTab(this.app, this.plugin);
      this.delegate = delegate;
      this.delegatePromise = null;
      return delegate;
    }).catch((error: unknown) => {
      this.delegatePromise = null;
      throw error;
    });
    return this.delegatePromise;
  }
}
