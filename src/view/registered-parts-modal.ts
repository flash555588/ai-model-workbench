import { Modal, Scope, type App } from "obsidian";
import type { PartRecord } from "../domain/models";
import { formatT, t } from "../i18n";
import type { ModelPreview } from "../render/preview/types";
import type { RegisteredPartDisplay } from "../render/preview/registered-parts";

/** Reuse the single loaded model; closing restores its captured geometry and camera. */
export class RegisteredPartsModal extends Modal {
  private display: RegisteredPartDisplay | null = null;
  private placeholder: HTMLElement | null = null;
  private closed = false;
  private isolated: string | null = null;
  private releaseKeys: (() => void) | null = null;
  private resize: ResizeObserver | null = null;

  constructor(app: App, private host: HTMLElement, private preview: ModelPreview,
    private parts: readonly PartRecord[], private returned: () => void, private backLabel?: string) {
    super(app);
    this.modalEl.classList.add("ai3d-registered-parts-modal");
    this.setTitle(t("registeredDisplay.title"));
    this.scope = new Scope(this.scope);
    this.scope.register([], "Escape", () => { this.close(); return false; });
  }

  onOpen(): void {
    if (!this.host.parentElement) { this.close(); return; }
    this.placeholder = this.host.ownerDocument.createElement("div");
    this.placeholder.style.height = `${this.host.getBoundingClientRect().height}px`;
    this.host.before(this.placeholder);
    this.contentEl.createEl("p", { cls: "ai3d-registered-parts-hint", text: t("registeredDisplay.hint") });
    const toolbar = this.contentEl.createDiv({ cls: "ai3d-registered-parts-toolbar" });
    const reset = toolbar.createEl("button", { text: t("registeredDisplay.reset"), attr: { type: "button", "data-ai3d-action": "parts-reset" } });
    const all = toolbar.createEl("button", { text: t("registeredDisplay.all"), attr: { type: "button", "data-ai3d-action": "parts-all" } });
    const spacing = toolbar.createEl("label", { cls: "ai3d-registered-parts-spacing" });
    spacing.createSpan({ text: t("registeredDisplay.spacing") });
    const slider = spacing.createEl("input", { attr: { type: "range", min: "0", max: "100", value: "100", "aria-label": t("registeredDisplay.spacing"), "data-ai3d-action": "parts-spacing" } });
    const amount = spacing.createEl("output", { text: "100%" });
    const layout = this.contentEl.createDiv({ cls: "ai3d-registered-parts-layout" });
    const stage = layout.createDiv({ cls: "ai3d-registered-parts-stage" });
    stage.appendChild(this.host);
    const sidebar = layout.createDiv({ cls: "ai3d-registered-parts-sidebar" });
    const search = sidebar.createEl("input", { cls: "ai3d-registered-parts-search", attr: { type: "search", placeholder: t("registeredDisplay.search"), "aria-label": t("registeredDisplay.search") } });
    const stats = sidebar.createDiv({ cls: "ai3d-registered-parts-stats", attr: { role: "status" } });
    this.display = this.preview.createRegisteredPartDisplay?.(this.parts) ?? null;
    if (!this.display) { this.close(); return; }
    const display = this.display;
    stats.setText(formatT("registeredDisplay.count", {
      matched: String(display.rows.filter(row => row.meshKeys.length).length), total: String(display.rows.length),
    }));
    const otherLabel = sidebar.createEl("label", { cls: "ai3d-registered-parts-other" });
    const other = otherLabel.createEl("input", { attr: { type: "checkbox", "data-ai3d-action": "parts-unregistered" } });
    otherLabel.createSpan({ text: formatT("registeredDisplay.unregistered", { count: String(display.unregisteredMeshCount) }) });
    other.disabled = !display.unregisteredMeshCount;
    other.checked = !display.rows.some(row => row.meshKeys.length);
    if (other.checked) display.showUnregistered(true);
    other.addEventListener("change", () => display.showUnregistered(other.checked));
    const list = sidebar.createDiv({ cls: "ai3d-registered-parts-list" });
    const controls = display.rows.map(row => {
      const card = list.createDiv({ cls: "ai3d-registered-part", attr: { "data-part-id": row.part.partId, "data-match-status": row.status } });
      card.createEl("h4", { text: row.part.name });
      card.createDiv({ cls: "ai3d-registered-part-status", text: t(`registeredDisplay.${row.status}`) });
      const actions = card.createDiv({ cls: "ai3d-registered-part-actions" });
      const visibleLabel = actions.createEl("label");
      const visible = visibleLabel.createEl("input", { attr: { type: "checkbox", "aria-label": `${t("registeredDisplay.visible")} ${row.part.name}`, "data-ai3d-action": "part-visible" } });
      visible.checked = !!row.meshKeys.length;
      visible.disabled = !row.meshKeys.length;
      visibleLabel.createSpan({ text: t("registeredDisplay.visible") });
      const isolate = actions.createEl("button", { text: t("registeredDisplay.isolate"), attr: { type: "button", "aria-pressed": "false", "data-ai3d-action": "part-isolate" } });
      isolate.disabled = !row.meshKeys.length;
      visible.addEventListener("change", () => { display.setVisible(row.part.partId, visible.checked); });
      isolate.addEventListener("click", () => {
        this.isolated = this.isolated === row.part.partId ? null : row.part.partId;
        if (this.isolated) visible.checked = true;
        display.isolate(this.isolated);
        syncSelection();
      });
      if (row.part.notePath) {
        const notePath = row.part.notePath;
        const open = actions.createEl("button", { text: t("registeredDisplay.note"), attr: { type: "button" } });
        open.addEventListener("click", () => {
          this.close();
          void this.app.workspace.openLinkText(notePath, "", true);
        });
      }
      return { card, visible, isolate, partId: row.part.partId, name: row.part.name };
    });
    const syncSelection = (): void => {
      for (const row of controls) {
        const selected = this.isolated === row.partId;
        row.card.classList.toggle("is-selected", selected);
        row.isolate.setAttribute("aria-pressed", String(selected));
        row.isolate.setText(t(selected ? "registeredDisplay.cancelIsolate" : "registeredDisplay.isolate"));
      }
      all.disabled = !this.isolated;
    };
    const empty = list.createDiv({ cls: "ai3d-registered-parts-empty is-hidden", text: t("registeredDisplay.noResults") });
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase();
      let count = 0;
      for (const row of controls) { const show = row.name.toLocaleLowerCase().includes(query); row.card.classList.toggle("is-hidden", !show); if (show) count++; }
      empty.classList.toggle("is-hidden", count > 0);
    });
    const restore = (): void => {
      display.reset(); slider.value = "0"; amount.setText("0%"); other.checked = true;
      this.isolated = null;
      for (const row of controls) row.visible.checked = !row.visible.disabled;
      syncSelection();
    };
    reset.addEventListener("click", restore);
    all.addEventListener("click", () => { this.isolated = null; display.isolate(null); syncSelection(); });
    slider.addEventListener("input", () => { amount.setText(`${slider.value}%`); display.setSpread(Number(slider.value) / 100); });
    const footer = this.contentEl.createDiv({ cls: "ai3d-registered-parts-footer" });
    const back = footer.createEl("button", { text: this.backLabel ?? t("registeredDisplay.back"), attr: { type: "button", "data-ai3d-action": "parts-back" } });
    back.addEventListener("click", () => this.close());
    const canvas = this.preview.getCanvas();
    const shortcuts = canvas?.getAttribute("aria-keyshortcuts");
    const keydown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (["r", "w", "g", "b", "m", " "].includes(event.key.toLowerCase())) {
        event.stopImmediatePropagation(); event.preventDefault();
        if (event.key.toLowerCase() === "r") restore();
      }
    };
    canvas?.addEventListener("keydown", keydown, true);
    canvas?.setAttribute("aria-keyshortcuts", "R Escape");
    this.releaseKeys = () => { canvas?.removeEventListener("keydown", keydown, true); if (shortcuts !== null && shortcuts !== undefined) canvas?.setAttribute("aria-keyshortcuts", shortcuts); };
    display.setSpread(1);
    this.resize = new ResizeObserver(() => display.setSpread(Number(slider.value) / 100));
    this.resize.observe(stage);
    syncSelection();
    search.focus();
  }

  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseKeys?.();
    this.resize?.disconnect();
    this.resize = null;
    this.placeholder?.replaceWith(this.host);
    this.placeholder = null;
    this.display?.dispose();
    this.display = null;
    this.returned();
  }
}
