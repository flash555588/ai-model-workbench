import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import type AI3DModelWorkbench from "./main";
import { DEFAULT_SETTINGS } from "./domain/constants";
import type {
  ConverterCommandSource,
  ConverterDependencyCheck,
  ConverterCommandStatus,
} from "./io/conversion/command-discovery";
import { t, setLocale, type Locale } from "./i18n";
import { isMobile } from "./utils/device";
import { getRuntimeProcess } from "./utils/node-shim";

const proc = getRuntimeProcess();

/** Key prefix used by the declarative converter-enabled toggles (backed by `enabledConverterIds`). */
const ENABLED_CONVERTER_KEY_PREFIX = "enabledConverter:";

// TODO(P2): split display() into section-builder methods; currently >500 lines (debt: settings-ui).

function getConverterCommandPlaceholders(): {
  python: string;
  freecad: string;
  obj2gltf: string;
  fbx2gltf: string;
} {
  switch (proc?.platform) {
    case "win32":
      return {
        python: "Path to python executable",
        freecad: "Path to FreeCADCmd.exe",
        obj2gltf: "Path to obj2gltf.cmd",
        fbx2gltf: "Path to FBX2glTF.exe",
      };
    case "darwin":
      return {
        python: "Path to python3",
        freecad: "Path to FreeCADCmd",
        obj2gltf: "Path to obj2gltf",
        fbx2gltf: "Path to FBX2glTF",
      };
    case "linux":
      return {
        python: "Path to python3",
        freecad: "Path to freecadcmd",
        obj2gltf: "Path to obj2gltf",
        fbx2gltf: "Path to FBX2glTF",
      };
    default:
      return {
        python: "Path to python executable",
        freecad: "Path to FreeCAD command",
        obj2gltf: "Path to obj2gltf",
        fbx2gltf: "Path to FBX2glTF",
      };
  }
}

export class AI3DSettingTab extends PluginSettingTab {
  private plugin: AI3DModelWorkbench;
  private diagnosticsRunId = 0;
  private diagnosticsEl: HTMLDivElement | null = null;

  constructor(app: App, plugin: AI3DModelWorkbench) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ── Obsidian 1.13+ declarative settings ─────────────────────────
  // `display()` remains the fallback for Obsidian < 1.13; on 1.13+ Obsidian
  // renders the definitions below and makes them searchable in settings.

  getControlValue(key: string): unknown {
    if (key.startsWith(ENABLED_CONVERTER_KEY_PREFIX)) {
      const id = key.slice(ENABLED_CONVERTER_KEY_PREFIX.length);
      return this.plugin.getSettings().enabledConverterIds.includes(id);
    }
    return (this.plugin.getSettings() as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void {
    if (key.startsWith(ENABLED_CONVERTER_KEY_PREFIX)) {
      const id = key.slice(ENABLED_CONVERTER_KEY_PREFIX.length);
      const current = this.plugin.getSettings().enabledConverterIds;
      const next = value
        ? Array.from(new Set([...current, id]))
        : current.filter((entry) => entry !== id);
      this.plugin.updateSettings({ enabledConverterIds: next });
      return;
    }
    this.plugin.updateSettings({ [key]: value });
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.buildSettingDefinitions();
  }

  private buildSettingDefinitions(): SettingDefinitionItem[] {
    const commandPlaceholders = getConverterCommandPlaceholders();
    const groups: SettingDefinitionItem[] = [
      {
        type: "group",
        heading: t("settings.language"),
        items: [
          {
            name: t("settings.language"),
            desc: t("settings.language.desc"),
            control: {
              type: "dropdown",
              key: "locale",
              options: {
                en: t("settings.language.englishName"),
                "zh-CN": t("settings.language.chineseName"),
              },
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.folders"),
        items: [
          {
            name: t("settings.sourceModelFolder"),
            desc: t("settings.sourceModelFolder.desc"),
            control: { type: "text", key: "sourceModelFolder", placeholder: DEFAULT_SETTINGS.sourceModelFolder },
          },
          {
            name: t("settings.auxiliaryFileFolder"),
            desc: t("settings.auxiliaryFileFolder.desc"),
            control: { type: "text", key: "auxiliaryFileFolder", placeholder: t("settings.auxiliaryFileFolder.placeholder") },
          },
          {
            name: t("settings.reportFolder"),
            desc: t("settings.reportFolder.desc"),
            control: { type: "text", key: "reportFolder", placeholder: DEFAULT_SETTINGS.reportFolder },
          },
          {
            name: t("settings.partFolder"),
            desc: t("settings.partFolder.desc"),
            control: { type: "text", key: "partFolder", placeholder: DEFAULT_SETTINGS.partFolder },
          },
          {
            name: t("settings.snapshotFolder"),
            desc: t("settings.snapshotFolder.desc"),
            control: { type: "text", key: "snapshotFolder", placeholder: DEFAULT_SETTINGS.snapshotFolder },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.behavior"),
        items: [
          {
            name: t("settings.autoGenerateKnowledgeNotes"),
            desc: t("settings.autoGenerateKnowledgeNotes.desc"),
            control: { type: "toggle", key: "autoGenerateKnowledgeNotes" },
          },
          {
            name: t("settings.annotationPreviewMode"),
            desc: t("settings.annotationPreviewMode.desc"),
            control: {
              type: "dropdown",
              key: "annotationPreviewMode",
              options: {
                "plain-text": t("settings.annotationPreviewMode.plainText"),
                markdown: t("settings.annotationPreviewMode.markdown"),
              },
            },
          },
          {
            name: t("settings.annotationDisplayMode"),
            desc: t("settings.annotationDisplayMode.desc"),
            control: {
              type: "dropdown",
              key: "annotationDisplayMode",
              options: {
                snippet: t("settings.annotationDisplayMode.snippet"),
                surface: t("settings.annotationDisplayMode.surface"),
                dot: t("settings.annotationDisplayMode.dot"),
              },
            },
          },
          {
            name: t("settings.previewRendererRollout"),
            desc: t("settings.previewRendererRollout.desc"),
            control: {
              type: "dropdown",
              key: "previewRendererRollout",
              options: {
                "babylon-safe": t("settings.previewRendererRollout.babylonSafe"),
                "three-readonly-glb": t("settings.previewRendererRollout.readonly"),
                "three-direct-glb": t("settings.previewRendererRollout.direct"),
              },
            },
          },
          {
            name: t("settings.useThreeRenderer"),
            desc: t("settings.useThreeRenderer.desc"),
            control: { type: "toggle", key: "useThreeRenderer" },
          },
          {
            name: t("settings.useThreeForConvertedDirectView"),
            desc: t("settings.useThreeForConvertedDirectView.desc"),
            control: { type: "toggle", key: "useThreeForConvertedDirectView" },
          },
          {
            name: t("settings.experimentalThreeWorkbench"),
            desc: t("settings.experimentalThreeWorkbench.desc"),
            control: { type: "toggle", key: "experimentalThreeWorkbench" },
          },
          {
            name: t("settings.autoRotateDefault"),
            desc: t("settings.autoRotateDefault.desc"),
            control: { type: "toggle", key: "autoRotateDefault" },
          },
          {
            name: t("settings.snapshotNaming"),
            desc: t("settings.snapshotNaming.desc"),
            control: {
              type: "dropdown",
              key: "snapshotNaming",
              options: {
                "model-name": t("settings.snapshotNaming.modelName"),
                timestamp: t("settings.snapshotNaming.timestamp"),
              },
            },
          },
          {
            name: t("settings.logLevel"),
            desc: t("settings.logLevel.desc"),
            control: {
              type: "dropdown",
              key: "logLevel",
              options: { debug: "Debug", info: "Info", warn: "Warn", error: "Error" },
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.knowledgeGeneration"),
        items: [
          {
            name: t("settings.analysisMode"),
            desc: t("settings.analysisMode.desc"),
            control: {
              type: "dropdown",
              key: "analysisMode",
              options: {
                local: t("settings.analysisMode.local"),
                hybrid: t("settings.analysisMode.hybrid"),
                remote: t("settings.analysisMode.remote"),
              },
            },
          },
          {
            name: t("settings.serviceBaseUrl"),
            desc: t("settings.serviceBaseUrl.desc"),
            control: { type: "text", key: "serviceBaseUrl", placeholder: "Local draft service URL" },
          },
          {
            name: t("settings.sendGeometrySummaryToRemote"),
            desc: t("settings.sendGeometrySummaryToRemote.desc"),
            control: { type: "toggle", key: "sendGeometrySummaryToRemote" },
          },
          {
            name: t("settings.sendPreviewImagesToRemote"),
            desc: t("settings.sendPreviewImagesToRemote.desc"),
            control: { type: "toggle", key: "sendPreviewImagesToRemote" },
          },
          {
            name: t("settings.sendRawModelToRemote"),
            desc: t("settings.sendRawModelToRemote.desc"),
            control: { type: "toggle", key: "sendRawModelToRemote" },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.performance"),
        items: [
          {
            name: t("settings.canvasHeight"),
            desc: t("settings.canvasHeight.desc"),
            control: { type: "slider", key: "defaultCanvasHeight", min: 200, max: 800, step: 25 },
          },
          {
            name: t("settings.autoRotateSpeed"),
            desc: t("settings.autoRotateSpeed.desc"),
            control: { type: "slider", key: "autoRotateSpeed", min: 0.1, max: 2, step: 0.1 },
          },
          {
            name: t("settings.renderQuality"),
            desc: t("settings.renderQuality.desc"),
            control: {
              type: "dropdown",
              key: "renderQuality",
              options: { low: "Low", medium: "Medium", high: "High" },
            },
          },
          {
            name: t("settings.renderScale"),
            desc: t("settings.renderScale.desc"),
            control: { type: "slider", key: "renderScale", min: 0.25, max: 2, step: 0.25 },
          },
        ],
      },
    ];

    if (isMobile()) {
      return groups;
    }

    const converterItems: SettingGroupItem[] = [
      {
        name: t("settings.enableCad"),
        desc: t("settings.enableCad.desc"),
        control: { type: "toggle", key: `${ENABLED_CONVERTER_KEY_PREFIX}freecad` },
      },
      {
        name: t("settings.enableObj2gltf"),
        desc: t("settings.enableObj2gltf.desc"),
        control: { type: "toggle", key: `${ENABLED_CONVERTER_KEY_PREFIX}obj2gltf` },
      },
      {
        name: t("settings.preferObj2gltf"),
        desc: t("settings.preferObj2gltf.desc"),
        control: { type: "toggle", key: "preferObj2gltfForObj" },
      },
      {
        name: t("settings.enableFbx2gltf"),
        desc: t("settings.enableFbx2gltf.desc"),
        control: { type: "toggle", key: `${ENABLED_CONVERTER_KEY_PREFIX}fbx2gltf` },
      },
      {
        name: t("settings.enableMesh"),
        desc: t("settings.enableMesh.desc"),
        control: { type: "toggle", key: `${ENABLED_CONVERTER_KEY_PREFIX}assimp` },
      },
      {
        name: t("settings.enableSldprt"),
        desc: t("settings.enableSldprt.desc"),
        control: { type: "toggle", key: `${ENABLED_CONVERTER_KEY_PREFIX}sldprt` },
      },
      {
        name: t("settings.pythonCmd"),
        desc: t("settings.pythonCmd.desc"),
        control: { type: "text", key: "freecadCommand", placeholder: commandPlaceholders.python },
      },
      {
        name: t("settings.freecadCmd"),
        desc: t("settings.freecadCmd.desc"),
        control: { type: "text", key: "freecadcmdCommand", placeholder: commandPlaceholders.freecad },
      },
      {
        name: t("settings.obj2gltfCmd"),
        desc: t("settings.obj2gltfCmd.desc"),
        control: { type: "text", key: "obj2gltfCommand", placeholder: commandPlaceholders.obj2gltf },
      },
      {
        name: t("settings.fbx2gltfCmd"),
        desc: t("settings.fbx2gltfCmd.desc"),
        control: { type: "text", key: "fbx2gltfCommand", placeholder: commandPlaceholders.fbx2gltf },
      },
      {
        name: t("settings.assimpCmd"),
        desc: t("settings.assimpCmd.desc"),
        control: { type: "text", key: "assimpCommand", placeholder: commandPlaceholders.python },
      },
      {
        name: t("settings.diagnostics"),
        desc: t("settings.diagnostics.desc"),
        action: (rowEl) => { void this.runDeclarativeConverterDiagnostics(rowEl); },
      },
    ];

    groups.push({ type: "group", heading: t("settings.converters"), items: converterItems });
    return groups;
  }

  private async runDeclarativeConverterDiagnostics(rowEl: HTMLElement): Promise<void> {
    const container = rowEl.createDiv({ cls: "ai3d-settings-diagnostics" });
    container.createEl("p", { text: t("settings.diagnostics.checkingAvailability") });
    const { describeConverterCommandSource, inspectAllConverterCommands } = await import("./io/conversion/command-discovery");
    const statuses = await inspectAllConverterCommands(this.plugin.getSettings());
    container.empty();
    for (const status of statuses) {
      this.renderCommandStatus(container, status, describeConverterCommandSource);
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    setLocale(this.plugin.getSettings().locale);
    this.diagnosticsEl = null;

    this.addTitle(containerEl);
    this.buildLanguageSection(containerEl);
    this.buildFoldersSection(containerEl);
    this.buildBehaviorSection(containerEl);
    this.buildKnowledgeGenerationSection(containerEl);
    this.buildConvertersSection(containerEl);
    this.buildPerformanceSection(containerEl);
  }

  private addTitle(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.title")).setHeading();
  }

  private createSecondaryMenu(parent: HTMLElement, title: string, description: string): HTMLElement {
    const detailsEl = parent.createEl("details", { cls: "ai3d-settings-secondary-menu" });
    detailsEl.createEl("summary", { cls: "ai3d-settings-secondary-menu-summary", text: title });
    const bodyEl = detailsEl.createDiv({ cls: "ai3d-settings-secondary-menu-body" });
    bodyEl.createEl("p", { cls: "setting-item-description", text: description });
    return bodyEl;
  }

  private resetCommandDiagnostics(): void {
    if (!this.diagnosticsEl) return;
    this.diagnosticsRunId++;
    this.diagnosticsEl.empty();
    this.diagnosticsEl.createEl("p", { text: t("settings.diagnostics.idle") });
  }

  private buildLanguageSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", t("settings.language.englishName"))
          .addOption("zh-CN", t("settings.language.chineseName"))
          .setValue(this.plugin.getSettings().locale)
          .onChange((value) => {
            const locale = value as Locale;
            this.plugin.updateSettings({ locale });
            setLocale(locale);
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- re-render imperative UI for Obsidian < 1.13
            this.display();
          }),
      );
  }

  private buildFoldersSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.folders")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.sourceModelFolder"))
      .setDesc(t("settings.sourceModelFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.sourceModelFolder)
          .setValue(this.plugin.getSettings().sourceModelFolder)
          .onChange((val) => {
            this.plugin.updateSettings({ sourceModelFolder: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.auxiliaryFileFolder"))
      .setDesc(t("settings.auxiliaryFileFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.auxiliaryFileFolder.placeholder"))
          .setValue(this.plugin.getSettings().auxiliaryFileFolder)
          .onChange((val) => {
            this.plugin.updateSettings({ auxiliaryFileFolder: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.reportFolder"))
      .setDesc(t("settings.reportFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.reportFolder)
          .setValue(this.plugin.getSettings().reportFolder)
          .onChange((val) => {
            this.plugin.updateSettings({ reportFolder: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.partFolder"))
      .setDesc(t("settings.partFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.partFolder)
          .setValue(this.plugin.getSettings().partFolder)
          .onChange((val) => {
            this.plugin.updateSettings({ partFolder: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.snapshotFolder"))
      .setDesc(t("settings.snapshotFolder.desc"))
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.snapshotFolder)
          .setValue(this.plugin.getSettings().snapshotFolder)
          .onChange((val) => {
            this.plugin.updateSettings({ snapshotFolder: val });
          }),
      );
  }

  private buildBehaviorSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.behavior")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.autoGenerateKnowledgeNotes"))
      .setDesc(t("settings.autoGenerateKnowledgeNotes.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().autoGenerateKnowledgeNotes)
          .onChange((val) => {
            this.plugin.updateSettings({ autoGenerateKnowledgeNotes: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.annotationPreviewMode"))
      .setDesc(t("settings.annotationPreviewMode.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("plain-text", t("settings.annotationPreviewMode.plainText"))
          .addOption("markdown", t("settings.annotationPreviewMode.markdown"))
          .setValue(this.plugin.getSettings().annotationPreviewMode)
          .onChange((val: string) => {
            this.plugin.updateSettings({ annotationPreviewMode: val as "plain-text" | "markdown" });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.annotationDisplayMode"))
      .setDesc(t("settings.annotationDisplayMode.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("snippet", t("settings.annotationDisplayMode.snippet"))
          .addOption("surface", t("settings.annotationDisplayMode.surface"))
          .addOption("dot", t("settings.annotationDisplayMode.dot"))
          .setValue(this.plugin.getSettings().annotationDisplayMode)
          .onChange((val: string) => {
            this.plugin.updateSettings({ annotationDisplayMode: val as "snippet" | "surface" | "dot" });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.previewRendererRollout"))
      .setDesc(t("settings.previewRendererRollout.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("babylon-safe", t("settings.previewRendererRollout.babylonSafe"))
          .addOption("three-readonly-glb", t("settings.previewRendererRollout.readonly"))
          .addOption("three-direct-glb", t("settings.previewRendererRollout.direct"))
          .setValue(this.plugin.getSettings().previewRendererRollout)
          .onChange((val: string) => {
            this.plugin.updateSettings({
              previewRendererRollout: val as "babylon-safe" | "three-readonly-glb" | "three-direct-glb",
            });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.useThreeRenderer"))
      .setDesc(t("settings.useThreeRenderer.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().useThreeRenderer)
          .onChange((val) => {
            this.plugin.updateSettings({ useThreeRenderer: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.useThreeForConvertedDirectView"))
      .setDesc(t("settings.useThreeForConvertedDirectView.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().useThreeForConvertedDirectView)
          .onChange((val) => {
            this.plugin.updateSettings({ useThreeForConvertedDirectView: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.experimentalThreeWorkbench"))
      .setDesc(t("settings.experimentalThreeWorkbench.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().experimentalThreeWorkbench)
          .onChange((val) => {
            this.plugin.updateSettings({ experimentalThreeWorkbench: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.autoRotateDefault"))
      .setDesc(t("settings.autoRotateDefault.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().autoRotateDefault)
          .onChange((val) => {
            this.plugin.updateSettings({ autoRotateDefault: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.snapshotNaming"))
      .setDesc(t("settings.snapshotNaming.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("model-name", t("settings.snapshotNaming.modelName"))
          .addOption("timestamp", t("settings.snapshotNaming.timestamp"))
          .setValue(this.plugin.getSettings().snapshotNaming)
          .onChange((val: string) => {
            this.plugin.updateSettings({ snapshotNaming: val as "timestamp" | "model-name" });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.logLevel"))
      .setDesc(t("settings.logLevel.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("debug", "Debug")
          .addOption("info", "Info")
          .addOption("warn", "Warn")
          .addOption("error", "Error")
          .setValue(this.plugin.getSettings().logLevel)
          .onChange((val: string) => {
            this.plugin.updateSettings({ logLevel: val as "debug" | "info" | "warn" | "error" });
          }),
      );
  }

  private buildKnowledgeGenerationSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.knowledgeGeneration")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.analysisMode"))
      .setDesc(t("settings.analysisMode.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", t("settings.analysisMode.local"))
          .addOption("hybrid", t("settings.analysisMode.hybrid"))
          .addOption("remote", t("settings.analysisMode.remote"))
          .setValue(this.plugin.getSettings().analysisMode)
          .onChange((val: string) => {
            this.plugin.updateSettings({ analysisMode: val as "local" | "hybrid" | "remote" });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.serviceBaseUrl"))
      .setDesc(t("settings.serviceBaseUrl.desc"))
      .addText((text) =>
        text
          .setPlaceholder("Local draft service URL")
          .setValue(this.plugin.getSettings().serviceBaseUrl)
          .onChange((val) => {
            this.plugin.updateSettings({ serviceBaseUrl: val.trim() });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.sendGeometrySummaryToRemote"))
      .setDesc(t("settings.sendGeometrySummaryToRemote.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().sendGeometrySummaryToRemote)
          .onChange((val) => {
            this.plugin.updateSettings({ sendGeometrySummaryToRemote: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.sendPreviewImagesToRemote"))
      .setDesc(t("settings.sendPreviewImagesToRemote.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().sendPreviewImagesToRemote)
          .onChange((val) => {
            this.plugin.updateSettings({ sendPreviewImagesToRemote: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.sendRawModelToRemote"))
      .setDesc(t("settings.sendRawModelToRemote.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().sendRawModelToRemote)
          .onChange((val) => {
            this.plugin.updateSettings({ sendRawModelToRemote: val });
          }),
      );
  }

  private buildConvertersSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.converters")).setHeading();

    if (isMobile()) {
      containerEl.createEl("p", { cls: "setting-item-description", text: t("settings.mobileSupport.desc") });
      return;
    }

    const converterMenuEl = this.createSecondaryMenu(
      containerEl,
      t("settings.converterMenu"),
      t("settings.converterMenu.desc"),
    );

    this.buildConverterToggles(converterMenuEl);

    const diagnosticsMenuEl = this.createSecondaryMenu(
      containerEl,
      t("settings.environmentInspector"),
      t("settings.environmentInspector.desc"),
    );

    this.buildConverterPaths(diagnosticsMenuEl);
    this.buildDiagnostics(diagnosticsMenuEl);
  }

  private buildConverterToggles(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t("settings.enableCad"))
      .setDesc(t("settings.enableCad.desc"))
      .addToggle((toggle) => {
        const enabled = this.plugin.getSettings().enabledConverterIds.includes("freecad");
        return toggle.setValue(enabled).onChange((val) => {
          const current = this.plugin.getSettings().enabledConverterIds;
          const next = val
            ? Array.from(new Set([...current, "freecad"]))
            : current.filter((id) => id !== "freecad");
          this.plugin.updateSettings({ enabledConverterIds: next });
        });
      });

    new Setting(containerEl)
      .setName(t("settings.enableObj2gltf"))
      .setDesc(t("settings.enableObj2gltf.desc"))
      .addToggle((toggle) => {
        const enabled = this.plugin.getSettings().enabledConverterIds.includes("obj2gltf");
        return toggle.setValue(enabled).onChange((val) => {
          const current = this.plugin.getSettings().enabledConverterIds;
          const next = val
            ? Array.from(new Set([...current, "obj2gltf"]))
            : current.filter((id) => id !== "obj2gltf");
          this.plugin.updateSettings({ enabledConverterIds: next });
        });
      });

    new Setting(containerEl)
      .setName(t("settings.preferObj2gltf"))
      .setDesc(t("settings.preferObj2gltf.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().preferObj2gltfForObj)
          .onChange((val) => {
            this.plugin.updateSettings({ preferObj2gltfForObj: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.enableFbx2gltf"))
      .setDesc(t("settings.enableFbx2gltf.desc"))
      .addToggle((toggle) => {
        const enabled = this.plugin.getSettings().enabledConverterIds.includes("fbx2gltf");
        return toggle.setValue(enabled).onChange((val) => {
          const current = this.plugin.getSettings().enabledConverterIds;
          const next = val
            ? Array.from(new Set([...current, "fbx2gltf"]))
            : current.filter((id) => id !== "fbx2gltf");
          this.plugin.updateSettings({ enabledConverterIds: next });
        });
      });

    new Setting(containerEl)
      .setName(t("settings.enableMesh"))
      .setDesc(t("settings.enableMesh.desc"))
      .addToggle((toggle) => {
        const enabled = this.plugin.getSettings().enabledConverterIds.includes("assimp");
        return toggle.setValue(enabled).onChange((val) => {
          const current = this.plugin.getSettings().enabledConverterIds;
          const next = val
            ? Array.from(new Set([...current, "assimp"]))
            : current.filter((id) => id !== "assimp");
          this.plugin.updateSettings({ enabledConverterIds: next });
        });
      });

    new Setting(containerEl)
      .setName(t("settings.enableSldprt"))
      .setDesc(t("settings.enableSldprt.desc"))
      .addToggle((toggle) => {
        const enabled = this.plugin.getSettings().enabledConverterIds.includes("sldprt");
        return toggle.setValue(enabled).onChange((val) => {
          const current = this.plugin.getSettings().enabledConverterIds;
          const next = val
            ? Array.from(new Set([...current, "sldprt"]))
            : current.filter((id) => id !== "sldprt");
          this.plugin.updateSettings({ enabledConverterIds: next });
        });
      });
  }

  private buildConverterPaths(containerEl: HTMLElement): void {
    const commandPlaceholders = getConverterCommandPlaceholders();

    new Setting(containerEl).setName(t("settings.paths")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.pythonCmd"))
      .setDesc(t("settings.pythonCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.python)
          .setValue(this.plugin.getSettings().freecadCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ freecadCommand: val.trim() });
            this.resetCommandDiagnostics();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.freecadCmd"))
      .setDesc(t("settings.freecadCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.freecad)
          .setValue(this.plugin.getSettings().freecadcmdCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ freecadcmdCommand: val.trim() });
            this.resetCommandDiagnostics();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.obj2gltfCmd"))
      .setDesc(t("settings.obj2gltfCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.obj2gltf)
          .setValue(this.plugin.getSettings().obj2gltfCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ obj2gltfCommand: val.trim() });
            this.resetCommandDiagnostics();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.fbx2gltfCmd"))
      .setDesc(t("settings.fbx2gltfCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.fbx2gltf)
          .setValue(this.plugin.getSettings().fbx2gltfCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ fbx2gltfCommand: val.trim() });
            this.resetCommandDiagnostics();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.assimpCmd"))
      .setDesc(t("settings.assimpCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.python)
          .setValue(this.plugin.getSettings().assimpCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ assimpCommand: val.trim() });
            this.resetCommandDiagnostics();
          }),
      );
  }

  private buildDiagnostics(containerEl: HTMLElement): void {
    const diagnosticsSetting = new Setting(containerEl)
      .setName(t("settings.diagnostics"))
      .setDesc(t("settings.diagnostics.desc"));

    diagnosticsSetting.addButton((button) =>
      button
        .setButtonText(t("settings.diagnostics.checkNow"))
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText(t("settings.diagnostics.checking"));
          if (this.diagnosticsEl) {
            await this.renderCommandDiagnostics(this.diagnosticsEl);
          }
          button.setButtonText(t("settings.diagnostics.checkNow"));
          button.setDisabled(false);
          new Notice(t("settings.diagnostics.refreshed"));
        }),
    );

    this.diagnosticsEl = containerEl.createDiv({ cls: "ai3d-settings-diagnostics" });
    this.resetCommandDiagnostics();
  }

  private buildPerformanceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName(t("settings.performance")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.canvasHeight"))
      .setDesc(t("settings.canvasHeight.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(200, 800, 25)
          .setValue(this.plugin.getSettings().defaultCanvasHeight)
                    .onChange((val) => {
            this.plugin.updateSettings({ defaultCanvasHeight: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.autoRotateSpeed"))
      .setDesc(t("settings.autoRotateSpeed.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 2.0, 0.1)
          .setValue(this.plugin.getSettings().autoRotateSpeed)
                    .onChange((val) => {
            this.plugin.updateSettings({ autoRotateSpeed: val });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.renderQuality"))
      .setDesc(t("settings.renderQuality.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("low", "Low")
          .addOption("medium", "Medium")
          .addOption("high", "High")
          .setValue(this.plugin.getSettings().renderQuality)
          .onChange((val: string) => {
            this.plugin.updateSettings({ renderQuality: val as "low" | "medium" | "high" });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.renderScale"))
      .setDesc(t("settings.renderScale.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(0.25, 2.0, 0.25)
          .setValue(this.plugin.getSettings().renderScale)
                    .onChange((val) => {
            this.plugin.updateSettings({ renderScale: val });
          }),
      );
  }

  private async renderCommandDiagnostics(containerEl: HTMLElement): Promise<void> {
    const runId = ++this.diagnosticsRunId;
    containerEl.empty();
    containerEl.createEl("p", { text: t("settings.diagnostics.checkingAvailability") });

    const { describeConverterCommandSource, inspectAllConverterCommands } = await import("./io/conversion/command-discovery");
    const statuses = await inspectAllConverterCommands(this.plugin.getSettings());
    if (runId !== this.diagnosticsRunId) {
      return;
    }

    containerEl.empty();
    for (const status of statuses) {
      this.renderCommandStatus(containerEl, status, describeConverterCommandSource);
    }
  }

  private renderCommandStatus(
    containerEl: HTMLElement,
    status: ConverterCommandStatus,
    describeCommandSource: (source: ConverterCommandSource) => string,
  ): void {
    const block = containerEl.createDiv({ cls: "ai3d-settings-status-block" });

    block.createEl("strong", {
      text: `${status.label}: ${status.available ? t("settings.diagnostics.available") : t("settings.diagnostics.notFound")}`,
    });

    const lines = [
      `${t("settings.diagnostics.sourceLabel")}: ${describeCommandSource(status.source)}`,
      `${t("settings.diagnostics.commandLabel")}: ${status.command}`,
      status.resolvedPath && status.resolvedPath !== status.command ? `${t("settings.diagnostics.resolvedPathLabel")}: ${status.resolvedPath}` : "",
      status.detail,
    ].filter(Boolean);

    for (const line of lines) {
      block.createDiv({ text: line });
    }

    for (const check of status.dependencyChecks ?? []) {
      this.renderDependencyCheck(block, check);
    }
  }

  private renderDependencyCheck(containerEl: HTMLElement, check: ConverterDependencyCheck): void {
    const label = check.label ?? (() => {
      switch (check.kind) {
        case "cad-python":
          return t("settings.diagnostics.cadPythonCheck");
        case "mesh-python":
          return t("settings.diagnostics.meshPythonCheck");
        case "freecadcmd-cli":
          return t("settings.diagnostics.freecadCmdCheck");
        case "obj2gltf-cli":
          return t("settings.diagnostics.obj2gltfCheck");
        case "fbx2gltf-cli":
          return t("settings.diagnostics.fbx2gltfCheck");
      }
    })();
    const summary = check.ok ? t("settings.diagnostics.selfCheckOk") : t("settings.diagnostics.selfCheckFailed");
    containerEl.createDiv({ text: `${t("settings.diagnostics.selfCheckLabel")}: ${label} - ${summary}` });
    if (check.detail) {
      containerEl.createDiv({ text: check.detail });
    }
  }
}
