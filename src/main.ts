import { Notice, Plugin, TFile } from "obsidian";
import type { PluginSettings } from "./domain/models";
import { createConvertedAssetCache, type ConvertedAssetCache } from "./io/cache/converted-asset-cache";
import { listSupportedModelExtensions, isSupportedModelExtension } from "./io/formats/registry";
import { createPluginStore, type PluginStore } from "./store/plugin-store";
import { DirectModelView, DIRECT_VIEW_TYPE } from "./view/direct-view";
import { ModelFileSuggestModal } from "./view/model-file-suggest-modal";
import { AI3DSettingTab } from "./settings";
import { inspectAllConverterCommands } from "./io/conversion/command-discovery";
import { setLogLevel } from "./utils/log";
import { formatT, setLocale, t, type Locale } from "./i18n";
import { normalizeHeadingText } from "./utils/note-reader";
import { isMobile } from "./utils/device";
import { getPortableStem } from "./utils/resolve-path";

export default class AI3DModelWorkbench extends Plugin {
  private ps!: PluginStore;
  private convertedAssetCache!: ConvertedAssetCache;

  getSettings(): PluginSettings {
    return this.ps.store.getState().settings;
  }

  updateSettings(partial: Partial<PluginSettings>): void {
    const current = this.ps.store.getState().settings;
    const next = { ...current, ...partial };
    this.ps.store.setState({ settings: next });
    setLogLevel(next.logLevel);
    setLocale(next.locale);
  }

  async onload() {
    this.ps = createPluginStore(this);
    await this.ps.load();
    this.convertedAssetCache = createConvertedAssetCache(
      this.ps.store.getState().convertedAssetRecords,
      (records) => this.ps.store.setState({ convertedAssetRecords: records }),
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
      callback: () => this.generateNote(),
    });

    this.addCommand({
      id: "open-knowledge-index",
      name: t("main.commandOpenKnowledgeIndex"),
      callback: () => void this.openKnowledgeIndex(),
    });

    this.addCommand({
      id: "clear-conversion-cache",
      name: t("main.commandClearConversionCache"),
      callback: () => this.clearConversionCache(),
    });

    this.addCommand({
      id: "check-converters",
      name: t("main.commandCheckConverters"),
      callback: () => void this.checkConverterCommands(),
    });

    this.addCommand({
      id: "copy-diagnostics-report",
      name: t("main.commandCopyDiagnostics"),
      callback: () => void this.copyDiagnosticsReport(),
    });

    this.addSettingTab(new AI3DSettingTab(this.app, this));

    // Register direct file view for all supported formats. Conversion-capable formats
    // will be routed through the shared model pipeline inside DirectModelView.
    this.registerView(DIRECT_VIEW_TYPE, (leaf) => new DirectModelView(leaf, () => this.getSettings(), this.convertedAssetCache, this.ps));
    this.registerExtensions(listSupportedModelExtensions(), DIRECT_VIEW_TYPE);

    // Register ```3d and ```3dgrid code block processors
    const { registerCodeBlockProcessor, registerGridCodeBlockProcessor } = await import("./view/inline/code-block");
    const getAnnotations = (modelPath: string) =>
      this.ps.store.getState().modelAssetProfiles[modelPath]?.annotations ?? [];
    const cb = registerCodeBlockProcessor(this.app, () => this.getSettings(), this.convertedAssetCache, getAnnotations);
    this.registerMarkdownCodeBlockProcessor(cb.id, cb.handler);
    const gridCb = registerGridCodeBlockProcessor(this.app, () => this.getSettings(), this.convertedAssetCache);
    this.registerMarkdownCodeBlockProcessor(gridCb.id, gridCb.handler);

    // Register Live Preview extension for ![[model.glb]] embeds
    const { registerLivePreviewExtension } = await import("./view/inline/live-preview");
    const exts = registerLivePreviewExtension(this.app, () => this.getSettings(), this.convertedAssetCache, getAnnotations);
    for (const e of exts) {
      this.registerEditorExtension(e);
    }

    // Watch note headings for hover → highlight pin
    this.setupHeadingPinObserver();
  }

  onunload(): void {
    this.ps.dispose();
    // Views are cleaned up by Obsidian calling onClose()
  }

  private setupHeadingPinObserver(): void {
    const markdownContainerSelector = ".markdown-preview-view, .markdown-source-view";
    const headingSelector = [
      ".markdown-preview-view h1", ".markdown-preview-view h2", ".markdown-preview-view h3",
      ".markdown-preview-view h4", ".markdown-preview-view h5", ".markdown-preview-view h6",
      ".cm-heading-1", ".cm-heading-2", ".cm-heading-3",
      ".cm-heading-4", ".cm-heading-5", ".cm-heading-6",
      ".cm-header-1", ".cm-header-2", ".cm-header-3",
      ".cm-header-4", ".cm-header-5", ".cm-header-6",
    ].join(", ");

    type BoundHeadingEntry = {
      badge: HTMLSpanElement;
      handler: () => void;
      signature: string;
    };
    const boundEntries = new Map<Element, BoundHeadingEntry>();

    // Build headingRef → [{ pinId, modelPath, color }] map from stored annotations.
    // Supports multiple pins/models per heading.
    type PinEntry = { pinId: string; modelPath: string; color: string };
    const buildBadgeSwatchBackground = (colors: string[]): string => {
      if (colors.length === 0) return "var(--interactive-accent)";
      if (colors.length === 1) return colors[0];
      const step = 100 / colors.length;
      return `linear-gradient(135deg, ${colors.map((color, index) => {
        const start = Math.round(index * step);
        const end = Math.round((index + 1) * step);
        return `${color} ${start}% ${end}%`;
      }).join(", ")})`;
    };

    const buildHeadingMap = (): Map<string, PinEntry[]> => {
      const map = new Map<string, PinEntry[]>();
      const profiles = this.ps.store.getState().modelAssetProfiles;
      for (const [modelPath, profile] of Object.entries(profiles)) {
        for (const pin of profile.annotations) {
          if (pin.headingRef && pin.id) {
            const headingKey = normalizeHeadingText(pin.headingRef);
            if (!headingKey) continue;
            let arr = map.get(headingKey);
            if (!arr) { arr = []; map.set(headingKey, arr); }
            arr.push({ pinId: pin.id, modelPath, color: pin.color });
          }
        }
      }
      return map;
    };

    const buildEntriesSignature = (entries: PinEntry[]): string => entries
      .map((entry) => `${entry.pinId}:${entry.modelPath}:${entry.color}`)
      .sort()
      .join("|");

    const buildHeadingMapSignature = (headingMap: Map<string, PinEntry[]>): string => Array
      .from(headingMap.entries())
      .map(([key, entries]) => `${key}=>${buildEntriesSignature(entries)}`)
      .sort()
      .join("||");

    const getHeadingText = (el: Element): string => normalizeHeadingText(
      Array.from(el.childNodes)
        .map((node) => {
          if (node.instanceOf(Element) && node.classList.contains("ai3d-heading-pin-badge")) {
            return "";
          }
          return node.textContent ?? "";
        })
        .join(" "),
    );

    const unbindHeading = (el: Element): void => {
      const existing = boundEntries.get(el);
      if (!existing) return;
      el.removeEventListener("mouseover", existing.handler);
      existing.badge.remove();
      delete (el as HTMLElement).dataset.pinBound;
      boundEntries.delete(el);
    };

    const bindHeading = (el: Element, entries: PinEntry[]): void => {
      if (entries.length === 0) {
        unbindHeading(el);
        return;
      }

      const signature = buildEntriesSignature(entries);
      const existing = boundEntries.get(el);
      if (existing?.signature === signature) return;
      if (existing) {
        unbindHeading(el);
      }

      (el as HTMLElement).dataset.pinBound = signature;

      // Add pin badge: shows count if multiple, tooltip lists model sources
      // Create on heading element (in DOM) to inherit Obsidian CSS variables
      const badge = (el as HTMLElement).createSpan({ cls: "ai3d-heading-pin-badge" });
      const distinctColors = [...new Set(entries.map((entry) => entry.color).filter(Boolean))];
      const swatch = badge.createSpan({ cls: "ai3d-heading-pin-badge-swatch" });
      swatch.style.background = buildBadgeSwatchBackground(distinctColors);
      swatch.title = entries.length > 1 ? t("headingPin.showMultiple") : t("headingPin.showSingle");
      swatch.setAttribute("role", "button");
      swatch.setAttribute("tabindex", "0");
      if (entries.length > 1) {
        const count = badge.createSpan({ cls: "ai3d-heading-pin-badge-count" });
        count.textContent = `\u00d7${entries.length}`;
      }
      const uniqueModels = [...new Set(entries.map((e) => getPortableStem(e.modelPath)))];
      badge.title = formatT("headingPin.linkedTo", { models: uniqueModels.join(", ") });
      const highlightLinkedPins = (e?: Event) => {
        e?.stopPropagation();
        e?.preventDefault();
        for (const entry of entries) {
          activeDocument.dispatchEvent(new CustomEvent("ai3d-pin-highlight", { detail: { pinId: entry.pinId } }));
        }
      };
      swatch.addEventListener("click", (e) => {
        highlightLinkedPins(e);
      });
      swatch.addEventListener("keydown", (e) => {
        if (!e.instanceOf(KeyboardEvent)) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        highlightLinkedPins(e);
      });
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      el.appendChild(badge);

      // Hover on heading → pulse all linked pins
      const handler = () => {
        for (const entry of entries) {
          activeDocument.dispatchEvent(new CustomEvent("ai3d-pin-highlight", { detail: { pinId: entry.pinId } }));
        }
      };
      el.addEventListener("mouseover", handler);
      boundEntries.set(el, { badge, handler, signature });
    };

    const syncHeadingElement = (el: Element, headingMap: Map<string, PinEntry[]>): void => {
      const headingText = getHeadingText(el);
      bindHeading(el, headingMap.get(headingText) ?? []);
    };

    const reconcileBoundHeadings = (headingMap: Map<string, PinEntry[]>): void => {
      for (const [el, entry] of Array.from(boundEntries.entries())) {
        if (!el.isConnected) {
          unbindHeading(el);
          continue;
        }
        const nextEntries = headingMap.get(getHeadingText(el)) ?? [];
        const nextSignature = buildEntriesSignature(nextEntries);
        if (nextEntries.length === 0 || entry.signature !== nextSignature) {
          bindHeading(el, nextEntries);
        }
      }
    };

    const processHeadings = (container: Element, headingMap: Map<string, PinEntry[]>): void => {
      container.querySelectorAll(headingSelector).forEach((el) => syncHeadingElement(el, headingMap));
    };

    const scanAll = (): void => {
      const headingMap = buildHeadingMap();
      reconcileBoundHeadings(headingMap);
      const containers = activeDocument.querySelectorAll(markdownContainerSelector);
      containers.forEach((container) => processHeadings(container, headingMap));
    };

    let lastHeadingMapSignature = buildHeadingMapSignature(buildHeadingMap());
    let scanTimer = 0;
    const scheduleScan = (delay = 0): void => {
      if (scanTimer) {
        window.clearTimeout(scanTimer);
      }
      scanTimer = window.setTimeout(() => {
        scanTimer = 0;
        scanAll();
      }, delay);
    };

    const unsubscribeStore = this.ps.store.subscribe(() => {
      const nextHeadingMap = buildHeadingMap();
      const nextSignature = buildHeadingMapSignature(nextHeadingMap);
      if (nextSignature === lastHeadingMapSignature) return;
      lastHeadingMapSignature = nextSignature;
      scheduleScan();
    });

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      scheduleScan(200);
    }));

    // Debounced MutationObserver: coalesce rapid DOM changes into a single scan
    const matchesRelevantNode = (node: HTMLElement): boolean => {
      if (node.matches(markdownContainerSelector) || node.matches(headingSelector)) return true;
      return !!node.querySelector(markdownContainerSelector) || !!node.querySelector(headingSelector);
    };

    const isRelevantAddedNode = (node: HTMLElement): boolean => node.isConnected && matchesRelevantNode(node);
    const isRelevantRemovedNode = (node: HTMLElement): boolean => matchesRelevantNode(node);

    let pendingNodes = new Set<HTMLElement>();
    let debounceTimer = 0;
    const flushPending = () => {
      const nodes = Array.from(pendingNodes);
      pendingNodes.clear();
      debounceTimer = 0;
      const headingMap = buildHeadingMap();
      reconcileBoundHeadings(headingMap);
      for (const node of nodes) {
        if (!node.isConnected) continue;
        if (node.matches?.(headingSelector)) syncHeadingElement(node, headingMap);
        node.querySelectorAll?.(headingSelector)?.forEach((el: Element) => syncHeadingElement(el, headingMap));
        if (node.matches?.(markdownContainerSelector)) {
          processHeadings(node, headingMap);
        }
        node.querySelectorAll?.(markdownContainerSelector)?.forEach((el: Element) => processHeadings(el, headingMap));
      }
      lastHeadingMapSignature = buildHeadingMapSignature(headingMap);
    };

    const observer = new MutationObserver((mutations) => {
      let shouldFlush = false;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!node.instanceOf(HTMLElement)) continue;
          if (!isRelevantAddedNode(node)) continue;
          pendingNodes.add(node);
          shouldFlush = true;
        }
        for (const node of Array.from(m.removedNodes)) {
          if (!node.instanceOf(HTMLElement)) continue;
          if (!isRelevantRemovedNode(node)) continue;
          shouldFlush = true;
        }
      }
      if (shouldFlush && !debounceTimer) {
        debounceTimer = window.setTimeout(flushPending, 100);
      }
    });
    observer.observe(activeDocument.body, { childList: true, subtree: true });

    // Cleanup: disconnect observer, remove all heading listeners
    this.register(() => {
      unsubscribeStore();
      observer.disconnect();
      if (debounceTimer) { window.clearTimeout(debounceTimer); debounceTimer = 0; }
      if (scanTimer) { window.clearTimeout(scanTimer); scanTimer = 0; }
      for (const el of Array.from(boundEntries.keys())) {
        unbindHeading(el);
      }
    });

    // Initial scan
    scheduleScan(500);
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
    this.ps.store.setState({
      currentModelPath: file.path,
      modelPreview: null,
      selectedPart: null,
    });
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
        await this.app.vault.createFolder(current).catch(() => {});
      }
    }
  }
}
