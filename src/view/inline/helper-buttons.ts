import type { App } from "obsidian";
import type { PluginSettings } from "../../domain/models";
import { formatT, t } from "../../i18n";
import type { TranslationKey } from "../../i18n";
import {
  supportsAnimationPreview,
  supportsBoundingBoxPreview,
  supportsDisassemblyPreview,
  supportsFocusSelectionPreview,
  supportsOrientationGizmoPreview,
  supportsRenderScalePreview,
  supportsWireframePreview,
} from "../../render/preview/types";
import type {
  AnimationPreview,
  BoundingBoxPreview,
  DisassemblyPreview,
  FocusSelectionPreview,
  ModelPreview,
  OrientationGizmoPreview,
  RenderScalePreview,
  WireframePreview,
} from "../../render/preview/types";
import { isMobile } from "../../utils/device";
import { getPortableStem } from "../../utils/resolve-path";

/** Create an SVG icon that follows its button color via currentColor. */
function createSvgIcon(inner: string): SVGSVGElement {
  const svg = createSvg("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`,
    "image/svg+xml",
  );
  for (const child of Array.from(doc.documentElement.childNodes)) {
    svg.appendChild(activeDocument.importNode(child, true));
  }
  return svg;
}

/** Convert a data URL to a Blob without using fetch(). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Any preview that supports snapshot capture. */
export type SnapshotProvider =
  & Pick<ModelPreview, "captureSnapshot" | "resetView">
  & Partial<Pick<
    ModelPreview,
    | "exportModelInfo"
    | "exportSelectedPartInfo"
  >>
  & Partial<AnimationPreview & BoundingBoxPreview & DisassemblyPreview & FocusSelectionPreview & OrientationGizmoPreview & RenderScalePreview & WireframePreview>;

/** Handle returned by createHelperButtons — callers hold a direct reference. */
export interface HelperToolbar {
  showAnimButton(): void;
  showAnnotateButton(): void;
  updateAnnotationBadge(count: number): void;
  setMobileInteractionMode(active: boolean): void;
  syncCapabilities(): void;
}

interface AnnotationToggleCopy {
  labelKey: TranslationKey;
  activeTooltipKey: TranslationKey;
  inactiveTooltipKey: TranslationKey;
}

function setMobileInteractionMode(previewHost: HTMLElement, active: boolean): void {
  previewHost.classList.toggle("is-mobile-interactive", active);
  previewHost.classList.toggle("is-mobile-scroll-mode", !active);
}

/**
 * Create helper buttons BELOW the preview host (as a sibling).
 * @param parentEl  Parent element already in the live DOM — Obsidian's createEl
 *                  reads CSS variables from the live DOM to apply theme styling.
 * @param previewHost  The preview host element; toolbar is inserted after it.
 */
export function createHelperButtons(
  parentEl: HTMLElement,
  previewHost: HTMLElement,
  app: App,
  getPreview: () => SnapshotProvider | null,
  getModelPath: () => string,
  onRemove: () => void,
  getSettings?: () => PluginSettings,
  onToggleAnnotate?: () => boolean,
  onMobileInteractionModeChange?: (active: boolean) => void,
  annotationCopy?: AnnotationToggleCopy,
): HelperToolbar {
  const mobile = isMobile();
  const resolvedAnnotationCopy: AnnotationToggleCopy = annotationCopy ?? {
    labelKey: "helper.toggleAnnotationLabel",
    activeTooltipKey: "helper.annotateOn",
    inactiveTooltipKey: "helper.annotateOff",
  };

  // Create on parentEl (in DOM) so Obsidian's createEl inherits CSS variables
  const toolbar = parentEl.createDiv({ cls: "ai3d-helper-toolbar ai3d-helper-toolbar-adaptive" });
  const viewGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-view" });
  const inspectGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-inspect" });
  const outputGroup = toolbar.createDiv({ cls: "ai3d-helper-group ai3d-helper-group-output" });
  const stopToolbarEvent = (event: Event): void => {
    event.stopPropagation();
  };
  toolbar.addEventListener("pointerdown", stopToolbarEvent);
  toolbar.addEventListener("mousedown", stopToolbarEvent);
  toolbar.addEventListener("click", stopToolbarEvent);
  if (mobile) {
    toolbar.classList.add("is-mobile");
    setMobileInteractionMode(previewHost, false);
  }

  const markSecondary = <T extends HTMLButtonElement>(button: T): T => {
    button.classList.add("is-secondary");
    return button;
  };
  const setTogglePressed = (button: HTMLButtonElement, active: boolean): void => {
    button.classList.toggle("ai3d-btn-active", active);
    button.setAttribute("aria-pressed", String(active));
  };
  const syncGroupVisibility = (): void => {
    for (const group of [viewGroup, inspectGroup, outputGroup]) {
      const visibleButtons = Array
        .from(group.querySelectorAll<HTMLElement>(".ai3d-inline-btn"))
        .filter((button) => !button.classList.contains("is-hidden"));
      const hasVisibleButton = visibleButtons.length > 0;
      const hasPrimaryButton = visibleButtons.some((button) => !button.classList.contains("is-secondary"));
      group.classList.toggle("is-hidden", !hasVisibleButton);
      group.classList.toggle("has-primary-visible", hasPrimaryButton);
    }
  };

  let mobileInteractive = false;
  let toolbarExpanded = false;

  const interactBtn = mobile
    ? viewGroup.createEl("button", {
      cls: "ai3d-inline-btn ai3d-mobile-mode-btn",
      attr: { "aria-label": t("helper.enableInteractionLabel"), "aria-pressed": "false" },
    })
    : null;
  interactBtn?.appendChild(createSvgIcon(`<path d="M12 2v8"/><path d="M8 6l4-4 4 4"/><path d="M6 14a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/>`));
  const interactLabel = interactBtn?.createSpan({ cls: "ai3d-mobile-mode-btn-label" }) ?? null;

  const renderToolbarButtons = (): void => {
    if (mobile && interactBtn) {
      setMobileInteractionMode(previewHost, mobileInteractive);
      setTogglePressed(interactBtn, mobileInteractive);
      interactLabel?.setText(mobileInteractive ? t("helper.scrollAction") : t("helper.interactAction"));
      interactBtn.setAttribute(
        "aria-label",
        mobileInteractive ? t("helper.disableInteractionLabel") : t("helper.enableInteractionLabel"),
      );
    }
    setTogglePressed(showMoreBtn, toolbarExpanded);
    toolbar.classList.toggle("show-secondary", toolbarExpanded);
    syncGroupVisibility();
  };

  const applyMobileInteractionMode = (active: boolean): void => {
    mobileInteractive = active;
    renderToolbarButtons();
  };

  interactBtn?.addEventListener("click", () => {
    const nextInteractive = !mobileInteractive;
    onMobileInteractionModeChange?.(nextInteractive);
    applyMobileInteractionMode(nextInteractive);
    showTooltip(interactBtn, nextInteractive ? t("helper.interactionOn") : t("helper.interactionOff"));
  });

  const toggleCapabilityButton = (button: HTMLElement, enabled: boolean): void => {
    button.classList.toggle("is-hidden", !enabled);
  };

  let lastSyncedPreview: unknown = null;
  const syncToggleStates = (): void => {
    const preview = getPreview();
    const focusPreview = preview && supportsFocusSelectionPreview(preview) ? preview : null;
    const disassemblyPreview = preview && supportsDisassemblyPreview(preview) ? preview : null;
    setTogglePressed(focusBtn, !!focusPreview?.isFocusSelectionEnabled());
    setTogglePressed(disassembleBtn, !!disassemblyPreview?.isDisassemblyEnabled());
    if (preview && supportsOrientationGizmoPreview(preview)) {
      setTogglePressed(gizmoBtn, !!preview.isOrientationGizmoEnabled?.());
    }
  };

  const syncCapabilities = (): void => {
    const preview = getPreview();
    const focusPreview = preview && supportsFocusSelectionPreview(preview) ? preview : null;
    const disassemblyPreview = preview && supportsDisassemblyPreview(preview) ? preview : null;
    const animationPreview = preview && supportsAnimationPreview(preview) ? preview : null;
    if (preview !== lastSyncedPreview) {
      lastSyncedPreview = preview;
      setTogglePressed(wireBtn, false);
      setTogglePressed(bboxBtn, false);
      setTogglePressed(animBtn, false);
      animBtn.replaceChildren(createSvgIcon(`<polygon points="5 3 19 12 5 21 5 3"/>`));
      toggleCapabilityButton(resetBtn, !!preview?.resetView);
      toggleCapabilityButton(infoBtn, !!preview?.exportModelInfo);
      toggleCapabilityButton(partInfoBtn, !!preview?.exportSelectedPartInfo);
      toggleCapabilityButton(wireBtn, !!preview && supportsWireframePreview(preview));
      toggleCapabilityButton(gizmoBtn, !!preview && supportsOrientationGizmoPreview(preview));
      toggleCapabilityButton(bboxBtn, !!preview && supportsBoundingBoxPreview(preview));
      toggleCapabilityButton(focusBtn, !!focusPreview);
      toggleCapabilityButton(disassembleBtn, !!disassemblyPreview);
      toggleCapabilityButton(resBtn, !!preview && supportsRenderScalePreview(preview));
      toggleCapabilityButton(animBtn, !!animationPreview?.hasAnimations());
    }
    toggleCapabilityButton(resetPartsBtn, !!disassemblyPreview?.isDisassemblyEnabled());
    syncToggleStates();
    syncGroupVisibility();
  };

  // Reset view button (refresh arrow)
  const resetBtn = viewGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.resetViewLabel") } });
  resetBtn.appendChild(createSvgIcon(`<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`));
  resetBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (preview?.resetView) {
      preview.resetView();
      syncCapabilities();
      showTooltip(resetBtn, t("helper.resetViewDone"));
    }
  });

  // Export model info button (info circle)
  const infoBtn = markSecondary(inspectGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copyModelInfoLabel") } }));
  infoBtn.appendChild(createSvgIcon(`<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`));
  infoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.exportModelInfo) return;
    try {
      const md = preview.exportModelInfo(getModelPath());
      if (!md) return;
      void navigator.clipboard.writeText(md).then(() => {
        showTooltip(infoBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(infoBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Export model info failed:", err);
      showTooltip(infoBtn, t("helper.failed"));
    }
  });

  // Export currently selected part info button (target/list icon)
  const partInfoBtn = markSecondary(inspectGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copySelectedPartInfoLabel") } }));
  partInfoBtn.appendChild(createSvgIcon(`<path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="4"/><path d="M17 19h5"/><path d="M17 16h5"/><path d="M17 22h5"/>`));
  partInfoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.exportSelectedPartInfo) return;
    try {
      const md = preview.exportSelectedPartInfo();
      if (!md) {
        showTooltip(partInfoBtn, t("helper.noSelectedPart"));
        return;
      }
      void navigator.clipboard.writeText(md).then(() => {
        showTooltip(partInfoBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(partInfoBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Export selected part info failed:", err);
      showTooltip(partInfoBtn, t("helper.failed"));
    }
  });

  // Wireframe toggle button (grid/square icon)
  const wireBtn = markSecondary(viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleWireframeLabel"), "aria-pressed": "false" },
  }));
  wireBtn.appendChild(createSvgIcon(`<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/>`));
  wireBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleWireframe) return;
    const on = preview.toggleWireframe();
    setTogglePressed(wireBtn, on);
    showTooltip(wireBtn, on ? t("helper.wireframeOn") : t("helper.wireframeOff"));
  });

  // Orientation gizmo toggle button (compass/axis icon)
  const gizmoBtn = markSecondary(viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleAxesLabel"), "aria-pressed": "false" },
  }));
  gizmoBtn.appendChild(createSvgIcon(`<path d="M12 2v20"/><path d="M2 12h20"/><path d="M12 2l4 4"/><path d="M12 2l-4 4"/><path d="M22 12l-4-4"/><path d="M22 12l-4 4"/>`));
  gizmoBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleOrientationGizmo) return;
    const on = preview.toggleOrientationGizmo();
    setTogglePressed(gizmoBtn, on);
    showTooltip(gizmoBtn, on ? t("helper.axesOn") : t("helper.axesOff"));
  });

  // Bounding box toggle button (cube outline icon)
  const bboxBtn = markSecondary(viewGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleBoundingBoxLabel"), "aria-pressed": "false" },
  }));
  bboxBtn.appendChild(createSvgIcon(`<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>`));
  bboxBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleBoundingBox) return;
    const on = preview.toggleBoundingBox();
    setTogglePressed(bboxBtn, on);
    showTooltip(bboxBtn, on ? t("helper.boundingBoxOn") : t("helper.boundingBoxOff"));
  });

  // Focus selected mesh button (click a part to isolate it visually)
  const focusBtn = markSecondary(inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleFocusSelectionLabel"), "aria-pressed": "false" },
  }));
  focusBtn.appendChild(createSvgIcon(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M4.93 4.93l2.12 2.12"/><path d="M16.95 16.95l2.12 2.12"/><path d="M19.07 4.93l-2.12 2.12"/><path d="M7.05 16.95l-2.12 2.12"/>`));
  focusBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsFocusSelectionPreview(preview)) return;
    const on = preview.toggleFocusSelection();
    syncCapabilities();
    showTooltip(focusBtn, on ? t("helper.focusSelectionOn") : t("helper.focusSelectionOff"));
  });

  // Disassembly mode toggle button (separate parts by dragging)
  const disassembleBtn = markSecondary(inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn",
    attr: { "aria-label": t("helper.toggleDisassemblyLabel"), "aria-pressed": "false" },
  }));
  disassembleBtn.appendChild(createSvgIcon(`<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 17h6"/><path d="M17 14v6"/>`));
  disassembleBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview || !supportsDisassemblyPreview(preview)) return;
    const on = preview.toggleDisassembly();
    syncCapabilities();
    showTooltip(disassembleBtn, on ? t("helper.disassemblyOn") : t("helper.disassemblyOff"));
  });

  // Reset disassembled parts button
  const resetPartsBtn = markSecondary(inspectGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.resetPartsLabel") } }));
  resetPartsBtn.appendChild(createSvgIcon(`<path d="M3 12a9 9 0 109-9"/><path d="M3 4v8h8"/><rect x="14" y="14" width="5" height="5" rx="1"/>`));
  resetPartsBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.resetDisassembly) return;
    preview.resetDisassembly();
    syncCapabilities();
    showTooltip(resetPartsBtn, t("helper.partsReset"));
  });

  // Resolution scale cycle button (percentage display)
  const RES_PRESETS = [0.5, 0.75, 1.0, 1.5, 2.0];
  const configuredScale = getSettings?.().renderScale ?? 1.0;
  let resIndex = RES_PRESETS.reduce((bestIndex, value, index) => {
    const currentDelta = Math.abs(value - configuredScale);
    const bestDelta = Math.abs(RES_PRESETS[bestIndex] - configuredScale);
    return currentDelta < bestDelta ? index : bestIndex;
  }, 2);
  const resBtn = markSecondary(viewGroup.createEl("button", { cls: "ai3d-inline-btn ai3d-res-btn", attr: { "aria-label": t("helper.changeResolutionLabel") } }));
  resBtn.textContent = `${RES_PRESETS[resIndex].toFixed(1)}x`;
  resBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.setRenderScale) return;
    resIndex = (resIndex + 1) % RES_PRESETS.length;
    const applied = preview.setRenderScale(RES_PRESETS[resIndex]);
    resBtn.textContent = `${applied.toFixed(1)}x`;
    showTooltip(resBtn, formatT("helper.resolutionValue", { value: `${applied}x` }));
  });

  // Animation play/pause button (play triangle — hidden until animations detected)
  const animBtn = markSecondary(viewGroup.createEl("button", {
    cls: "ai3d-inline-btn is-hidden",
    attr: { "aria-label": t("helper.toggleAnimationLabel"), "aria-pressed": "false" },
  }));
  animBtn.appendChild(createSvgIcon(`<polygon points="5 3 19 12 5 21 5 3"/>`));
  animBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview?.toggleAnimation) return;
    const playing = preview.toggleAnimation();
    animBtn.replaceChildren(createSvgIcon(playing
      ? `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
      : `<polygon points="5 3 19 12 5 21 5 3"/>`));
    setTogglePressed(animBtn, playing);
    showTooltip(animBtn, playing ? t("helper.playing") : t("helper.paused"));
  });

  // Remove button (trash)
  const removeBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.removePreviewLabel") } }));
  removeBtn.appendChild(createSvgIcon(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>`));
  removeBtn.addEventListener("click", onRemove);

  // Copy snapshot button (clipboard)
  const copyBtn = outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.copySnapshotLabel") } });
  copyBtn.appendChild(createSvgIcon(`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>`));
  copyBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const blob = dataUrlToBlob(dataUrl);
      void navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]).then(() => {
        showTooltip(copyBtn, t("helper.copied"));
      }).catch(() => {
        showTooltip(copyBtn, t("helper.failed"));
      });
    } catch (err) {
      console.error("[AI3D] Copy snapshot failed:", err);
      showTooltip(copyBtn, t("helper.failed"));
    }
  });

  // Save to vault button (disk)
  const saveBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.saveSnapshotLabel") } }));
  saveBtn.appendChild(createSvgIcon(`<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`));
  saveBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const modelPath = getModelPath();
      const baseName = getPortableStem(modelPath) || "model";
      const settings = getSettings?.();
      const folder = settings?.snapshotFolder ?? "Media/3D Previews";
      const naming = settings?.snapshotNaming ?? "model-name";
      const ts = Date.now();
      const fileName = naming === "timestamp"
        ? `snapshot_${ts}.png`
        : `${baseName}_snapshot_${ts}.png`;

      const blob = dataUrlToBlob(dataUrl);
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        void app.vault.adapter.exists(folder).then((exists) => {
          const create = exists ? Promise.resolve() : app.vault.createFolder(folder).catch(() => {});
          return create;
        }).then(() => {
          return app.vault.createBinary(`${folder}/${fileName}`, buffer);
        }).then(() => {
          showTooltip(saveBtn, t("helper.saved"));
        }).catch((err: unknown) => {
          console.error("[AI3D] Save snapshot failed:", err);
          showTooltip(saveBtn, t("helper.failed"));
        });
      };
      reader.onerror = () => {
        console.error("[AI3D] FileReader error");
        showTooltip(saveBtn, t("helper.failed"));
      };
      reader.onabort = () => {
        console.error("[AI3D] FileReader aborted");
        showTooltip(saveBtn, t("helper.failed"));
      };
      reader.readAsArrayBuffer(blob);
    } catch (err) {
      console.error("[AI3D] Save snapshot failed:", err);
      showTooltip(saveBtn, t("helper.failed"));
    }
  });

  // Download snapshot button (download arrow)
  const downloadBtn = markSecondary(outputGroup.createEl("button", { cls: "ai3d-inline-btn", attr: { "aria-label": t("helper.downloadSnapshotLabel") } }));
  downloadBtn.appendChild(createSvgIcon(`<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`));
  downloadBtn.addEventListener("click", () => {
    const preview = getPreview();
    if (!preview) return;
    try {
      const dataUrl = preview.captureSnapshot();
      if (!dataUrl) return;
      const modelPath = getModelPath();
      const baseName = getPortableStem(modelPath) || "model";
      const fileName = `${baseName}_snapshot_${Date.now()}.png`;

      const a = createEl("a");
      a.href = dataUrl;
      a.download = fileName;
      activeDocument.body.appendChild(a);
      a.click();
      a.remove();
      showTooltip(downloadBtn, t("helper.downloaded"));
    } catch (err) {
      console.error("[AI3D] Download snapshot failed:", err);
      showTooltip(downloadBtn, t("helper.failed"));
    }
  });

  // Annotation toggle button (tag/label icon — hidden until explicitly shown)
  const annotBtn = markSecondary(inspectGroup.createEl("button", {
    cls: "ai3d-inline-btn is-hidden ai3d-annot-btn",
    attr: { "aria-label": t(resolvedAnnotationCopy.labelKey), "aria-pressed": "false" },
  }));
  annotBtn.appendChild(createSvgIcon(`<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>`));
  const annotBadge = annotBtn.createSpan({ cls: "ai3d-pin-badge is-hidden" });
  annotBtn.addEventListener("click", () => {
    if (!onToggleAnnotate) return;
    const active = onToggleAnnotate();
    setTogglePressed(annotBtn, active);
    showTooltip(
      annotBtn,
      active ? t(resolvedAnnotationCopy.activeTooltipKey) : t(resolvedAnnotationCopy.inactiveTooltipKey),
    );
  });

  const showMoreBtn = toolbar.createEl("button", {
    cls: "ai3d-inline-btn ai3d-mobile-more-toggle",
    attr: { "aria-label": t("helper.showMoreActionsLabel"), "aria-pressed": "false" },
  });
  showMoreBtn.appendChild(createSvgIcon(`<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>`));
  showMoreBtn.addEventListener("click", () => {
    toolbarExpanded = !toolbarExpanded;
    showMoreBtn.setAttribute("aria-label", toolbarExpanded ? t("helper.hideMoreActionsLabel") : t("helper.showMoreActionsLabel"));
    renderToolbarButtons();
    showTooltip(showMoreBtn, toolbarExpanded ? t("helper.moreActionsShown") : t("helper.moreActionsHidden"));
  });

  // Move toolbar to sit right after previewHost
  parentEl.insertBefore(toolbar, previewHost.nextSibling);

  renderToolbarButtons();
  syncCapabilities();

  return {
    showAnimButton() {
      animBtn.classList.remove("is-hidden");
      syncGroupVisibility();
    },
    showAnnotateButton() {
      annotBtn.classList.remove("is-hidden");
      syncGroupVisibility();
    },
    updateAnnotationBadge(count: number) {
      if (count > 0) {
        annotBadge.textContent = String(count);
        annotBadge.classList.remove("is-hidden");
      } else {
        annotBadge.classList.add("is-hidden");
      }
    },
    setMobileInteractionMode(active: boolean) {
      if (!mobile) return;
      applyMobileInteractionMode(active);
    },
    syncCapabilities,
  };
}

// Track one tooltip per anchor to prevent stacking (#28)
const activeTooltips = new WeakMap<HTMLElement, HTMLElement>();

function showTooltip(anchor: HTMLElement, text: string): void {
  activeTooltips.get(anchor)?.remove();
  const tip = anchor.createSpan({ cls: "ai3d-tooltip" });
  tip.textContent = text;
  activeTooltips.set(anchor, tip);
  window.setTimeout(() => { tip.remove(); activeTooltips.delete(anchor); }, 1500);
}
