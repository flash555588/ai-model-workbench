import { Notice, type App, type Editor, type MarkdownFileInfo, type TFile } from "obsidian";
import { t } from "../i18n";
import { ModelFileSuggestModal } from "./model-file-suggest-modal";
import { createNoteModelInsertion, getNoteInsertDimensions, resolveNoteInsertContext, type NoteInsertMode, type NoteInsertSize } from "./inline/note-insert-rules";

/** Capture the requesting editor so a later model choice cannot write into another note. */
export function openNoteModelInsertion(app: App, editor: Editor, view: MarkdownFileInfo): void {
  const notePath = view.file?.path;
  if (!notePath) return;
  const source = editor.getValue();
  const from = editor.getCursor("from"); const to = editor.getCursor("to");
  const context = resolveNoteInsertContext(source, editor.posToOffset(from), editor.posToOffset(to));
  if (!context.allowed) { new Notice(t("noteInsert.invalidLocation")); return; }
  let mode: NoteInsertMode = "model";
  let size: NoteInsertSize = "auto";
  const modal = new ModelFileSuggestModal(app, (file: TFile) => {
    if (view.file?.path !== notePath || view.editor !== editor || app.workspace.getActiveFile()?.path !== notePath || editor.getValue() !== source
      || JSON.stringify(editor.getCursor("from")) !== JSON.stringify(from) || JSON.stringify(editor.getCursor("to")) !== JSON.stringify(to)) {
      new Notice(t("noteInsert.noteChanged")); return;
    }
    if (app.vault.getAbstractFileByPath(file.path) !== file) { new Notice(t("noteInsert.modelMissing")); return; }
    try {
      editor.replaceSelection(createNoteModelInsertion(file.path, context, mode, size));
      editor.focus();
    } catch (error) {
      new Notice(t(error instanceof Error && error.message === "unsupported-embed-path" ? "noteInsert.pathUnsupported" : "noteInsert.invalidLocation"));
    }
  });
  modal.modalEl.classList.add("ai3d-note-insert-modal");
  const rules = modal.modalEl.createDiv({ cls: "ai3d-note-insert-rules" });
  modal.inputEl.parentElement?.after(rules);
  const heading = rules.createDiv({ cls: "ai3d-note-insert-heading" });
  heading.createEl("h3", { text: t("noteInsert.title") });
  const location = heading.createDiv({ cls: "ai3d-note-insert-location" });
  location.createSpan({ text: t(`noteInsert.${context.placement}Location`) });
  const dimensions = location.createEl("output", { attr: { "aria-label": t("noteInsert.size") } });
  const options = rules.createDiv({ cls: "ai3d-note-insert-options" });
  const modeLabel = options.createEl("label");
  modeLabel.createSpan({ text: t("noteInsert.mode") });
  const modes = modeLabel.createEl("select", { attr: { "data-ai3d-action": "insert-model-mode", "aria-label": t("noteInsert.mode") } });
  modes.createEl("option", { text: t("noteInsert.model"), attr: { value: "model" } });
  const parts = modes.createEl("option", { text: t("noteInsert.parts"), attr: { value: "parts" } });
  parts.disabled = !context.allowParts;
  const sizeLabel = options.createEl("label");
  sizeLabel.createSpan({ text: t("noteInsert.size") });
  const sizes = sizeLabel.createEl("select", { attr: { "data-ai3d-action": "insert-model-size", "aria-label": t("noteInsert.size") } });
  for (const preset of ["auto", "small", "medium", "large"] as const) sizes.createEl("option", { text: t(`noteInsert.${preset}`), attr: { value: preset } });
  const hint = rules.createEl("p", { cls: "ai3d-note-insert-hint", attr: { role: "status", "aria-live": "polite" } });
  const guidance = rules.createEl("p", { cls: "ai3d-note-insert-guidance" });
  const hasModels = modal.getItems().length > 0;
  modes.disabled = !hasModels; sizes.disabled = !hasModels;
  const sync = (): void => {
    const { width, height } = getNoteInsertDimensions(context, size);
    dimensions.setText(`${width} × ${height}`);
    hint.setText(hasModels ? t(`noteInsert.${context.placement}Hint`) : t("noteInsert.noModels"));
    guidance.setText(mode === "parts" ? t("noteInsert.partsHint") : !context.allowParts ? t("noteInsert.inlinePartsHint") : "");
    guidance.classList.toggle("is-hidden", !hasModels || !guidance.textContent);
  };
  modes.addEventListener("change", () => { mode = modes.value === "parts" ? "parts" : "model"; sync(); });
  sizes.addEventListener("change", () => { size = sizes.value as NoteInsertSize; sync(); });
  sync();
  modal.setInstructions([{ command: "↑ ↓", purpose: t("noteInsert.choose") }, { command: "Enter", purpose: t("noteInsert.insert") }, { command: "Esc", purpose: t("noteInsert.cancel") }]);
  modal.open();
}
