import type { App } from "obsidian";
import { MarkdownView, Notice, TFile, setIcon } from "obsidian";
import type { PluginStore } from "../../store/plugin-store";
import type { PluginState, ModelAssetProfile, ModelPartSummary } from "../../domain/models";
import { normalizeTagList } from "../../utils/format";
import { AnnotationManager } from "../../render/preview/annotations";
import { formatPreviewWorldPoint } from "../../render/preview/report";
import { createLoggedModelPreview } from "../../render/preview/selection";
import type { PreviewAxis, WorkbenchPreview } from "../../render/preview/types";
import { html } from "./h";
import { prepareModelInput } from "../../io/model-pipeline";
import { createConversionManager } from "../../io/conversion/factory";
import type { ConvertedAssetCache } from "../../io/cache/converted-asset-cache";
import { toPreviewSource } from "../../io/preview/preview-source";
import { createLogger } from "../../utils/log";
import { getPortableStem, readBinaryPath, resolveVaultAbsolutePath } from "../../utils/resolve-path";
import { listPreferredConversionExts } from "../../io/formats/route-preferences";
import { createNoteReader, createHeadingSearch } from "../../utils/note-reader";
import { describeModelLoadFailure, type ModelLoadFailureDetails, isMissingConverterError } from "../../io/conversion/errors";
import { formatT, t } from "../../i18n";
import { renderModelLoadFailure } from "../model-load-feedback";
import { isMobile } from "../../utils/device";
import { buildKnowledgeNoteContent, LOCAL_ANALYSIS_VERSION } from "./knowledge-note";
import { ModelFileSuggestModal } from "../model-file-suggest-modal";
import { listSupportedModelExtensions } from "../../io/formats/registry";

const log = createLogger("workbench");

function replaceWithHtml(el: HTMLElement, result: unknown): void {
  el.replaceChildren();
  const nodes: Node[] = [];
  function flatten(v: unknown): void {
    if (Array.isArray(v)) { for (const item of v) flatten(item); }
    else if (v instanceof Node) nodes.push(v);
  }
  flatten(result);
  if (nodes.length > 0) el.append(...nodes);
}

function getProfileTags(profile: Partial<ModelAssetProfile> | null | undefined): string[] {
  return Array.isArray(profile?.tags) ? profile.tags : [];
}

function getProfileAnnotations(profile: Partial<ModelAssetProfile> | null | undefined): ModelAssetProfile["annotations"] {
  return Array.isArray(profile?.annotations) ? profile.annotations : [];
}

export function mountWorkbench(
  container: HTMLElement,
  app: App,
  ps: PluginStore,
  convertedAssetCache: ConvertedAssetCache,
): () => void {
  const mobile = isMobile();
  container.classList.add("ai3d-workbench");
  container.classList.toggle("is-mobile", mobile);

  let preview: WorkbenchPreview | null = null;
  let annotationMgr: AnnotationManager | null = null;
  let annotationMode = false;
  let focusSelectionMode = false;
  let loading = false;
  const initialState = ps.store.getState();
  let queuedModelPath: string | null | undefined = initialState.currentModelPath;
  let lastObservedModelPath = initialState.currentModelPath;
  let lastObservedPreview = initialState.modelPreview;
  const supportedImportExts = listSupportedModelExtensions().map((ext) => ext.toUpperCase());

  function renderIcon(iconName: string): HTMLElement {
    const icon = activeDocument.createElement("span");
    icon.className = "ai3d-ui-icon";
    setIcon(icon, iconName);
    return icon;
  }

  function getModelLabel(path: string | null): string {
    if (!path) return t("workbench.noModelLoaded");
    return getPortableStem(path) || path;
  }

  function getModelExt(path: string | null): string | null {
    if (!path) return null;
    const ext = path.split(".").pop()?.trim();
    return ext ? ext.toUpperCase() : null;
  }

  function renderMetric(label: string, value: string, className = "") {
    return html`
      <div class=${`ai3d-summary-item ${className}`.trim()}>
        <div class="ai3d-summary-label">${label}</div>
        <div class="ai3d-summary-value">${value}</div>
      </div>
    `;
  }

  function renderIconLabel(iconName: string, label: string): HTMLElement[] {
    return [
      renderIcon(iconName),
      html`<span>${label}</span>` as HTMLElement,
    ];
  }

  function selectModel(file: TFile): void {
    if (ps.store.getState().currentModelPath === file.path) {
      ps.store.setState({
        currentModelPath: null,
        modelPreview: null,
        selectedPart: null,
      });
    }

    ps.store.setState({
      currentModelPath: file.path,
      modelPreview: null,
      selectedPart: null,
    });
  }

  function openImportModal(): void {
    new ModelFileSuggestModal(app, (file) => {
      selectModel(file);
    }).open();
  }

  function openPluginSettings(): void {
    const setting = (app as App & {
      setting?: {
        open: () => void;
        openTabById?: (id: string) => void;
      };
    }).setting;
    if (!setting) {
      new Notice(t("workbench.settingsUnavailable"));
      return;
    }
    setting.open();
    setting.openTabById?.("ai-model-workbench");
  }

  function getCurrentModelPathOrNotice(): string | null {
    const path = ps.store.getState().currentModelPath;
    if (!path) {
      new Notice(t("workbench.noModelLoaded"));
      return null;
    }
    return path;
  }

  function scrollToWorkbenchPanel(target: string | undefined): void {
    if (!target) return;
    const selectors: Record<string, string> = {
      details: ".ai3d-detail-hero",
      previews: ".ai3d-preview-views-panel",
      connections: ".ai3d-compare-panel",
      disassembly: ".ai3d-disassemble-controls",
      tags: ".ai3d-tag-section",
      annotations: ".ai3d-annot-section",
    };
    const selector = selectors[target];
    if (!selector) return;
    const targetEl = container.querySelector<HTMLElement>(selector);
    targetEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderPartDetail(part: ModelPartSummary): HTMLElement {
    const metrics = [
      { label: t("workbench.trianglesLabel"), value: part.triangleCount.toLocaleString() },
      { label: t("workbench.verticesLabel"), value: part.vertexCount.toLocaleString() },
      { label: t("workbench.materialsLabel"), value: part.materialName ?? "-" },
      { label: t("workbench.boundingSizeLabel"), value: formatPreviewWorldPoint(part.boundingSize) },
      { label: t("workbench.centerLabel"), value: formatPreviewWorldPoint(part.center, { separator: ", " }) },
    ];

    return html`
      <div class="ai3d-section ai3d-detail-hero ai3d-part-detail">
        <div class="ai3d-section-header ai3d-detail-hero-header">
          <div class="ai3d-section-title">${t("workbench.selectedPartTitle")}</div>
          <button class="ai3d-icon-button" type="button" data-action="save" title=${t("workbench.saveProfileAction")}>
            ${renderIcon("heart")}
          </button>
        </div>
        <div class="ai3d-section-body">
          <div class="ai3d-detail-hero-top">
            <div class="ai3d-detail-orb is-part">
              <span>${renderIcon("box")}</span>
            </div>
            <div class="ai3d-detail-copy">
              <strong>${part.name || t("workbench.partMeshLabel")}</strong>
              <span>${t("workbench.partMeshLabel")}</span>
              <div class="ai3d-detail-hero-chips">
                <span class="ai3d-tag-chip">${t("workbench.selectedPartTitle")}</span>
              </div>
            </div>
          </div>
          <div class="ai3d-detail-spec-grid">
            ${metrics.map((metric) => html`
              <div class="ai3d-detail-spec">
                <span>${metric.label}</span>
                <strong>${metric.value}</strong>
              </div>
            `)}
          </div>
        </div>
      </div>
    ` as HTMLElement;
  }

  function renderModelDetail(state: PluginState): HTMLElement {
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const summary = state.modelPreview;
    const ext = getModelExt(path);
    const metrics = [
      { label: t("workbench.meshesLabel"), value: summary ? summary.meshCount.toLocaleString() : "-" },
      {
        label: summary?.splatCount ? t("workbench.splatsLabel") : t("workbench.trianglesLabel"),
        value: summary ? (summary.splatCount ?? summary.triangleCount).toLocaleString() : "-",
      },
      { label: t("workbench.verticesLabel"), value: summary ? summary.vertexCount.toLocaleString() : "-" },
      { label: t("workbench.materialsLabel"), value: summary ? String(summary.materialCount) : "-" },
      { label: t("workbench.boundingSizeLabel"), value: summary ? formatPreviewWorldPoint(summary.boundingSize) : "-" },
    ];

    return html`
      <div class="ai3d-section ai3d-detail-hero">
        <div class="ai3d-section-header ai3d-detail-hero-header">
          <div class="ai3d-section-title">${t("workbench.recordTitle")}</div>
          <button class="ai3d-icon-button" type="button" data-action="save" title=${t("workbench.saveProfileAction")}>
            ${renderIcon("heart")}
          </button>
        </div>
        <div class="ai3d-section-body">
          <div class="ai3d-detail-hero-top">
            <div class="ai3d-detail-orb">
              <span>${ext ?? "3D"}</span>
            </div>
            <div class="ai3d-detail-copy">
              <strong>${getModelLabel(path)}</strong>
              <span>${path ?? t("workbench.emptyText")}</span>
              <div class="ai3d-detail-hero-chips">
                ${profile?.analysisVersion ? html`<span class="ai3d-tag-chip">${profile.analysisVersion}</span>` : ""}
                <span class="ai3d-tag-chip">${t(profile?.reportNotePath ? "workbench.noteReady" : "workbench.notePending")}</span>
              </div>
            </div>
          </div>
          <div class="ai3d-detail-spec-grid">
            ${metrics.map((metric) => html`
              <div class="ai3d-detail-spec">
                <span>${metric.label}</span>
                <strong>${metric.value}</strong>
              </div>
            `)}
          </div>
        </div>
      </div>
    ` as HTMLElement;
  }

  function renderAnalysisNotes(state: PluginState): HTMLElement {
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const tagCount = getProfileTags(profile).length;
    const pinCount = getProfileAnnotations(profile).length;
    const notePath = profile?.reportNotePath;

    return html`
      <div class="ai3d-section ai3d-notes-card">
        <div class="ai3d-section-header">
          <div class="ai3d-section-title">${t("workbench.notesTitle")}</div>
        </div>
        <div class="ai3d-section-body">
          <p class="ai3d-note-copy">${notePath ?? t("workbench.noReportYet")}</p>
          <div class="ai3d-note-facts">
            <span>${tagCount} ${t("workbench.tagsTitle")}</span>
            <span>${formatT("workbench.pinCount", { count: String(pinCount) })}</span>
            <span>${t(notePath ? "workbench.noteReady" : "workbench.notePending")}</span>
          </div>
          <button class="ai3d-card-action" type="button" data-action=${notePath ? "open-note" : "note"} disabled=${!path}>
            ${notePath ? renderIconLabel("book-open", t("workbench.openNoteAction")) : renderIconLabel("file-plus-2", t("workbench.generateNoteAction"))}
          </button>
        </div>
      </div>
    ` as HTMLElement;
  }

  function renderConnectionMap(state: PluginState): HTMLElement {
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const notePath = profile?.reportNotePath;

    return html`
      <div class="ai3d-section ai3d-occurrence-card">
        <div class="ai3d-section-header">
          <div class="ai3d-section-title">${t("workbench.whereTitle")}</div>
        </div>
        <div class="ai3d-section-body">
          <div class="ai3d-occurrence-map" aria-hidden="true">
            <span class="ai3d-occurrence-node is-source"></span>
            <span class="ai3d-occurrence-line"></span>
            <span class="ai3d-occurrence-node is-target"></span>
          </div>
          <strong>${getModelLabel(path)}</strong>
          <span>${notePath ? (getPortableStem(notePath) ?? notePath) : t("workbench.noReportYet")}</span>
          <button class="ai3d-card-action" type="button" data-action=${notePath ? "open-note" : "note"} disabled=${!path}>
            ${notePath ? renderIconLabel("book-open", t("workbench.openNoteAction")) : renderIconLabel("file-plus-2", t("workbench.generateNoteAction"))}
          </button>
        </div>
      </div>
    ` as HTMLElement;
  }

  function insertMarkdownOrCopy(markdown: string): void {
    const mdView = app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView && "editor" in mdView) {
      mdView.editor.replaceSelection(markdown);
      new Notice(t("workbench.templateInserted"));
      return;
    }
    void navigator.clipboard.writeText(markdown).then(() => {
      new Notice(t("workbench.templateCopied"));
    }).catch(() => {});
  }

  function buildGridTemplate(path: string, preset: "gallery" | "compare"): string {
    const models = preset === "compare"
      ? [{ path }, { path }]
      : [{ path }];
    return [
      "```3dgrid",
      JSON.stringify({
        models,
        preset,
        params: preset === "compare" ? { angle: "iso", spacing: 6 } : { angle: "iso", cols: 1, spacing: 6 },
      }, null, 2),
      "```",
      "",
    ].join("\n");
  }

  // Focus camera on a pin's world position
  function focusPin(pinId: string): void {
    if (!annotationMgr || !preview) return;
    const pos = annotationMgr.getPinPosition(pinId);
    if (!pos) return;
    preview.focusWorldPoint(pos);
  }

  // ESC key to exit annotation mode
  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape" && annotationMode) {
      setAnnotationMode(false);
    }
  };
  activeDocument.addEventListener("keydown", handleEsc);

  // ── Stable preview host (never removed from DOM) ──
  // Create on container (in DOM) to inherit Obsidian CSS variables
  const headerEl = container.createDiv({ cls: "ai3d-studio-topbar" });
  const layoutEl = container.createDiv({ cls: "ai3d-studio-grid" });
  const leftRailEl = layoutEl.createDiv({ cls: "ai3d-left-rail" });
  const centerStackEl = layoutEl.createDiv({ cls: "ai3d-center-stack" });
  const stageEl = centerStackEl.createDiv({ cls: "ai3d-stage-shell" });
  const stageChromeEl = stageEl.createDiv({ cls: "ai3d-stage-chrome" });
  const previewHost = stageEl.createDiv({ cls: "ai3d-preview-host" });
  if (mobile) {
    previewHost.classList.add("is-mobile-scroll-mode");
  }
  const emptyState = html`
    <div class="ai3d-empty-state ai3d-empty-stage">
      <div class="ai3d-empty-shell">
        <div class="ai3d-empty-kicker">AI 3D Workbench</div>
        <div class="ai3d-empty-title">${t("workbench.emptyTitle")}</div>
        <div class="ai3d-empty-text">${t("workbench.emptyText")}</div>
        <div class="ai3d-empty-actions">
          <button class="ai3d-axis-btn is-active" onClick=${() => openImportModal()}>
            ${t("main.commandImportModel")}
          </button>
        </div>
        <div class="ai3d-empty-format-row">
          ${supportedImportExts.slice(0, 8).map((ext) => html`<span class="ai3d-stage-pill">${ext}</span>`)}
        </div>
      </div>
    </div>
  ` as HTMLElement;
  previewHost.appendChild(emptyState);

  // Semi-transparent overlay for annotation mode
  const modeOverlay = previewHost.createDiv({ cls: "ai3d-annot-mode-overlay is-hidden" });

  let mobilePreviewInteractive = false;
  const mobilePreviewBar = mobile ? stageEl.createDiv({ cls: "ai3d-mobile-mode-bar is-detached is-hidden" }) : null;
  const mobilePreviewHint = mobilePreviewBar?.createDiv({ cls: "ai3d-mobile-mode-hint", text: t("workbench.mobileHint") }) ?? null;
  const mobilePreviewModeBtn = mobilePreviewBar?.createEl("button", {
    cls: "ai3d-mobile-mode-btn",
    text: t("helper.interactAction"),
    attr: { "aria-label": t("helper.enableInteractionLabel") },
  }) ?? null;

  function setMobilePreviewInteraction(active: boolean): void {
    if (!mobile) return;
    mobilePreviewInteractive = active;
    previewHost.classList.toggle("is-mobile-interactive", active);
    previewHost.classList.toggle("is-mobile-scroll-mode", !active);
    if (mobilePreviewModeBtn) {
      mobilePreviewModeBtn.textContent = active ? t("helper.scrollAction") : t("helper.interactAction");
      mobilePreviewModeBtn.classList.toggle("ai3d-btn-active", active);
      mobilePreviewModeBtn.setAttribute(
        "aria-label",
        active ? t("helper.disableInteractionLabel") : t("helper.enableInteractionLabel"),
      );
    }
    if (mobilePreviewHint) {
      mobilePreviewHint.textContent = active ? t("workbench.mobileHintInteractive") : t("workbench.mobileHint");
    }
  }

  mobilePreviewModeBtn?.addEventListener("click", () => {
    const nextInteractive = !mobilePreviewInteractive;
    if (!nextInteractive && annotationMode) {
      setAnnotationMode(false);
    }
    setMobilePreviewInteraction(nextInteractive);
  });

  function clearInlineMessages(): void {
    previewHost.querySelectorAll(".ai3d-inline-empty:not(.ai3d-empty-state)").forEach((el) => el.remove());
  }

  function destroyActivePreview(): void {
    annotationMgr?.hideEditor();
    annotationMgr?.destroy();
    annotationMgr = null;
    annotationMode = false;
    focusSelectionMode = false;
    modeOverlay.classList.add("is-hidden");
    mobilePreviewBar?.classList.add("is-hidden");
    setMobilePreviewInteraction(false);
    preview?.destroy();
    preview = null;
    previewHost.querySelectorAll(".ai3d-canvas-full").forEach((el) => el.remove());
    clearInlineMessages();
    ps.store.setState({ selectedPart: null });
  }

  function showEmptyPreview(message?: string | ModelLoadFailureDetails): void {
    destroyActivePreview();
    emptyState.classList.remove("is-hidden");
    if (message) {
      if (typeof message === "string") {
        const errDiv = previewHost.createDiv({ cls: "ai3d-inline-empty" });
        errDiv.textContent = message;
      } else {
        renderModelLoadFailure(previewHost, message);
      }
    }
  }

  function setAnnotationMode(active: boolean) {
    annotationMode = active;
    if (mobile && active) {
      setMobilePreviewInteraction(true);
    }
    annotationMgr?.hideEditor();
    modeOverlay.classList.toggle("is-hidden", !active);
    renderPanels();
  }

  // ── Panels container (re-rendered on state change) ──
  const bottomPanelsEl = centerStackEl.createDiv({ cls: "ai3d-bottom-panels" });
  const panelsEl = layoutEl.createDiv({ cls: "ai3d-right-rail ai3d-panels" });

  function listWorkbenchModelPaths(state: PluginState): string[] {
    const seen = new Set<string>();
    const paths: string[] = [];
    const add = (path: string | null | undefined) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    };

    add(state.currentModelPath);
    Object.keys(state.modelAssetProfiles)
      .sort((left, right) => {
        const leftUpdated = state.modelAssetProfiles[left]?.updatedAt ?? "";
        const rightUpdated = state.modelAssetProfiles[right]?.updatedAt ?? "";
        return rightUpdated.localeCompare(leftUpdated);
      })
      .forEach(add);
    state.convertedAssetRecords
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .forEach((record) => {
        add(record.sourcePath);
        add(record.outputPath);
      });

    return paths.slice(0, 8);
  }

  function selectModelPath(path: string): void {
    if (ps.store.getState().currentModelPath === path) return;
    ps.store.setState({
      currentModelPath: path,
      modelPreview: null,
      selectedPart: null,
    });
  }

  function renderStudioHeader(state: PluginState): void {
    const path = state.currentModelPath;
    const ext = getModelExt(path);
    const reportNotePath = path ? state.modelAssetProfiles[path]?.reportNotePath : undefined;
    const navItems = [
      { label: t("workbench.navGallery"), icon: "layout-grid", action: "gallery", disabled: !preview },
      { label: t("workbench.navLibrary"), icon: "folder-open", leftAction: "import-model", active: true },
      {
        label: t("workbench.navNotebooks"),
        icon: "book-open",
        action: reportNotePath ? "open-note" : "note",
        disabled: !path,
      },
      { label: t("workbench.navSettings"), icon: "settings", action: "open-settings" },
    ];

    replaceWithHtml(headerEl, html`
      <div class="ai3d-brand-block">
        <div class="ai3d-brand-mark" aria-hidden="true">${renderIcon("sparkles")}</div>
        <div class="ai3d-brand-copy">
          <h1>${t("workbench.studioTitle")}</h1>
          <p>${t("workbench.studioTagline")}</p>
        </div>
      </div>
      <nav class="ai3d-top-nav" aria-label=${t("workbench.navLabel")}>
        ${navItems.map((item, index) => html`
          <button
            class=${`ai3d-top-nav-item ${item.active || index === 1 ? "is-active" : ""}`.trim()}
            type="button"
            data-action=${item.action ?? ""}
            data-left-action=${item.leftAction ?? ""}
            disabled=${item.disabled ?? false}
            title=${item.label}
          >
            ${renderIcon(item.icon)}
            <span>${item.label}</span>
          </button>
        `)}
        <button class="ai3d-avatar-chip" type="button" data-action="save" title=${t("workbench.saveProfileAction")}>
          ${ext ?? "3D"}
        </button>
      </nav>
    `);
    wireWorkbenchActions(headerEl);
  }

  function renderLeftRail(state: PluginState): void {
    const paths = listWorkbenchModelPaths(state);
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const tags = getProfileTags(profile);
    const annotations = getProfileAnnotations(profile);
    const summary = state.modelPreview;

    replaceWithHtml(leftRailEl, html`
      <section class="ai3d-panel ai3d-library-panel">
        <div class="ai3d-panel-heading">
          <span>${renderIcon("leaf")}${t("workbench.sourcesTitle")}</span>
          <span class="ai3d-panel-count">${String(paths.length)}</span>
        </div>
        <div class="ai3d-model-list">
          ${paths.length > 0
            ? paths.map((itemPath, index) => {
                const itemProfile = state.modelAssetProfiles[itemPath];
                const active = itemPath === path;
                const itemTags = getProfileTags(itemProfile).length;
                const itemAnnotations = getProfileAnnotations(itemProfile).length;
                const hasNote = Boolean(itemProfile?.reportNotePath);
                return html`
                  <button class=${`ai3d-model-row ${active ? "is-active" : ""}`} type="button" data-model-path=${itemPath}>
                    <span class=${`ai3d-mini-model ai3d-thumb-${index % 6} ${hasNote ? "is-note" : ""}`}>
                      <span class="ai3d-mini-model-badge">${getModelExt(itemPath) ?? "3D"}</span>
                    </span>
                    <span class="ai3d-model-row-copy">
                      <strong>${getModelLabel(itemPath)}</strong>
                      <span>${itemPath}</span>
                      <span class="ai3d-model-row-meta">
                        <em>${itemTags} ${t("workbench.tagsTitle")}</em>
                        <em>${itemAnnotations} ${t("workbench.annotationsTitle")}</em>
                        ${hasNote ? html`<em class="ai3d-model-row-note">${t("workbench.noteReady")}</em>` : ""}
                      </span>
                    </span>
                    <span class=${`ai3d-favorite-dot ${itemAnnotations > 0 ? "is-on" : ""}`}></span>
                  </button>
                `;
              })
            : html`<div class="ai3d-rail-empty">${t("workbench.noModelLoaded")}</div>`}
          <button class="ai3d-model-row ai3d-import-row" type="button" data-left-action="import-model">
            <span class="ai3d-mini-model ai3d-thumb-import">
              <span class="ai3d-mini-model-badge">+</span>
            </span>
            <span class="ai3d-model-row-copy">
              <strong>${t("main.commandImportModel")}</strong>
              <span>${supportedImportExts.slice(0, 5).join(", ")}</span>
            </span>
          </button>
        </div>
      </section>

      <section class="ai3d-panel ai3d-layer-panel">
        <div class="ai3d-panel-heading">
          <span>${renderIcon("sparkles")}${t("workbench.layersTitle")}</span>
        </div>
        <div class="ai3d-layer-list">
          <button class="ai3d-layer-row is-active" type="button" data-scroll-target="details">
            <span class="ai3d-color-dot"></span>
            <span>${summary ? `${summary.meshCount.toLocaleString()} ${t("workbench.meshesLabel")}` : t("workbench.summaryTitle")}</span>
          </button>
          <button class="ai3d-layer-row" type="button" data-scroll-target="annotations">
            <span class="ai3d-color-dot is-purple"></span>
            <span>${formatT("workbench.pinCount", { count: String(annotations.length) })}</span>
          </button>
          <button class="ai3d-layer-row" type="button" data-scroll-target="tags">
            <span class="ai3d-color-dot is-green"></span>
            <span>${tags.length > 0 ? tags.slice(0, 3).join(", ") : t("workbench.noTagsYet")}</span>
          </button>
        </div>
      </section>
    `);

    leftRailEl.querySelectorAll<HTMLElement>("[data-model-path]").forEach((el) => {
      el.addEventListener("click", () => {
        const nextPath = el.dataset.modelPath;
        if (nextPath) selectModelPath(nextPath);
      });
    });
    leftRailEl.querySelector<HTMLElement>("[data-left-action='import-model']")
      ?.addEventListener("click", () => openImportModal());
    leftRailEl.querySelectorAll<HTMLElement>("[data-scroll-target]").forEach((el) => {
      el.addEventListener("click", () => scrollToWorkbenchPanel(el.dataset.scrollTarget));
    });
  }

  // ── Event delegation: single handler on container ──
  function handleDelegatedClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>("[data-action]");
    const leftActionEl = target.closest<HTMLElement>("[data-left-action]");
    const scrollEl = target.closest<HTMLElement>("[data-scroll-target]");
    const modelPathEl = target.closest<HTMLElement>("[data-model-path]");
    const viewModeEl = target.closest<HTMLElement>("[data-view-mode]");
    const pinIdEl = target.closest<HTMLElement>("[data-pin-id][data-action]");

    if (modelPathEl) {
      const nextPath = modelPathEl.dataset.modelPath;
      if (nextPath) selectModelPath(nextPath);
      return;
    }

    if (leftActionEl) {
      const action = leftActionEl.dataset.leftAction;
      if (action === "import-model") openImportModal();
      return;
    }

    if (scrollEl) {
      scrollToWorkbenchPanel(scrollEl.dataset.scrollTarget);
      return;
    }

    if (viewModeEl) {
      const mode = viewModeEl.dataset.viewMode;
      if (!preview) return;
      if (mode === "mesh" && focusSelectionMode) {
        focusSelectionMode = preview.toggleFocusSelection();
      } else if (mode === "focus") {
        focusSelectionMode = preview.toggleFocusSelection();
      }
      renderPanels();
      return;
    }

    if (!actionEl) return;
    const action = actionEl.dataset.action;

    // Pin-specific actions (edit/delete/focus)
    if (pinIdEl && pinIdEl !== actionEl) {
      const pinId = pinIdEl.dataset.pinId!;
      if (action === "edit-pin") { annotationMgr?.editPin(pinId); return; }
      if (action === "delete-pin") { annotationMgr?.removePin(pinId); return; }
      if (action === "focus-pin") { focusPin(pinId); return; }
    }

    switch (action) {
      case "open-settings": openPluginSettings(); break;
      case "toggle-annot":
        if (actionEl instanceof HTMLInputElement) return;
        setAnnotationMode(!annotationMode);
        break;
      case "save":
        void ps.save();
        new Notice(t("workbench.profileSaved"));
        break;
      case "reset":
        preview?.resetView();
        ps.store.setState({ selectedPart: null });
        new Notice(t("workbench.viewReset"));
        break;
      case "info": {
        if (!preview) break;
        const md = preview.exportModelInfo(ps.store.getState().currentModelPath ?? undefined);
        if (!md) break;
        const mdView = app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView && "editor" in mdView) {
          mdView.editor.replaceSelection(md);
          new Notice(t("workbench.infoInserted"));
        } else {
          void navigator.clipboard.writeText(md).then(() => new Notice(t("workbench.infoCopied"))).catch(() => {});
        }
        break;
      }
      case "anim": {
        if (!preview?.toggleAnimation) break;
        const playing = preview.toggleAnimation();
        actionEl.replaceChildren(...renderIconLabel(playing ? "pause" : "play", playing ? t("workbench.pauseAction") : t("workbench.playAction")));
        break;
      }
      case "gallery": {
        const p = getCurrentModelPathOrNotice();
        if (p) insertMarkdownOrCopy(buildGridTemplate(p, "gallery"));
        break;
      }
      case "compare": {
        const p = getCurrentModelPathOrNotice();
        if (p) insertMarkdownOrCopy(buildGridTemplate(p, "compare"));
        break;
      }
      case "note":
        if (getCurrentModelPathOrNotice()) void generateKnowledgeNote(app, ps);
        break;
      case "open-note": {
        const modelPath = ps.store.getState().currentModelPath;
        if (!modelPath) break;
        const notePath = ps.store.getState().modelAssetProfiles[modelPath]?.reportNotePath;
        if (!notePath) break;
        const file = app.vault.getAbstractFileByPath(notePath);
        if (!(file instanceof TFile)) {
          new Notice(formatT("workbench.fileNotFound", { path: notePath }));
          break;
        }
        void app.workspace.getLeaf(true).openFile(file, { active: true });
        break;
      }
    }
  }

  container.addEventListener("click", handleDelegatedClick);
  // Wire input change for toggle-annot checkbox
  container.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.dataset.action === "toggle-annot") {
      setAnnotationMode(target.checked);
    }
  });

  // Legacy wireWorkbenchActions kept for pin-specific actions in annotations section
  function wireWorkbenchActions(_root: HTMLElement): void {
    // No-op: all actions handled by delegation
  }

  function renderBottomPanels(state: PluginState): void {
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const reportNotePath = profile?.reportNotePath;

    replaceWithHtml(bottomPanelsEl, html`
      <section class="ai3d-panel ai3d-preview-views-panel">
        <div class="ai3d-panel-heading">
          <span>${t("workbench.previewViewsTitle")}</span>
        </div>
        <div class="ai3d-micro-card-row">
          <button class="ai3d-micro-card" type="button" data-action="reset" disabled=${!preview}>
            <span>${renderIcon("rotate-ccw")}</span>
            <strong>${t("workbench.resetViewAction")}</strong>
          </button>
          <button class="ai3d-micro-card" type="button" data-action="info" disabled=${!preview}>
            <span class="is-purple">${renderIcon("file-text")}</span>
            <strong>${t("workbench.insertInfoAction")}</strong>
          </button>
          <button class="ai3d-micro-card" type="button" data-action="gallery" disabled=${!preview}>
            <span class="is-green">${renderIcon("layout-grid")}</span>
            <strong>${t("workbench.insertGalleryAction")}</strong>
          </button>
          <button class="ai3d-micro-card ai3d-add-card" type="button" data-action="compare" disabled=${!preview}>
            <span>${renderIcon("columns-2")}</span>
            <strong>${t("workbench.insertCompareAction")}</strong>
          </button>
        </div>
      </section>

      <section class="ai3d-panel ai3d-compare-panel">
        <div class="ai3d-panel-heading">
          <span>${t("workbench.connectionsTitle")}</span>
        </div>
        <div class="ai3d-compare-row">
          <div>
            <span class="ai3d-mini-model">${getModelExt(path) ?? "3D"}</span>
            <span>
              <strong>${getModelLabel(path)}</strong>
              <em>${path ? t("workbench.currentModelLabel") : t("workbench.noModelLoaded")}</em>
            </span>
          </div>
          <b>VS</b>
          <div>
            <span>
              <strong>${reportNotePath ? (getPortableStem(reportNotePath) ?? reportNotePath) : t("workbench.openNoteAction")}</strong>
              <em>${reportNotePath ?? t("workbench.noReportYet")}</em>
            </span>
            <span class="ai3d-mini-model is-note">MD</span>
          </div>
        </div>
        <button class="ai3d-comparison-button" type="button" data-action=${reportNotePath ? "open-note" : "note"} disabled=${!path}>
          ${reportNotePath ? t("workbench.openNoteAction") : t("workbench.generateNoteAction")}
        </button>
      </section>
    `);

    wireWorkbenchActions(bottomPanelsEl);
  }

  function renderStageChrome() {
    const state = ps.store.getState();
    renderStudioHeader(state);
    const path = state.currentModelPath;
    const profile = path ? state.modelAssetProfiles[path] : undefined;
    const ext = getModelExt(path);
    const summary = state.modelPreview;
    const reportNotePath = path ? state.modelAssetProfiles[path]?.reportNotePath : undefined;
    const noteReady = Boolean(reportNotePath);

    replaceWithHtml(stageChromeEl, html`
      <div class="ai3d-stage-head">
        <div class="ai3d-stage-copy">
          <div class="ai3d-stage-kicker">${t("workbench.modelTitle")}</div>
          <div class="ai3d-stage-title-row">
            <div class="ai3d-stage-title">${getModelLabel(path)}</div>
            <div class="ai3d-stage-badges">
              ${ext ? html`<span class="ai3d-stage-pill is-accent">${ext}</span>` : ""}
              ${profile?.analysisVersion ? html`<span class="ai3d-stage-pill">${profile.analysisVersion}</span>` : ""}
            </div>
          </div>
          <div class="ai3d-stage-path">${path ?? t("workbench.emptyText")}</div>
          <div class="ai3d-stage-ledger">
            ${path ? html`
              <span class=${`ai3d-stage-ledger-item ${noteReady ? "is-ready" : ""}`.trim()}>
                ${renderIcon("file-text")}
                <span>${t(noteReady ? "workbench.noteReady" : "workbench.notePending")}</span>
              </span>
            ` : ""}
            ${profile?.analysisVersion ? html`
              <span class="ai3d-stage-ledger-item">
                ${renderIcon("search")}
                <span>${t("workbench.analysisLabel")}: ${profile.analysisVersion}</span>
              </span>
            ` : ""}
          </div>
        </div>
        ${path && summary ? html`
          <div class="ai3d-stage-stat-grid">
            ${renderMetric(t("workbench.tagsTitle"), String(getProfileTags(profile).length), "is-compact")}
            ${renderMetric(t("workbench.annotationsTitle"), String(getProfileAnnotations(profile).length), "is-compact")}
            ${renderMetric(
              summary.splatCount ? t("workbench.splatsLabel") : t("workbench.trianglesLabel"),
              (summary.splatCount ?? summary.triangleCount).toLocaleString(),
              "is-compact",
            )}
            ${renderMetric(t("workbench.materialsLabel"), String(summary.materialCount), "is-compact")}
            ${renderMetric(t("workbench.verticesLabel"), summary.vertexCount.toLocaleString(), "is-compact")}
            ${renderMetric(t("workbench.boundingSizeLabel"), formatPreviewWorldPoint(summary.boundingSize), "is-compact")}
          </div>
        ` : ""}
        <div class="ai3d-view-card">
          <span>${t("workbench.viewModeTitle")}</span>
          <div class="ai3d-mode-switcher is-triple">
            <button class=${!focusSelectionMode ? "is-active" : ""} type="button" data-view-mode="mesh" title=${t("workbench.modeMesh")}>
              ${renderIconLabel("box", t("workbench.modeMeshShort"))}
            </button>
            <button class=${focusSelectionMode ? "is-active" : ""} type="button" data-view-mode="focus" title=${t("workbench.modeFocus")}>
              ${renderIconLabel("crosshair", t("workbench.modeFocusShort"))}
            </button>
            <button class=${annotationMode ? "is-active" : ""} type="button" data-action="toggle-annot" title=${annotationMode ? t("workbench.exitAnnotate") : t("workbench.annotate")}>
              ${renderIconLabel("pencil", t("workbench.annotate"))}
            </button>
          </div>
          <div class="ai3d-stage-note-line">${path ? t(noteReady ? "workbench.noteReady" : "workbench.notePending") : t("workbench.emptyText")}</div>
        </div>
      </div>
      ${path ? html`
        <div class="ai3d-stage-toolbar">
          ${preview ? html`<button type="button" data-action="reset">${renderIconLabel("rotate-ccw", t("workbench.resetViewAction"))}</button>` : ""}
          ${preview ? html`<button type="button" data-action="info">${renderIconLabel("file-text", t("workbench.insertInfoAction"))}</button>` : ""}
          ${preview ? html`<button type="button" data-action="gallery">${renderIconLabel("layout-grid", t("workbench.insertGalleryAction"))}</button>` : ""}
          ${preview ? html`<button type="button" data-action="compare">${renderIconLabel("columns-2", t("workbench.insertCompareAction"))}</button>` : ""}
          ${preview?.hasAnimations() ? html`<button type="button" data-action="anim">${renderIconLabel("play", t("workbench.playAction"))}</button>` : ""}
        </div>
        <div class="ai3d-export-toolbar">
          <button type="button" data-action="save">${renderIconLabel("save", t("workbench.saveProfileAction"))}</button>
          <button type="button" data-action="note">${renderIconLabel("file-text", t("workbench.generateNoteAction"))}</button>
          ${reportNotePath ? html`<button type="button" data-action="open-note">${renderIconLabel("book-open", t("workbench.openNoteAction"))}</button>` : ""}
        </div>
      ` : ""}
    `);
    wireWorkbenchActions(stageChromeEl);
  }

  function renderPanels() {
    const state = ps.store.getState();
    renderStageChrome();
    renderLeftRail(state);
    renderBottomPanels(state);
    panelsEl.replaceChildren();

    panelsEl.appendChild(state.selectedPart ? renderPartDetail(state.selectedPart) : renderModelDetail(state));
    panelsEl.appendChild(renderAnalysisNotes(state));
    panelsEl.appendChild(renderConnectionMap(state));
    wireWorkbenchActions(panelsEl);

    // ── Disassembly Controls ──
    if (preview) {
      const controlsEl = html`
        <div class="ai3d-section">
          <div class="ai3d-section-header">
            <div class="ai3d-section-title">${t("workbench.disassemblyTitle")}</div>
          </div>
          <div class="ai3d-section-body">
            <div class="ai3d-disassemble-controls">
              <div class="ai3d-slider-row">
                <span class="ai3d-slider-label">${t("workbench.explodeLabel")}</span>
                <input type="range" class="ai3d-slider" min="0" max="100" value="0" />
                <span class="ai3d-slider-value">0%</span>
              </div>
              <div class="ai3d-axis-buttons">
                <button class="ai3d-axis-btn is-active" data-axis="x">X</button>
                <button class="ai3d-axis-btn" data-axis="y">Y</button>
                <button class="ai3d-axis-btn" data-axis="z">Z</button>
              </div>
            </div>
          </div>
        </div>
      ` as HTMLElement;
      panelsEl.appendChild(controlsEl);

      const slider = controlsEl.querySelector<HTMLInputElement>(".ai3d-slider")!;
      const valueLabel = controlsEl.querySelector<HTMLSpanElement>(".ai3d-slider-value")!;
      const axisBtns = controlsEl.querySelectorAll<HTMLElement>(".ai3d-axis-btn");
      let currentAxis: PreviewAxis = "x";

      slider.addEventListener("input", () => {
        const val = parseInt(slider.value, 10);
        valueLabel.textContent = `${val}%`;
        preview?.setExplode(val / 100, currentAxis);
      });

      axisBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          axisBtns.forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          currentAxis = btn.dataset.axis as PreviewAxis;
          const val = parseInt(slider.value, 10);
          preview?.resetExplode();
          if (val > 0) preview?.setExplode(val / 100, currentAxis);
        });
      });
    }

    // ── Tags Section ──
    if (state.currentModelPath) {
      const profile = state.modelAssetProfiles[state.currentModelPath];
      const tags = getProfileTags(profile);
      const tagsEl = html`
        <div class="ai3d-section">
          <div class="ai3d-section-header">
            <div class="ai3d-section-title">${t("workbench.tagsTitle")}</div>
          </div>
          <div class="ai3d-section-body">
            <div class="ai3d-tag-section">
              <div class="ai3d-tag-list">
                ${tags.length > 0
                  ? tags.map((t: string) => html`<span class="ai3d-tag-chip">${t}</span>`)
                  : html`<span class="ai3d-tag-empty">${t("workbench.noTagsYet")}</span>`}
              </div>
              <div class="ai3d-tag-input-row">
                <input class="ai3d-input" placeholder=${t("workbench.addTagPlaceholder")} />
                <button class="ai3d-axis-btn">${t("workbench.addTagAction")}</button>
              </div>
            </div>
          </div>
        </div>
      ` as HTMLElement;
      panelsEl.appendChild(tagsEl);

      const input = tagsEl.querySelector<HTMLInputElement>(".ai3d-input")!;
      const addBtn = tagsEl.querySelector<HTMLButtonElement>(".ai3d-axis-btn")!;
      function addTag() {
        const val = input.value.trim();
        if (!val) return;
        const current = ps.store.getState().modelAssetProfiles;
        const path = ps.store.getState().currentModelPath!;
        const existing = current[path] ?? createDefaultProfile();
        const newTags = normalizeTagList([...existing.tags, val]);
        ps.store.setState({
          modelAssetProfiles: { ...current, [path]: { ...existing, tags: newTags } },
        });
        input.value = "";
        renderPanels();
      }
      addBtn.addEventListener("click", addTag);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") addTag(); });
    }

    // ── Annotations Section ──
    if (state.currentModelPath && preview) {
      const profile = state.modelAssetProfiles[state.currentModelPath];
      const annotations = getProfileAnnotations(profile);
      const annotEl = html`
        <div class="ai3d-section">
          <div class="ai3d-section-header">
            <div class="ai3d-section-title">${t("workbench.annotationsTitle")}</div>
          </div>
          <div class="ai3d-section-body">
            <div class="ai3d-annot-section">
              <div class="ai3d-annot-toggle-row">
                <button class=${`ai3d-axis-btn ${annotationMode ? "is-active" : ""}`} data-action="toggle-annot">
                  ${annotationMode ? t("workbench.exitAnnotate") : t("workbench.annotate")}
                </button>
                <span class="ai3d-annot-hint">${annotationMode ? t(mobile ? "workbench.annotateHintActiveMobile" : "workbench.annotateHintActive") : formatT("workbench.pinCount", { count: String(annotations.length) })}</span>
              </div>
              ${annotations.length > 0 ? html`
                <div class="ai3d-annot-list">
                  ${annotations.map((a: import("../../domain/models").AnnotationPin) => html`
                    <div class="ai3d-annot-item" data-pin-id=${a.id}>
                      <span class="ai3d-annot-dot" style=${{ background: a.color }}></span>
                      <span class="ai3d-annot-label" data-action="focus-pin" data-pin-id=${a.id}>${a.label}</span>
                      <span class="ai3d-annot-actions">
                        <button class="ai3d-annot-action-btn" data-action="edit-pin" data-pin-id=${a.id} title=${t("workbench.editAction")}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="ai3d-annot-action-btn is-delete" data-action="delete-pin" data-pin-id=${a.id} title=${t("workbench.deleteAction")}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                        </button>
                      </span>
                    </div>
                  `)}
                </div>
              ` : annotationMode ? html`
                <div class="ai3d-empty-hint">
                  <div class="ai3d-empty-hint-icon">${renderIcon("pencil")}</div>
                  <span class="ai3d-tag-empty">${t("workbench.annotateHintActive")}</span>
                </div>
              ` : ""}
            </div>
          </div>
        </div>
      ` as HTMLElement;
      panelsEl.appendChild(annotEl);
    }

  }

  // Initial panel render
  renderPanels();

  // ── Model loading subscription ──
  async function syncSelectedModel(): Promise<void> {
    if (loading) return;

    loading = true;
    try {
      while (queuedModelPath !== undefined) {
        const path = queuedModelPath;
        queuedModelPath = undefined;
        const state = ps.store.getState();

        if (!path) {
          showEmptyPreview();
          if (state.modelPreview !== null) {
            ps.store.setState({ modelPreview: null, selectedPart: null });
          }
          continue;
        }

        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          showEmptyPreview(formatT("workbench.fileNotFound", { path }));
          if (state.modelPreview !== null) {
            ps.store.setState({ modelPreview: null, selectedPart: null });
          }
          continue;
        }

        destroyActivePreview();
        emptyState.classList.add("is-hidden");
        const canvas = previewHost.createEl("canvas", { cls: "ai3d-canvas-full" });
        // Ensure canvas renders before modeOverlay (createEl auto-appends as last child)
        previewHost.insertBefore(canvas, modeOverlay);

        try {
          log.info("begin model load", { path });
          const absolutePath = resolveVaultAbsolutePath(app, path) ?? undefined;
          const conversionManager = createConversionManager(state.settings);
          const prepared = await prepareModelInput({
            path,
            absolutePath,
            preferConversionExts: listPreferredConversionExts(state.settings),
            conversionManager,
            convertedAssetCache,
          });
          const source = toPreviewSource(prepared);
          for (const warning of source.warnings) {
            log.warn("model prepare warning", { path, warning });
          }

          const data = await readBinaryPath(app, source.path);
          const readFile = async (p: string) => readBinaryPath(app, p);

          const previewOptions = {
            ext: source.ext,
            annotationMode: "edit",
            allowEditModeOnThree: true,
            requireWorkbenchFeatures: false,
            rendererRollout: state.settings.previewRendererRollout,
          } as const;
          const { preview: nextPreview } = await createLoggedModelPreview<WorkbenchPreview>(
            log,
            { surface: "workbench", path },
            canvas,
            previewOptions,
          );
          preview = nextPreview;
          mobilePreviewBar?.classList.remove("is-hidden");
          const summary = await preview.loadModel(data, source.ext, readFile, source.path);
          const latestPath = ps.store.getState().currentModelPath;
          if (latestPath !== path) {
            log.info("discard stale model load", { path, nextPath: latestPath });
            preview.destroy();
            preview = null;
            canvas.remove();
            continue;
          }

          const s = ps.store.getState().settings;
          preview.setRenderQuality(s.renderQuality, s.renderScale);

          const provider = preview.getAnnotationProvider();
          if (provider.canvas) {
            const profile = ps.store.getState().modelAssetProfiles[path];
            const noteReader = createNoteReader(app);
            const headingSearch = createHeadingSearch(app);

            annotationMgr = new AnnotationManager(
              provider,
              previewHost,
              "edit",
              getProfileAnnotations(profile),
              (pins) => {
                const current = ps.store.getState().modelAssetProfiles;
                const p = ps.store.getState().currentModelPath;
                if (!p) return;
                const existing = normalizeModelAssetProfile(current[p]);
                ps.store.setState({
                  modelAssetProfiles: { ...current, [p]: { ...existing, annotations: pins, updatedAt: new Date().toISOString() } },
                });
              },
              noteReader,
              headingSearch,
              { app, previewMode: s.annotationPreviewMode },
            );
            preview.onPick((result) => {
              const selectedPart = result.mesh ? preview?.getSelectedPartInfo() ?? null : null;
              ps.store.setState({ selectedPart });
              if (!annotationMode || !annotationMgr) return;
              const screenX = result.screenX;
              const screenY = result.screenY;
              const worldPos = preview?.getPickWorldPoint(result) ?? null;
              if (!worldPos) return;

              annotationMgr.showEditor(screenX, screenY, worldPos);
            });
          }

          ps.store.setState({ modelPreview: summary });
          ps.store.setState({ selectedPart: null });
          log.info("model load completed", {
            path,
            effectivePath: source.path,
            effectiveExt: source.ext,
            strategy: source.strategy,
            meshCount: summary.meshCount,
            triangleCount: summary.triangleCount,
          });
        } catch (err) {
          const failure = describeModelLoadFailure(err);
          if (isMissingConverterError(err)) {
            log.warn("model load blocked by converter settings", { path, error: err.message });
          } else {
            log.error("model load failed", { path, error: err instanceof Error ? err.message : String(err) });
          }
          showEmptyPreview(failure);
        }
      }
    } finally {
      loading = false;
    }
  }

  const unsubModel = ps.store.subscribe(() => {
    const state = ps.store.getState();
    const pathChanged = state.currentModelPath !== lastObservedModelPath;
    const previewWasReset = state.modelPreview === null && lastObservedPreview !== null;
    lastObservedModelPath = state.currentModelPath;
    lastObservedPreview = state.modelPreview;
    if (!pathChanged && !previewWasReset) return;
    queuedModelPath = state.currentModelPath;
    void syncSelectedModel();
  });
  void syncSelectedModel();

  // ── Panel re-render subscription ──
  const unsubPanels = ps.store.subscribe(() => renderPanels());

  return () => {
    unsubModel();
    unsubPanels();
    activeDocument.removeEventListener("keydown", handleEsc);
    container.removeEventListener("click", handleDelegatedClick);
    destroyActivePreview();
    container.replaceChildren();
    container.classList.remove("ai3d-workbench");
  };
}

function createDefaultProfile(): ModelAssetProfile {
  return { tags: [], notes: "", annotations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function normalizeModelAssetProfile(profile: Partial<ModelAssetProfile> | null | undefined): ModelAssetProfile {
  const now = new Date().toISOString();
  return {
    tags: getProfileTags(profile),
    notes: typeof profile?.notes === "string" ? profile.notes : "",
    annotations: getProfileAnnotations(profile),
    analysisVersion: typeof profile?.analysisVersion === "string" ? profile.analysisVersion : undefined,
    reportNotePath: typeof profile?.reportNotePath === "string" ? profile.reportNotePath : undefined,
    createdAt: typeof profile?.createdAt === "string" ? profile.createdAt : now,
    updatedAt: typeof profile?.updatedAt === "string" ? profile.updatedAt : now,
  };
}

/** Guard against concurrent or duplicate note generation calls. */
let noteGenerationLock: Promise<void> | null = null;

export async function generateKnowledgeNote(app: App, ps: PluginStore) {
  // Serialize concurrent calls to prevent duplicate note creation
  if (noteGenerationLock !== null) await noteGenerationLock;
  let resolveLock!: () => void;
  noteGenerationLock = new Promise<void>(r => { resolveLock = r; });

  try {
    const state = ps.store.getState();
    const path = state.currentModelPath;
    if (!path) return;

    const profile = state.modelAssetProfiles[path];
    const preview = state.modelPreview;
    const baseName = getPortableStem(path) || "model";
    const reportFolder = state.settings.reportFolder;
    const notePath = `${reportFolder}/${baseName} Report.md`;
    const content = buildKnowledgeNoteContent({
      baseName,
      notePath,
      sourcePath: path,
      profile,
      preview,
    });

    // If file exists, update it; otherwise create (with fallback if concurrent creation won)
    const existingFile = app.vault.getAbstractFileByPath(notePath);
    let outputFile: TFile | null = existingFile instanceof TFile ? existingFile : null;
    if (existingFile instanceof TFile) {
      await app.vault.modify(existingFile, content);
    } else {
      // Ensure folder exists
      const folder = app.vault.getAbstractFileByPath(reportFolder);
      if (!folder) {
        await app.vault.createFolder(reportFolder).catch(() => {});
      }

      try {
        outputFile = await app.vault.create(notePath, content);
      } catch {
        // File was created concurrently; fall back to modify.
        const file = app.vault.getAbstractFileByPath(notePath);
        if (file instanceof TFile) {
          outputFile = file;
          await app.vault.modify(file, content);
        }
      }
    }

    if (outputFile) {
      const currentProfiles = ps.store.getState().modelAssetProfiles;
        const existingProfile = normalizeModelAssetProfile(currentProfiles[path]);
      ps.store.setState({
        modelAssetProfiles: {
          ...currentProfiles,
          [path]: {
            ...existingProfile,
            analysisVersion: LOCAL_ANALYSIS_VERSION,
            reportNotePath: outputFile.path,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      await app.workspace.getLeaf(true).openFile(outputFile, { active: true });
      new Notice(`Knowledge note updated: ${outputFile.path}`);
    }
  } finally {
    resolveLock();
    if (noteGenerationLock !== null) noteGenerationLock = null;
  }
}
