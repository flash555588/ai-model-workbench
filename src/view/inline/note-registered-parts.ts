import { Modal, Notice, type App } from "obsidian";
import type { NotePartPresentation, ThreeDBlockConfig } from "../../domain/models";
import { formatT, t } from "../../i18n";
import type { ModelPreview } from "../../render/preview/types";
import type { RegisteredPartDisplay } from "../../render/preview/registered-parts";
import { RegisteredPartsModal } from "../registered-parts-modal";
import { createNotePartsMarkdown, resolveNotePartSelection, type NotePartsAccess } from "./note-parts-config";

export interface NotePartsControls {
  sync(): void;
  isInspecting(): boolean;
  destroy(): void;
}

/** Own note presentation separately from the Markdown/editor-owned widget root. */
export function createNoteRegisteredPartsControls(
  app: App, frame: HTMLElement, host: HTMLElement, getPreview: () => ModelPreview | null,
  modelPath: string, access: NotePartsAccess | undefined, exitMode: () => void,
  syncToolbar: () => void, config?: ThreeDBlockConfig,
): NotePartsControls | null {
  if (!access) return null;
  const group = frame.querySelector<HTMLElement>(".ai3d-helper-group-inspect");
  if (!group) return null;
  const toggle = group.createEl("button", { cls: "ai3d-inline-btn ai3d-labeled-btn ai3d-note-parts-toggle", text: t("noteParts.toggle"),
    attr: { type: "button", "data-ai3d-action": "note-parts-toggle", "aria-pressed": "false" } });
  const inspect = group.createEl("button", { cls: "ai3d-inline-btn ai3d-labeled-btn", text: t("noteParts.inspect"),
    attr: { type: "button", "data-ai3d-action": "note-parts-inspect", "aria-haspopup": "dialog" } });
  const compact = frame.querySelector<HTMLElement>(".ai3d-image-actions")?.createEl("button", {
    text: t("noteParts.compact"), attr: { type: "button", "data-ai3d-action": "note-parts-toggle", "aria-pressed": "false", "aria-label": t("noteParts.toggle") },
  });
  const bar = frame.createDiv({ cls: "ai3d-note-parts-bar is-hidden" });
  const status = bar.createDiv({ cls: "ai3d-note-parts-status", attr: { role: "status", "aria-live": "polite" } });
  const controls = bar.createDiv({ cls: "ai3d-note-parts-options" });
  const selectionLabel = controls.createEl("label", { cls: "ai3d-note-parts-selection" });
  selectionLabel.createSpan({ text: t("noteParts.selection") });
  const selection = selectionLabel.createEl("select", { attr: { "aria-label": t("noteParts.selection"), "data-ai3d-action": "note-parts-select" } });
  const separationLabel = controls.createEl("label", { cls: "ai3d-note-parts-separation" });
  separationLabel.createSpan({ text: t("registeredDisplay.spacing") });
  const separation = separationLabel.createEl("input", { attr: { type: "range", min: "0", max: "100", "aria-label": t("registeredDisplay.spacing"), "data-ai3d-action": "note-parts-spacing" } });
  const amount = separationLabel.createEl("output");
  const otherLabel = controls.createEl("label", { cls: "ai3d-note-parts-other" });
  const other = otherLabel.createEl("input", { attr: { type: "checkbox", "data-ai3d-action": "note-parts-unregistered" } });
  otherLabel.createSpan({ text: t("noteParts.unregistered") });
  const copy = controls.createEl("button", { text: t("noteParts.copy"), attr: { type: "button", "data-ai3d-action": "note-parts-copy", title: t("noteParts.copyHint") } });
  const register = controls.createEl("button", { text: t("noteParts.register"), attr: { type: "button", "data-ai3d-action": "note-parts-register" } });
  let presentation: NotePartPresentation = { display: "registered", separation: 100, showUnregistered: false, ...config?.parts };
  let wanted = !!config?.parts;
  let display: RegisteredPartDisplay | null = null;
  let dialog: Modal | null = null;
  let destroyed = false;
  let refreshing = false;
  let lastParts = access.getParts(modelPath);
  const canvas = host.querySelector("canvas");

  const reflect = (): void => {
    const ready = !!getPreview()?.createRegisteredPartDisplay;
    for (const button of [toggle, inspect, compact]) if (button) button.disabled = !ready;
    for (const button of [toggle, compact]) if (button) button.setAttribute("aria-pressed", String(wanted));
    frame.classList.toggle("ai3d-note-parts-active", !!display);
    bar.classList.toggle("is-hidden", !wanted);
    selection.disabled = !display; separation.disabled = !display; other.disabled = !display;
    register.classList.toggle("is-hidden", lastParts.length > 0);
    copy.disabled = !display;
    separation.value = String(presentation.separation ?? 100);
    amount.setText(`${separation.value}%`);
    other.checked = !!presentation.showUnregistered;
    status.classList.remove("is-warning");
    if (!display) { status.setText(t("noteParts.empty")); return; }
    const selected = resolveNotePartSelection(lastParts, presentation.part);
    const selectedRow = selected.partId ? display.rows.find(row => row.part.partId === selected.partId) : null;
    const unavailable = selected.status === "missing" || selected.status === "ambiguous" || !!(selectedRow && !selectedRow.meshKeys.length);
    status.classList.toggle("is-warning", unavailable);
    status.setText(unavailable
      ? formatT("noteParts.selectionMissing", { part: presentation.part ?? "" })
      : formatT("registeredDisplay.count", { matched: String(display.rows.filter(row => row.meshKeys.length).length), total: String(display.rows.length) }));
    selection.empty();
    selection.createEl("option", { text: t("noteParts.all"), attr: { value: "" } });
    for (const row of display.rows) {
      const option = selection.createEl("option", { text: row.part.name, attr: { value: row.part.partId } });
      option.disabled = !row.meshKeys.length;
    }
    if (presentation.part && !selected.partId) selection.createEl("option", { text: presentation.part, attr: { value: "__missing__", disabled: "true" } });
    selection.value = selected.partId ?? (presentation.part ? "__missing__" : "");
  };
  const apply = (): void => {
    if (!display) return;
    const selected = resolveNotePartSelection(lastParts, presentation.part);
    const canSelect = !presentation.part || (selected.partId && display.rows.some(row => row.part.partId === selected.partId && row.meshKeys.length));
    display.setAllVisible(!!canSelect);
    display.showUnregistered(!!canSelect && !!presentation.showUnregistered);
    display.isolate(selected.partId);
    display.setSpread((presentation.separation ?? 100) / 100);
    reflect();
  };
  const suspend = (): void => {
    display?.dispose(); display = null;
    frame.classList.remove("ai3d-note-parts-active");
  };
  const activate = (): void => {
    if (destroyed || dialog || !wanted || refreshing) return;
    const preview = getPreview();
    if (!preview?.createRegisteredPartDisplay) { reflect(); return; }
    refreshing = true;
    try {
      suspend();
      lastParts = access.getParts(modelPath);
      if (!lastParts.length) { reflect(); return; }
      exitMode();
      display = preview.createRegisteredPartDisplay(lastParts);
      apply();
    } catch (error) {
      suspend(); wanted = false; reflect();
      console.warn("[AI3D] In-note registered part display failed:", error);
      new Notice(t("registeredDisplay.failed"));
    } finally { refreshing = false; }
  };
  const leave = (): void => { wanted = false; suspend(); reflect(); syncToolbar(); };
  const openModel = (): void => {
    dialog?.close();
    void app.workspace.openLinkText(modelPath, "", true).catch(error => {
      console.warn("[AI3D] Could not open the model to register parts:", error);
      new Notice(t("registeredDisplay.failed"));
    });
  };
  register.addEventListener("click", openModel);
  const openEmpty = (): void => {
    const empty = new Modal(app);
    dialog = empty;
    empty.setTitle(t("registeredDisplay.title"));
    empty.onOpen = () => {
      empty.contentEl.createEl("p", { text: t("noteParts.empty") });
      const open = empty.contentEl.createEl("button", { text: t("noteParts.register"), attr: { type: "button" } });
      open.addEventListener("click", openModel);
    };
    empty.onClose = () => { dialog = null; };
    empty.open();
  };
  const openInspection = (): void => {
    const preview = getPreview();
    if (destroyed || dialog || !preview || !host.parentElement) return;
    lastParts = access.getParts(modelPath);
    if (!lastParts.length) { openEmpty(); return; }
    suspend(); exitMode();
    const modal = new RegisteredPartsModal(app, host, preview, lastParts, () => {
      dialog = null;
      if (!destroyed && frame.isConnected) { if (wanted) activate(); else reflect(); syncToolbar(); inspect.focus({ preventScroll: true }); }
    }, t("helper.returnToNote"));
    dialog = modal;
    try { modal.open(); } catch (error) { modal.close(); console.warn("[AI3D] Note part inspection failed:", error); new Notice(t("registeredDisplay.failed")); }
  };
  inspect.addEventListener("click", openInspection);
  for (const button of [toggle, compact]) button?.addEventListener("click", () => {
    if (wanted) leave(); else { wanted = true; activate(); if (!lastParts.length && frame.classList.contains("ai3d-image-compact")) openEmpty(); }
  });
  selection.addEventListener("change", () => { presentation = { ...presentation, part: selection.value || undefined }; apply(); });
  separation.addEventListener("input", () => { presentation = { ...presentation, separation: Number(separation.value) }; amount.setText(`${separation.value}%`); display?.setSpread(Number(separation.value) / 100); });
  other.addEventListener("change", () => { presentation = { ...presentation, showUnregistered: other.checked }; apply(); });
  copy.addEventListener("click", () => {
    const selected = resolveNotePartSelection(lastParts, presentation.part);
    const saved = { ...presentation, part: selected.partId ?? presentation.part };
    void navigator.clipboard.writeText(createNotePartsMarkdown(modelPath, saved, config)).then(() => {
      if (!destroyed) new Notice(t("noteParts.copied"));
    }).catch(() => new Notice(t("noteParts.copyFailed")));
  });
  // Other tools first restore the assembly, avoiding mixed geometry/tool state.
  const beforeClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button[data-ai3d-action]") : null;
    const action = target?.dataset.ai3dAction;
    if (display && action && !action.startsWith("note-parts-") && action !== "expand-preview") leave();
  };
  const beforeKey = (event: KeyboardEvent): void => {
    if (!display || dialog || event.target !== canvas || event.altKey || event.ctrlKey || event.metaKey) return;
    if (["r", "w", "g", "b", "m", " "].includes(event.key.toLowerCase())) leave();
  };
  frame.addEventListener("click", beforeClick, true);
  host.addEventListener("keydown", beforeKey, true);
  const resize = new ResizeObserver(() => { if (display && !dialog) display.setSpread((presentation.separation ?? 100) / 100); });
  resize.observe(host);
  const unsubscribe = access.subscribe(() => {
    if (destroyed || dialog) return;
    const parts = access.getParts(modelPath);
    if (parts === lastParts) return;
    lastParts = parts;
    if (wanted) activate(); else reflect();
  });
  const sync = (): void => { if (destroyed) return; if (wanted && !display && !dialog) activate(); else reflect(); };
  sync();
  return {
    sync, isInspecting: () => !!dialog,
    destroy() {
      if (destroyed) return;
      destroyed = true; unsubscribe(); resize.disconnect();
      dialog?.close(); dialog = null; suspend();
      frame.removeEventListener("click", beforeClick, true); host.removeEventListener("keydown", beforeKey, true);
      toggle.remove(); inspect.remove(); compact?.remove(); bar.remove();
    },
  };
}
