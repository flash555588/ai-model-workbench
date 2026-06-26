import { Notice, Plugin, TFile } from "obsidian";
import type { PluginSettings } from "./domain/models";
import { createConvertedAssetCache, type ConvertedAssetCache } from "./io/cache/converted-asset-cache";
import { listSupportedModelExtensions, isSupportedModelExtension } from "./io/formats/registry";
import { createPluginStore, type PluginStore } from "./store/plugin-store";
import { LazyDirectModelView } from "./view/lazy-direct-view";
import { DIRECT_VIEW_TYPE } from "./view/direct-view-type";
import { ModelFileSuggestModal } from "./view/model-file-suggest-modal";
import { AI3DSettingTab } from "./settings";
import { createLogger, setLogLevel } from "./utils/log";
import { formatT, setLocale, t, type Locale } from "./i18n";

const log = createLogger("main");

function withErrorNotice<T>(fn: () => Promise<T>, context: string): () => void {
  return () => {
    fn().catch((err: unknown) => {
      log.error(`Command ${context} failed`, { error: String(err) });
      new Notice(`AI3D: ${context} failed — ${String(err)}`, 5000);
    });
  };
}

import { isMobile } from "./utils/device";

export default class AI3DModelWorkbench extends Plugin {
  private ps!: PluginStore;
  private convertedAssetCache!: ConvertedAssetCache;
  private unloaded = false;
  private headingPinObserverStarted = false;

  getSettings(): PluginSettings {
    return this.ps.store.getState().settings;
  }

  updateSettings(partial: Partial<PluginSettings>): void {
    this.ps.updateSettings(partial);
    setLogLevel(this.getSettings().logLevel);
    setLocale(this.getSettings().locale);
  }

  async onload() {
    this.unloaded = false;
    this.ps = createPluginStore(this);
    await this.ps.load();
    this.convertedAssetCache = createConvertedAssetCache(
      this.ps.store.getState().convertedAssetRecords,
      (records) => this.ps.setConvertedAssetRecords(records),
    );
    setLogLevel(this.getSettings().logLevel);
    // Auto-detect locale on first run (old data has no locale field)
    if (!this.ps.localeLoadedFromSaved) {
      const sysLang = navigator.language ?? "en";
      const detected: Locale = sysLang.startsWith("zh") ? "zh-CN" : "en";
      this.updateSettings({ locale: detected });
    }
    setLocale(this.getSettings().locale);

    this.addRibbonIcon("box", t("main.commandImportModel"), () => this.importModel());

    this.addCommand({
      id: "import-model",
      name: t("main.commandImportModel"),
      callback: () => this.importModel(),
    });

    this.addCommand({
      id: "generate-note",
      name: t("main.commandGenerateNote"),
      callback: withErrorNotice(() => this.generateNote(), "generate note"),
    });

    this.addCommand({
      id: "open-knowledge-index",
      name: t("main.commandOpenKnowledgeIndex"),
      callback: withErrorNotice(() => this.openKnowledgeIndex(), "open knowledge index"),
    });

    this.addCommand({
      id: "clear-conversion-cache",
      name: t("main.commandClearConversionCache"),
      callback: withErrorNotice(() => Promise.resolve(this.clearConversionCache()), "clear conversion cache"),
    });

    this.addCommand({
      id: "check-converters",
      name: t("main.commandCheckConverters"),
      callback: withErrorNotice(() => this.checkConverterCommands(), "check converters"),
    });

    this.addCommand({
      id: "copy-diagnostics-report",
      name: t("main.commandCopyDiagnostics"),
      callback: withErrorNotice(() => this.copyDiagnosticsReport(), "copy diagnostics"),
    });

    this.addSettingTab(new AI3DSettingTab(this.app, this));

    // Register direct file view for all supported formats. Conversion-capable formats
    // will be routed through the shared model pipeline inside DirectModelView.
    this.registerView(DIRECT_VIEW_TYPE, (leaf) => new LazyDirectModelView(leaf, () => this.getSettings(), this.convertedAssetCache, this.ps));
    this.registerExtensions(listSupportedModelExtensions(), DIRECT_VIEW_TYPE);

    const getAnnotations = (modelPath: string) =>
      this.ps.store.getState().modelAssetProfiles[modelPath]?.annotations ?? [];
    const [
      { registerCodeBlockProcessor, registerGridCodeBlockProcessor },
      { registerLivePreviewExtension },
    ] = await Promise.all([
      import("./view/inline/code-block"),
      import("./view/inline/live-preview"),
    ]);

    // Register ```3d and ```3dgrid code block processors
    const cb = registerCodeBlockProcessor(this.app, () => this.getSettings(), this.convertedAssetCache, getAnnotations);
    this.registerMarkdownCodeBlockProcessor(cb.id, cb.handler);
    const gridCb = registerGridCodeBlockProcessor(this.app, () => this.getSettings(), this.convertedAssetCache);
    this.registerMarkdownCodeBlockProcessor(gridCb.id, gridCb.handler);

    // Register Live Preview extension for ![[model.glb]] embeds
    const exts = registerLivePreviewExtension(this.app, () => this.getSettings(), this.convertedAssetCache, getAnnotations);
    for (const e of exts) {
      this.registerEditorExtension(e);
    }

    // Watch note headings for hover → highlight pin
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        void this.startHeadingPinObserver();
      }, 0);
    });
  }

  onunload(): void {
    this.unloaded = true;
    // Flush pending dirty state without forcing an unchanged data.json rewrite.
    this.ps.dispose();
    // Views are cleaned up by Obsidian calling onClose()
  }

  private async startHeadingPinObserver(): Promise<void> {
    if (this.unloaded || this.headingPinObserverStarted) {
      return;
    }
    this.headingPinObserverStarted = true;
    try {
      const { setupHeadingPinObserver } = await import("./view/heading-pin-observer");
      if (this.unloaded) {
        return;
      }
      // Watch note headings for hover -> highlight pin after the workspace has settled.
      setupHeadingPinObserver({
        subscribeStore: (cb) => this.ps.store.subscribe(cb),
        getModelAssetProfiles: () => this.ps.store.getState().modelAssetProfiles,
        registerCleanup: (cleanup) => this.register(cleanup),
        onLayoutChange: (cb) => { this.registerEvent(this.app.workspace.on("layout-change", cb)); },
      });
    } catch (error) {
      this.headingPinObserverStarted = false;
      console.warn("[AI3D] Failed to start heading pin observer:", error);
    }
  }



  private importModel() {
    new ModelFileSuggestModal(this.app, (file: TFile) => {
      const ext = file.extension.toLowerCase();
      if (!isSupportedModelExtension(ext)) {
        return;
      }

      void this.openModelFile(file);
    }).open();
  }

  private async openModelFile(file: TFile): Promise<void> {
    this.ps.setCurrentModel(file.path, null);
    await this.app.workspace.getLeaf(true).openFile(file, { active: true });
  }

  private async generateNote() {
    const { generateKnowledgeNote } = await import("./view/workbench/knowledge-note");
    await generateKnowledgeNote(this.app, this.ps);
  }

  private async openKnowledgeIndex() {
    const indexPath = this.resolveKnowledgeIndexPath();
    if (!indexPath) {
      new Notice(t("workbench.noIndexYet"));
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(indexPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file, { active: true });
    } else {
      new Notice(formatT("workbench.fileNotFound", { path: indexPath }));
    }
  }

  private resolveKnowledgeIndexPath(): string | undefined {
    const state = this.ps.store.getState();
    const currentPath = state.currentModelPath;
    const currentIndex = currentPath ? state.modelAssetProfiles[currentPath]?.knowledgeIndexPath : undefined;
    if (currentIndex) {
      return currentIndex;
    }
    if (state.lastKnowledgeGeneration?.knowledgeIndexPath) {
      return state.lastKnowledgeGeneration.knowledgeIndexPath;
    }
    const indexedProfiles = Object.values(state.modelAssetProfiles)
      .filter((profile) => !!profile.knowledgeIndexPath)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return indexedProfiles[0]?.knowledgeIndexPath;
  }

  private clearConversionCache() {
    this.convertedAssetCache.clear();
    new Notice("AI 3d conversion cache cleared.");
  }

  private async checkConverterCommands() {
    if (isMobile()) {
      new Notice(t("main.converterDiagnosticsMobileUnavailable"), 8000);
      return;
    }

    const { inspectAllConverterCommands } = await import("./io/conversion/command-discovery");
    const statuses = await inspectAllConverterCommands(this.getSettings());
    const available = statuses.filter((status) => status.available).map((status) => status.label);
    const missing = statuses.filter((status) => !status.available).map((status) => status.label);

    if (missing.length === 0) {
      new Notice(`AI 3D converter diagnostics: all commands available (${available.join(", ")}).`, 8000);
      return;
    }

    new Notice(
      `AI 3D converter diagnostics: available ${available.join(", ") || "none"}; missing ${missing.join(", ")}.`,
      10000,
    );
  }

  private async copyDiagnosticsReport() {
    const { buildDiagnosticsReport } = await import("./diagnostics/report");
    const report = buildDiagnosticsReport({
      manifest: this.manifest,
      state: this.ps.store.getState(),
    });
    try {
      await navigator.clipboard.writeText(report);
      new Notice(t("main.diagnosticsCopied"), 8000);
    } catch {
      const folder = this.getSettings().reportFolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").trim() || "Analysis/3D Reports";
      await this.ensureVaultFolder(folder);
      const fileName = `AI Model Workbench Diagnostics ${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
      const file = await this.app.vault.create(`${folder}/${fileName}`, report);
      await this.app.workspace.getLeaf(true).openFile(file, { active: true });
      new Notice(t("main.diagnosticsCopyFailed"), 10000);
    }
  }

  private async ensureVaultFolder(folder: string): Promise<void> {
    let current = "";
    for (const part of folder.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current).catch((err: unknown) => {
          log.warn("Failed to create vault folder", { path: current, error: String(err) });
        });
      }
    }
  }
}
