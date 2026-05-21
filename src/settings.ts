import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type AI3DModelWorkbench from "./main";
import { DEFAULT_SETTINGS } from "./domain/constants";
import {
  describeConverterCommandSource,
  inspectAllConverterCommands,
  type ConverterDependencyCheck,
  type ConverterCommandStatus,
} from "./io/conversion/command-discovery";
import { t, setLocale, type Locale } from "./i18n";
import { isMobile } from "./utils/device";
import { getRuntimeProcess } from "./utils/node-shim";

const proc = getRuntimeProcess();

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

  constructor(app: App, plugin: AI3DModelWorkbench) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    setLocale(this.plugin.getSettings().locale);
    const commandPlaceholders = getConverterCommandPlaceholders();
    const mobile = isMobile();
    let diagnosticsEl: HTMLDivElement | null = null;

    const createSecondaryMenu = (parent: HTMLElement, title: string, description: string): HTMLElement => {
      const detailsEl = parent.createEl("details", { cls: "ai3d-settings-secondary-menu" });
      detailsEl.createEl("summary", { cls: "ai3d-settings-secondary-menu-summary", text: title });
      const bodyEl = detailsEl.createDiv({ cls: "ai3d-settings-secondary-menu-body" });
      bodyEl.createEl("p", { cls: "setting-item-description", text: description });
      return bodyEl;
    };

    const resetCommandDiagnostics = (): void => {
      if (!diagnosticsEl) return;
      this.diagnosticsRunId++;
      diagnosticsEl.empty();
      diagnosticsEl.createEl("p", { text: t("settings.diagnostics.idle") });
    };

    new Setting(containerEl).setName(t("settings.title")).setHeading();

    // ── Language ─────────────────────────────────────────────────

    new Setting(containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("en", "English")
          .addOption("zh-CN", "简体中文")
          .setValue(this.plugin.getSettings().locale)
          .onChange((val: string) => {
            this.plugin.updateSettings({ locale: val as Locale });
            this.display();
          }),
      );

    // ── Folders ──────────────────────────────────────────────────

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

    // ── Behavior ─────────────────────────────────────────────────

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

    // ── Converters ───────────────────────────────────────────────

    new Setting(containerEl).setName(t("settings.converters")).setHeading();

    if (mobile) {
      containerEl.createEl("p", { cls: "setting-item-description", text: t("settings.mobileSupport.desc") });
    } else {
    const converterMenuEl = createSecondaryMenu(
      containerEl,
      t("settings.converterMenu"),
      t("settings.converterMenu.desc"),
    );

    new Setting(converterMenuEl)
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

    new Setting(converterMenuEl)
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

    new Setting(converterMenuEl)
      .setName(t("settings.preferObj2gltf"))
      .setDesc(t("settings.preferObj2gltf.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.getSettings().preferObj2gltfForObj)
          .onChange((val) => {
            this.plugin.updateSettings({ preferObj2gltfForObj: val });
          }),
      );

    new Setting(converterMenuEl)
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

    new Setting(converterMenuEl)
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

    new Setting(converterMenuEl)
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

    const diagnosticsMenuEl = createSecondaryMenu(
      containerEl,
      t("settings.environmentInspector"),
      t("settings.environmentInspector.desc"),
    );

    // ── Converter Paths ──────────────────────────────────────────

    new Setting(diagnosticsMenuEl).setName(t("settings.paths")).setHeading();

    new Setting(diagnosticsMenuEl)
      .setName(t("settings.pythonCmd"))
      .setDesc(t("settings.pythonCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.python)
          .setValue(this.plugin.getSettings().freecadCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ freecadCommand: val.trim() });
            resetCommandDiagnostics();
          }),
      );

    new Setting(diagnosticsMenuEl)
      .setName(t("settings.freecadCmd"))
      .setDesc(t("settings.freecadCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.freecad)
          .setValue(this.plugin.getSettings().freecadcmdCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ freecadcmdCommand: val.trim() });
            resetCommandDiagnostics();
          }),
      );

    new Setting(diagnosticsMenuEl)
      .setName(t("settings.obj2gltfCmd"))
      .setDesc(t("settings.obj2gltfCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.obj2gltf)
          .setValue(this.plugin.getSettings().obj2gltfCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ obj2gltfCommand: val.trim() });
            resetCommandDiagnostics();
          }),
      );

    new Setting(diagnosticsMenuEl)
      .setName(t("settings.fbx2gltfCmd"))
      .setDesc(t("settings.fbx2gltfCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.fbx2gltf)
          .setValue(this.plugin.getSettings().fbx2gltfCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ fbx2gltfCommand: val.trim() });
            resetCommandDiagnostics();
          }),
      );

    new Setting(diagnosticsMenuEl)
      .setName(t("settings.assimpCmd"))
      .setDesc(t("settings.assimpCmd.desc"))
      .addText((text) =>
        text
          .setPlaceholder(commandPlaceholders.python)
          .setValue(this.plugin.getSettings().assimpCommand)
          .onChange((val) => {
            this.plugin.updateSettings({ assimpCommand: val.trim() });
            resetCommandDiagnostics();
          }),
      );

    // ── Diagnostics ──────────────────────────────────────────────

    const diagnosticsSetting = new Setting(diagnosticsMenuEl)
      .setName(t("settings.diagnostics"))
      .setDesc(t("settings.diagnostics.desc"));

    diagnosticsSetting.addButton((button) =>
      button
        .setButtonText(t("settings.diagnostics.checkNow"))
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText(t("settings.diagnostics.checking"));
          if (diagnosticsEl) {
            await this.renderCommandDiagnostics(diagnosticsEl);
          }
          button.setButtonText(t("settings.diagnostics.checkNow"));
          button.setDisabled(false);
          new Notice(t("settings.diagnostics.refreshed"));
        }),
    );

    diagnosticsEl = diagnosticsMenuEl.createDiv({ cls: "ai3d-settings-diagnostics" });
    resetCommandDiagnostics();

    }

    // ── Performance ──────────────────────────────────────────────

    new Setting(containerEl).setName(t("settings.performance")).setHeading();

    new Setting(containerEl)
      .setName(t("settings.canvasHeight"))
      .setDesc(t("settings.canvasHeight.desc"))
      .addSlider((slider) =>
        slider
          .setLimits(200, 800, 25)
          .setValue(this.plugin.getSettings().defaultCanvasHeight)
          .setDynamicTooltip()
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
          .setDynamicTooltip()
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
          .setDynamicTooltip()
          .onChange((val) => {
            this.plugin.updateSettings({ renderScale: val });
          }),
      );
  }

  private async renderCommandDiagnostics(containerEl: HTMLElement): Promise<void> {
    const runId = ++this.diagnosticsRunId;
    containerEl.empty();
    containerEl.createEl("p", { text: t("settings.diagnostics.checkingAvailability") });

    const statuses = await inspectAllConverterCommands(this.plugin.getSettings());
    if (runId !== this.diagnosticsRunId) {
      return;
    }

    containerEl.empty();
    for (const status of statuses) {
      this.renderCommandStatus(containerEl, status);
    }
  }

  private renderCommandStatus(containerEl: HTMLElement, status: ConverterCommandStatus): void {
    const block = containerEl.createDiv({ cls: "ai3d-settings-status-block" });

    block.createEl("strong", {
      text: `${status.label}: ${status.available ? t("settings.diagnostics.available") : t("settings.diagnostics.notFound")}`,
    });

    const lines = [
      `${t("settings.diagnostics.sourceLabel")}: ${describeConverterCommandSource(status.source)}`,
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
    const label = (() => {
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
