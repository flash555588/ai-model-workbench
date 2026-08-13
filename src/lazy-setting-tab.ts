import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import type AI3DModelWorkbench from "./main";

export class LazyAI3DSettingTab extends PluginSettingTab {
  private delegate: PluginSettingTab | null = null;
  private delegatePromise: Promise<PluginSettingTab> | null = null;

  constructor(app: App, private readonly plugin: AI3DModelWorkbench) {
    super(app, plugin);
  }

  // Obsidian 1.13+ declarative settings: resolve the lazily loaded delegate and
  // forward definitions/value routing so settings stay searchable without
  // forcing the settings module to load at plugin startup.
  // The 1.13 APIs below are additive: Obsidian < 1.13 never calls them, so the
  // plugin keeps minAppVersion 1.5.0 and falls back to `display()` there.

  /* eslint-disable obsidianmd/no-unsupported-api -- additive 1.13 APIs, never called on Obsidian < 1.13 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.delegate && "getSettingDefinitions" in this.delegate
      ? this.delegate.getSettingDefinitions()
      : [];
  }

  getControlValue(key: string): unknown {
    return this.delegate && "getControlValue" in this.delegate
      ? this.delegate.getControlValue(key)
      : undefined;
  }

  setControlValue(key: string, value: unknown): void {
    if (this.delegate && "setControlValue" in this.delegate) {
      void this.delegate.setControlValue(key, value);
    }
  }
  /* eslint-enable obsidianmd/no-unsupported-api */

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("p", { cls: "setting-item-description", text: "Loading AI model workbench settings..." });
    void this.ensureDelegate()
      .then((delegate) => {
        delegate.containerEl = this.containerEl;
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- imperative fallback for Obsidian < 1.13
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
