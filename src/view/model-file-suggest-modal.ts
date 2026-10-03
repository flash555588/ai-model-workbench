import { FuzzySuggestModal, renderMatches, type App, type FuzzyMatch, type TFile } from "obsidian";
import { isSupportedModelExtension } from "../io/formats/registry";
import { t } from "../i18n";

export class ModelFileSuggestModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(t("modal.selectModel"));
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => {
      const ext = f.extension.toLowerCase();
      return isSupportedModelExtension(ext);
    });
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  renderSuggestion(value: FuzzyMatch<TFile>, el: HTMLElement): void {
    el.classList.add("ai3d-model-suggestion");
    const content = el.createDiv({ cls: "ai3d-model-suggestion-content" });
    content.createDiv({ cls: "ai3d-model-suggestion-name", text: value.item.name });
    const path = content.createDiv({ cls: "ai3d-model-suggestion-path" });
    renderMatches(path, value.item.path, value.match?.matches ?? null);
    el.createSpan({ cls: "ai3d-model-suggestion-format", text: value.item.extension.toUpperCase() });
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
