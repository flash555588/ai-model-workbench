import type { AnnotationPreview } from "../render/preview/types";
import { t } from "../i18n";
import {
  attachModelPreviewCanvasShortcuts,
  configureModelPreviewCanvas,
} from "./inline/preview-canvas-accessibility";

export interface DirectViewLayoutOptions {
  contentEl: HTMLElement;
  filePath: string;
  mobile: boolean;
  getPreview: () => AnnotationPreview | null;
}

export interface DirectViewLayout {
  workspace: HTMLElement;
  topTrack: HTMLElement;
  mainArea: HTMLElement;
  hHandle: HTMLElement;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  modeOverlay: HTMLElement;
  sidebarContent: HTMLElement;
  vHandle: HTMLElement;
  workbenchPanel: HTMLElement;
}

export function createDirectViewLayout(options: DirectViewLayoutOptions): DirectViewLayout {
  const { contentEl, filePath, mobile, getPreview } = options;
  const workspace = contentEl.createDiv({ cls: "ai3d-workspace" });
  const topTrack = workspace.createDiv({ cls: "ai3d-workspace-track-top" });
  const mainArea = topTrack.createDiv({ cls: "ai3d-workspace-main" });
  const hHandle = topTrack.createDiv({ cls: "ai3d-resize-handle ai3d-resize-handle-h" });
  const sidebar = topTrack.createDiv({ cls: "ai3d-workspace-sidebar" });

  const staging = createDiv();
  const host = staging.createDiv({ cls: "ai3d-preview-host" });
  const canvas = staging.createEl("canvas");
  canvas.className = "ai3d-canvas-full";
  configureModelPreviewCanvas(canvas, "direct-view", filePath);
  attachModelPreviewCanvasShortcuts(canvas, getPreview);
  host.appendChild(canvas);

  const modeOverlay = staging.createDiv();
  modeOverlay.className = "ai3d-annot-mode-overlay is-hidden";
  host.appendChild(modeOverlay);
  mainArea.appendChild(host);

  const sidebarContent = sidebar.createDiv({ cls: "ai3d-sidebar-content" });
  const vHandle = workspace.createDiv({ cls: "ai3d-resize-handle ai3d-resize-handle-v" });
  const workbenchPanel = workspace.createDiv({ cls: "ai3d-direct-workbench-panel is-hidden" });

  if (mobile) {
    mainArea.createDiv({
      cls: "ai3d-mobile-mode-hint ai3d-mobile-mode-hint--inline",
      text: t("directView.mobileHint"),
    });
  }

  return {
    workspace,
    topTrack,
    mainArea,
    hHandle,
    host,
    canvas,
    modeOverlay,
    sidebarContent,
    vHandle,
    workbenchPanel,
  };
}
