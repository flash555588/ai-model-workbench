import { PluginSettingTab, requireApiVersion, type App, type SettingDefinitionItem } from "obsidian";
import type AI3DModelWorkbench from "./main";
import type { AI3DSettingTab } from "./settings";

export class LazyAI3DSettingTab extends PluginSettingTab {
  private delegate: AI3DSettingTab | null = null;
  private delegatePromise: Promise<AI3DSettingTab> | null = null;
  private declarativeLoadQueued = false;

  constructor(app: App, private readonly plugin: AI3DModelWorkbench) {
    super(app, plugin);
  }

  // Obsidian 1.13+ declarative settings: resolve the lazily loaded delegate and
  // forward definitions/value routing so settings stay searchable without
  // forcing the settings module to load at plugin startup.
  // Obsidian < 1.13 receives an empty definition set and uses the imperative
  // fallback. The explicit version guard is required by the source-review rule.
  getSettingDefinitions(): SettingDefinitionItem[] {
    if (!requireApiVersion("1.13.0")) return [];
    if (!this.delegate) {
      this.loadDeclarativeDelegate();
      return [];
    }
    return this.delegate.getSettingDefinitions();
  }

  getControlValue(key: string): unknown {
    if (requireApiVersion("1.13.0") && this.delegate) {
      return this.delegate.getControlValue(key);
    }
    return undefined;
  }

  setControlValue(key: string, value: unknown): void {
    if (requireApiVersion("1.13.0") && this.delegate) {
      void this.delegate.setControlValue(key, value);
    }
  }

  display(): void {
    this.renderLoadingState();
    if (requireApiVersion("1.13.0")) {
      this.loadDeclarativeDelegate();
      return;
    }
    void this.ensureDelegate()
      .then((delegate) => {
        delegate.containerEl = this.containerEl;
        delegate.renderSettings();
      })
      .catch((error: unknown) => this.renderLoadError(error));
  }

  hide(): void {
    this.delegate?.hide();
  }

  private loadDeclarativeDelegate(): void {
    if (this.delegate) {
      if (requireApiVersion("1.13.0")) this.update();
      return;
    }
    if (this.declarativeLoadQueued) return;
    this.declarativeLoadQueued = true;
    void this.ensureDelegate()
      .then(() => {
        this.declarativeLoadQueued = false;
        if (requireApiVersion("1.13.0")) this.update();
      })
      .catch((error: unknown) => {
        this.declarativeLoadQueued = false;
        this.renderLoadError(error);
      });
  }

  private renderLoadingState(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Loading AI model workbench settings...",
    });
  }

  private renderLoadError(error: unknown): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `Failed to load AI Model Workbench settings: ${String(error)}`,
    });
  }

  private ensureDelegate(): Promise<AI3DSettingTab> {
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
