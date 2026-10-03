import { t } from "../i18n";

const DEFAULT_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const MIN_VIEWPORT_WIDTH = 280;

export function clampDirectSidebarWidth(width: number, workspaceWidth: number): number {
  const maxWidth = Math.max(DEFAULT_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, workspaceWidth - MIN_VIEWPORT_WIDTH - 4));
  return Math.max(DEFAULT_SIDEBAR_WIDTH, Math.min(maxWidth, Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH));
}

/** Pointer capture keeps resize listeners local to the divider and removable on model switches. */
export function attachDirectSidebarResize(handle: HTMLElement, track: HTMLElement, workspace: HTMLElement): () => void {
  let width = DEFAULT_SIDEBAR_WIDTH;
  let drag: { pointerId: number; x: number; width: number } | null = null;
  const hostWindow = handle.ownerDocument.defaultView;
  const applyWidth = (next: number): void => {
    width = clampDirectSidebarWidth(next, workspace.clientWidth);
    track.style.gridTemplateColumns = `minmax(0, 1fr) 4px ${width}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    handle.setAttribute("aria-valuemax", String(clampDirectSidebarWidth(MAX_SIDEBAR_WIDTH, workspace.clientWidth)));
  };
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", t("directWorkbench.resizeKnowledge"));
  handle.setAttribute("aria-valuemin", String(DEFAULT_SIDEBAR_WIDTH));
  handle.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End");
  handle.tabIndex = 0;
  applyWidth(width);

  const endDrag = (): void => {
    const pointerId = drag?.pointerId;
    drag = null;
    workspace.classList.remove("is-resizing-sidebar");
    if (pointerId !== undefined && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  };
  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, x: event.clientX, width };
    handle.setPointerCapture(event.pointerId);
    workspace.classList.add("is-resizing-sidebar");
  };
  const onMove = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    applyWidth(drag.width - (event.clientX - drag.x));
  };
  const onKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === "ArrowLeft") applyWidth(width + step);
    else if (event.key === "ArrowRight") applyWidth(width - step);
    else if (event.key === "Home") applyWidth(DEFAULT_SIDEBAR_WIDTH);
    else if (event.key === "End") applyWidth(MAX_SIDEBAR_WIDTH);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onReset = (): void => { applyWidth(DEFAULT_SIDEBAR_WIDTH); };
  const observer = new ResizeObserver(() => applyWidth(width));
  observer.observe(workspace);
  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
  handle.addEventListener("keydown", onKey);
  handle.addEventListener("dblclick", onReset);
  hostWindow?.addEventListener("blur", endDrag);
  return () => {
    endDrag();
    observer.disconnect();
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", endDrag);
    handle.removeEventListener("pointercancel", endDrag);
    handle.removeEventListener("lostpointercapture", endDrag);
    handle.removeEventListener("keydown", onKey);
    handle.removeEventListener("dblclick", onReset);
    hostWindow?.removeEventListener("blur", endDrag);
  };
}
