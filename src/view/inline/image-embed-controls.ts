import { Modal, Scope, type App } from "obsidian";
import { t } from "../../i18n";
import type { ModelPreview } from "../../render/preview/types";

/** Move the existing preview into a dialog; retain its camera, records and GPU resources. */
export function createImageEmbedControls(
  app: App,
  frame: HTMLElement,
  canvas: HTMLCanvasElement,
  getPreview: () => ModelPreview | null,
  exitMode: () => void,
  handleEscape: () => boolean,
  syncPreview: () => void,
): { sync(): void; destroy(): void } {
  frame.classList.add("ai3d-image-compact");
  const bar = frame.createDiv({ cls: "ai3d-image-actions", attr: { role: "group", "aria-label": t("helper.viewGroup") } });
  const reset = bar.createEl("button", {
    text: t("helper.resetViewLabel"),
    attr: { type: "button", "data-ai3d-action": "image-reset", "aria-label": t("helper.resetViewLabel") },
  });
  const expand = bar.createEl("button", {
    text: t("helper.expandPreview"),
    attr: { type: "button", "data-ai3d-action": "expand-preview", "aria-haspopup": "dialog", "aria-expanded": "false" },
  });
  let dialog: Modal | null = null;
  let destroyed = false;
  reset.addEventListener("click", () => {
    getPreview()?.resetView();
    syncPreview();
  });
  for (const type of ["pointerdown", "mousedown", "click"]) bar.addEventListener(type, event => event.stopPropagation());

  const open = (): void => {
    const parent = frame.parentElement;
    if (destroyed || dialog || !getPreview() || !parent) return;
    const placeholder = parent.createDiv({ cls: "ai3d-image-reservation" });
    placeholder.style.height = `${frame.getBoundingClientRect().height}px`;
    frame.before(placeholder);
    const modal = new Modal(app);
    // Obsidian handles modal Escape before DOM keydown; leave the tool first.
    modal.scope = new Scope(modal.scope);
    modal.scope.register([], "Escape", () => {
      if (!handleEscape()) modal.close();
      return false;
    });
    dialog = modal;
    modal.modalEl.classList.add("ai3d-image-viewer-modal");
    modal.setTitle(t("helper.expandedPreviewTitle"));
    modal.onOpen = () => {
      frame.classList.remove("ai3d-image-compact");
      frame.classList.add("ai3d-image-expanded");
      modal.contentEl.appendChild(frame);
      const footer = modal.contentEl.createDiv({ cls: "ai3d-image-viewer-footer" });
      const back = footer.createEl("button", {
        text: t("helper.returnToNote"),
        attr: { type: "button", "data-ai3d-action": "return-to-note" },
      });
      back.addEventListener("click", () => modal.close());
      expand.setAttribute("aria-expanded", "true");
      canvas.focus({ preventScroll: true });
    };
    modal.onClose = () => {
      exitMode();
      frame.classList.remove("ai3d-image-expanded");
      frame.classList.add("ai3d-image-compact");
      placeholder.replaceWith(frame);
      expand.setAttribute("aria-expanded", "false");
      dialog = null;
      if (!destroyed && expand.isConnected) expand.focus({ preventScroll: true });
    };
    modal.open();
  };
  expand.addEventListener("click", open);
  const handleShortcut = (event: KeyboardEvent): void => {
    if (event.target !== canvas || !frame.contains(canvas) || !frame.classList.contains("ai3d-image-compact") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") {
      open();
      event.preventDefault();
      event.stopPropagation();
    } else if (["w", "g", "b", "m", " "].includes(event.key.toLowerCase())) {
      // Advanced keyboard tools must have their inspector and exit action visible.
      open();
    }
  };
  canvas.addEventListener("keydown", handleShortcut, true);
  canvas.setAttribute("aria-keyshortcuts", `${canvas.getAttribute("aria-keyshortcuts") ?? ""} Enter`);
  const sync = (): void => {
    reset.disabled = !getPreview();
    expand.disabled = !getPreview();
  };
  sync();
  return {
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dialog?.close();
      canvas.removeEventListener("keydown", handleShortcut, true);
      bar.remove();
    },
  };
}
