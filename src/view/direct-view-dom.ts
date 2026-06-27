const DIRECT_VIEW_CLASS = "ai3d-direct-view";
const DIRECT_VIEW_LEAF_CLASS = "ai3d-direct-view-leaf";
const DIRECT_VIEW_LEAF_CONTENT_CLASS = "ai3d-direct-view-leaf-content";

export function markDirectViewDom(contentEl: HTMLElement): void {
  contentEl.classList.add(DIRECT_VIEW_CLASS);
  contentEl.closest(".workspace-leaf")?.classList.add(DIRECT_VIEW_LEAF_CLASS);
  const leafContent = contentEl.closest(".workspace-leaf-content") ?? contentEl.parentElement;
  leafContent?.classList.add(DIRECT_VIEW_LEAF_CONTENT_CLASS);
}

export function unmarkDirectViewDom(contentEl: HTMLElement): void {
  contentEl.classList.remove(DIRECT_VIEW_CLASS);
  contentEl.closest(".workspace-leaf")?.classList.remove(DIRECT_VIEW_LEAF_CLASS);
  const leafContent = contentEl.closest(".workspace-leaf-content") ?? contentEl.parentElement;
  leafContent?.classList.remove(DIRECT_VIEW_LEAF_CONTENT_CLASS);
}
