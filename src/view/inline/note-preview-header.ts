import { getPortableBasename } from "../../utils/resolve-path";

/** Keep model identity outside the canvas so inspection never covers the title. */
export function createNotePreviewHeader(parent: HTMLElement, modelPath: string): void {
  const header = parent.createDiv({ cls: "ai3d-note-preview-header" });
  header.createSpan({ cls: "ai3d-note-preview-name", text: getPortableBasename(modelPath) || modelPath });
  header.createSpan({ cls: "ai3d-inline-caption-badge", text: modelPath.split(".").pop()?.toUpperCase() ?? "" });
}
